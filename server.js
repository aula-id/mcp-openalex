#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  openAlexGet,
  setConfig,
  getConfig,
  buildFilterString,
  resolveId,
  trimWork,
  trimAuthor,
  trimInstitution,
  trimSource,
  trimTopic,
  doiToBibtex,
} from "./openalex.js";

const server = new McpServer({ name: "openalex-mcp", version: "1.0.0" });

// ── Reusable filter schemas ─────────────────────────────────────────
const workFilters = z
  .object({
    from_year: z.number().int().optional().describe("Start publication year, e.g. 2020"),
    to_year: z.number().int().optional().describe("End publication year, e.g. 2024"),
    type: z.string().optional().describe('Work type, e.g. "article", "review", "article|review"'),
    open_access: z.boolean().optional().describe("Only open access works"),
    min_citations: z.number().int().optional().describe("Minimum citation count"),
    max_citations: z.number().int().optional().describe("Maximum citation count"),
    author_id: z.string().optional().describe("OpenAlex author ID, e.g. A5023888391"),
    institution_id: z.string().optional().describe("OpenAlex institution ID, e.g. I138006243"),
    source_id: z.string().optional().describe("OpenAlex source/journal ID, e.g. S137773608"),
    topic_id: z.string().optional().describe("OpenAlex topic ID, e.g. T10102"),
  })
  .optional()
  .describe("Structured filters to narrow results");

// ─────────────────────────────────────────────────────────────────────
// 1. search_works
// ─────────────────────────────────────────────────────────────────────
server.registerTool(
  "search_works",
  {
    description:
      "Search scholarly works (papers, articles, books) by keyword. Returns trimmed results with title, authors, citations, OA status, and topic. Use filters to narrow by year, type, citations, author, institution, or source.",
    inputSchema: {
      query: z
        .string()
        .describe(
          'Search terms, e.g. "machine learning healthcare" or \'("deep learning" AND "medical imaging") NOT survey\'',
        ),
      filters: workFilters,
      sort: z
        .enum(["relevance_score:desc", "cited_by_count:desc", "publication_date:desc", "publication_date:asc"])
        .default("relevance_score:desc")
        .describe("Sort order"),
      per_page: z.number().int().min(1).max(50).default(10).describe("Results per page (1-50)"),
      page: z.number().int().min(1).default(1).describe("Page number"),
    },
  },
  async ({ query, filters, sort, per_page, page }) => {
    const params = { search: query, sort, per_page, page };
    const f = buildFilterString(filters);
    if (f) params.filter = f;
    const data = await openAlexGet("/works", params);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              meta: data.meta,
              results: (data.results || []).map(trimWork),
            },
            null,
            2,
          ),
        },
      ],
    };
  },
);

// ─────────────────────────────────────────────────────────────────────
// 2. get_work
// ─────────────────────────────────────────────────────────────────────
server.registerTool(
  "get_work",
  {
    description:
      "Get full details of a specific scholarly work by OpenAlex ID, DOI, or PMID. Use full=true for complete metadata including abstract.",
    inputSchema: {
      identifier: z
        .string()
        .describe(
          'Work identifier: OpenAlex ID (W2741809807), DOI (10.7717/peerj.4375 or https://doi.org/...), or PMID (29456894)',
        ),
      full: z.boolean().default(false).describe("Return full metadata (includes abstract, all author details, etc.)"),
    },
  },
  async ({ identifier, full }) => {
    const path = resolveId(identifier);
    const data = await openAlexGet(path);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(full ? data : trimWork(data), null, 2),
        },
      ],
    };
  },
);

// ─────────────────────────────────────────────────────────────────────
// 3. get_work_citations
// ─────────────────────────────────────────────────────────────────────
server.registerTool(
  "get_work_citations",
  {
    description: "Find works that cite a given paper. Useful for exploring how research has been built upon.",
    inputSchema: {
      work_id: z.string().describe("Work identifier (OpenAlex ID or DOI)"),
      per_page: z.number().int().min(1).max(50).default(10).describe("Results per page"),
      sort: z
        .enum(["cited_by_count:desc", "publication_date:desc", "publication_date:asc"])
        .default("cited_by_count:desc")
        .describe("Sort order"),
      page: z.number().int().min(1).default(1).describe("Page number"),
    },
  },
  async ({ work_id, per_page, sort, page }) => {
    const path = resolveId(work_id);
    const work = await openAlexGet(path);
    const numericId = work.id?.split("/").pop();
    const data = await openAlexGet("/works", {
      filter: `cites:${numericId}`,
      sort,
      per_page,
      page,
    });
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              meta: data.meta,
              source_work: { id: work.id, title: work.title },
              results: (data.results || []).map(trimWork),
            },
            null,
            2,
          ),
        },
      ],
    };
  },
);

// ─────────────────────────────────────────────────────────────────────
// 4. get_work_references
// ─────────────────────────────────────────────────────────────────────
server.registerTool(
  "get_work_references",
  {
    description: "Find works cited BY a given paper (its reference list). Useful for exploring the foundation of research.",
    inputSchema: {
      work_id: z.string().describe("Work identifier (OpenAlex ID or DOI)"),
      per_page: z.number().int().min(1).max(50).default(10).describe("Results per page"),
      page: z.number().int().min(1).default(1).describe("Page number"),
    },
  },
  async ({ work_id, per_page, page }) => {
    const path = resolveId(work_id);
    const work = await openAlexGet(path);
    const numericId = work.id?.split("/").pop();
    const data = await openAlexGet("/works", {
      filter: `cited_by:${numericId}`,
      sort: "publication_date:desc",
      per_page,
      page,
    });
    const refs = work.referenced_works || [];
    if (refs.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                source_work: { id: work.id, title: work.title },
                referenced_work_ids: [],
                note: "No referenced works found in OpenAlex for this paper.",
              },
              null,
              2,
            ),
          },
        ],
      };
    }
    const refIds = refs
      .slice((page - 1) * per_page, page * per_page)
      .map((r) => r.split("/").pop());
    const filterStr = refIds.join("|");
    const refData = await openAlexGet("/works", {
      filter: `openalex:${filterStr}`,
    });
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              meta: {
                total_references: refs.length,
                page,
                per_page,
              },
              source_work: { id: work.id, title: work.title },
              results: (refData.results || []).map(trimWork),
            },
            null,
            2,
          ),
        },
      ],
    };
  },
);

// ─────────────────────────────────────────────────────────────────────
// 5. get_works_by_author
// ─────────────────────────────────────────────────────────────────────
server.registerTool(
  "get_works_by_author",
  {
    description:
      "List publications by a specific author, with optional filters. Pass an OpenAlex author ID (A...) or ORCID.",
    inputSchema: {
      author_id: z
        .string()
        .describe('Author identifier: OpenAlex ID (A5023888391) or ORCID (0000-0001-6187-6610)'),
      filters: workFilters,
      sort: z
        .enum(["publication_date:desc", "publication_date:asc", "cited_by_count:desc"])
        .default("publication_date:desc")
        .describe("Sort order"),
      per_page: z.number().int().min(1).max(50).default(10).describe("Results per page"),
      page: z.number().int().min(1).default(1).describe("Page number"),
    },
  },
  async ({ author_id, filters, sort, per_page, page }) => {
    let authorPath;
    if (/^A\d{4,}$/.test(author_id)) {
      authorPath = `/authors/${author_id}`;
    } else if (/^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/.test(author_id)) {
      authorPath = `/authors/orcid:${author_id}`;
    } else {
      authorPath = `/authors/${author_id}`;
    }
    const author = await openAlexGet(authorPath);
    const authorNumericId = author.id?.split("/").pop();

    const params = { sort, per_page, page };
    const f = buildFilterString({ ...filters, author_id: authorNumericId });
    params.filter = f;

    const data = await openAlexGet("/works", params);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              meta: data.meta,
              author: { id: author.id, name: author.display_name },
              results: (data.results || []).map(trimWork),
            },
            null,
            2,
          ),
        },
      ],
    };
  },
);

// ─────────────────────────────────────────────────────────────────────
// 6. search_authors
// ─────────────────────────────────────────────────────────────────────
server.registerTool(
  "search_authors",
  {
    description:
      "Search for researchers by name. Returns profiles with institution, h-index, works count, and citation count.",
    inputSchema: {
      query: z.string().describe('Author name, e.g. "Yoshua Bengio" or "Geoffrey Hinton"'),
      institution_id: z.string().optional().describe("Filter by institution OpenAlex ID"),
      has_orcid: z.boolean().optional().describe("Only authors with verified ORCID"),
      min_works: z.number().int().optional().describe("Minimum number of publications"),
      min_citations: z.number().int().optional().describe("Minimum total citations"),
      per_page: z.number().int().min(1).max(50).default(10).describe("Results per page"),
      page: z.number().int().min(1).default(1).describe("Page number"),
    },
  },
  async ({ query, institution_id, has_orcid, min_works, min_citations, per_page, page }) => {
    const filterParts = [];
    if (institution_id) filterParts.push(`last_known_institutions.id:${institution_id}`);
    if (has_orcid) filterParts.push("has_orcid:true");
    if (min_works) filterParts.push(`works_count:>${min_works}`);
    if (min_citations) filterParts.push(`cited_by_count:>${min_citations}`);

    const params = { search: query, per_page, page };
    if (filterParts.length > 0) params.filter = filterParts.join(",");

    const data = await openAlexGet("/authors", params);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              meta: data.meta,
              results: (data.results || []).map(trimAuthor),
            },
            null,
            2,
          ),
        },
      ],
    };
  },
);

// ─────────────────────────────────────────────────────────────────────
// 7. get_author
// ─────────────────────────────────────────────────────────────────────
server.registerTool(
  "get_author",
  {
    description:
      "Get full profile of a researcher by OpenAlex ID or ORCID. Includes h-index, citation metrics, and institutional affiliation.",
    inputSchema: {
      identifier: z
        .string()
        .describe('Author identifier: OpenAlex ID (A5023888391) or ORCID (0000-0001-6187-6610)'),
    },
  },
  async ({ identifier }) => {
    let path;
    if (/^A\d{4,}$/.test(identifier)) {
      path = `/authors/${identifier}`;
    } else if (/^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/.test(identifier)) {
      path = `/authors/orcid:${identifier}`;
    } else if (identifier.startsWith("https://orcid.org/")) {
      path = `/authors/orcid:${identifier.slice(18)}`;
    } else {
      path = `/authors/${identifier}`;
    }
    const data = await openAlexGet(path);
    return {
      content: [{ type: "text", text: JSON.stringify(trimAuthor(data), null, 2) }],
    };
  },
);

// ─────────────────────────────────────────────────────────────────────
// 8. search_institutions
// ─────────────────────────────────────────────────────────────────────
server.registerTool(
  "search_institutions",
  {
    description: "Search for universities, research organizations, or companies by name.",
    inputSchema: {
      query: z.string().describe('Institution name, e.g. "MIT" or "University of Tokyo"'),
      country_code: z.string().optional().describe('ISO country code, e.g. "us", "jp", "gb"'),
      type: z.string().optional().describe('Institution type, e.g. "education", "facility", "company"'),
      per_page: z.number().int().min(1).max(50).default(10).describe("Results per page"),
      page: z.number().int().min(1).default(1).describe("Page number"),
    },
  },
  async ({ query, country_code, type, per_page, page }) => {
    const filterParts = [];
    if (country_code) filterParts.push(`country_code:${country_code}`);
    if (type) filterParts.push(`type:${type}`);

    const params = { search: query, per_page, page };
    if (filterParts.length > 0) params.filter = filterParts.join(",");

    const data = await openAlexGet("/institutions", params);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              meta: data.meta,
              results: (data.results || []).map(trimInstitution),
            },
            null,
            2,
          ),
        },
      ],
    };
  },
);

// ─────────────────────────────────────────────────────────────────────
// 9. search_topics
// ─────────────────────────────────────────────────────────────────────
server.registerTool(
  "search_topics",
  {
    description: "Browse research topics in the OpenAlex taxonomy. Use topic IDs as filters in other tools.",
    inputSchema: {
      query: z.string().describe('Topic name, e.g. "machine learning", "climate change"'),
      domain: z.string().optional().describe('Filter by domain name, e.g. "Medicine", "Computer Science"'),
      field: z.string().optional().describe('Filter by field name, e.g. "Artificial Intelligence"'),
      per_page: z.number().int().min(1).max(50).default(10).describe("Results per page"),
      page: z.number().int().min(1).default(1).describe("Page number"),
    },
  },
  async ({ query, domain, field, per_page, page }) => {
    const filterParts = [];
    if (domain) filterParts.push(`domain.display_name:${domain}`);
    if (field) filterParts.push(`field.display_name:${field}`);

    const params = { search: query, per_page, page };
    if (filterParts.length > 0) params.filter = filterParts.join(",");

    const data = await openAlexGet("/topics", params);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              meta: data.meta,
              results: (data.results || []).map(trimTopic),
            },
            null,
            2,
          ),
        },
      ],
    };
  },
);

// ─────────────────────────────────────────────────────────────────────
// 10. aggregate_works
// ─────────────────────────────────────────────────────────────────────
server.registerTool(
  "aggregate_works",
  {
    description:
      "Get faceted statistics about works. Group by publication_year, type, open_access status, institution, topic, field, country, or language to see distribution counts.",
    inputSchema: {
      query: z.string().optional().describe("Optional search terms to scope the aggregation"),
      filters: workFilters,
      group_by: z
        .enum([
          "publication_year",
          "type",
          "open_access.oa_status",
          "primary_location.source.id",
          "institutions.id",
          "topics.id",
          "primary_topic.field.display_name",
          "primary_topic.domain.display_name",
          "authorships.countries",
          "language",
        ])
        .describe("Field to group/facet by"),
    },
  },
  async ({ query, filters, group_by }) => {
    const params = { group_by };
    if (query) params.search = query;
    const f = buildFilterString(filters);
    if (f) params.filter = f;

    const data = await openAlexGet("/works", params);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              meta: data.meta,
              group_by,
              group_counts: data.group_by || [],
            },
            null,
            2,
          ),
        },
      ],
    };
  },
);

// ─────────────────────────────────────────────────────────────────────
// 11. get_bibtex
// ─────────────────────────────────────────────────────────────────────
server.registerTool(
  "get_bibtex",
  {
    description:
      "Convert a DOI to a BibTeX citation entry. Accepts bare DOIs (10.1234/...) or full URLs (https://doi.org/...). Returns raw BibTeX text from doi.org.",
    inputSchema: {
      doi: z
        .string()
        .describe('DOI to convert, e.g. "10.1038/s41586-020-2649-2" or "https://doi.org/10.1038/s41586-020-2649-2"'),
    },
  },
  async ({ doi }) => {
    try {
      const bibtex = await doiToBibtex(doi);
      return { content: [{ type: "text", text: bibtex }] };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error: ${err.message}` }],
        isError: true,
      };
    }
  },
);

// 12. set_config (utility)
// ─────────────────────────────────────────────────────────────────────
server.registerTool(
  "set_config",
  {
    description:
      "Update runtime configuration. Currently supports: api_key (your OpenAlex API key for higher rate limits) and mailto (your email for polite pool).",
    inputSchema: {
      key: z.enum(["api_key", "mailto"]).describe("Configuration key to set"),
      value: z.string().describe("Value to set (pass empty string to clear)"),
    },
  },
  async ({ key, value }) => {
    const ok = setConfig(key, value || null);
    if (!ok) {
      return {
        content: [{ type: "text", text: `Unknown config key: ${key}` }],
        isError: true,
      };
    }
    const current = getConfig();
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              message: `Config updated: ${key} ${value ? "set" : "cleared"}`,
              current: {
                api_key: current.api_key ? `${current.api_key.slice(0, 4)}...` : null,
                mailto: current.mailto || null,
              },
            },
            null,
            2,
          ),
        },
      ],
    };
  },
);

// ── Start stdio transport ───────────────────────────────────────────
const transport = new StdioServerTransport();
await server.connect(transport);
