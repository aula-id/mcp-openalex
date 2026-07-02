// OpenAlex API client, response trimmers, and filter builder

const BASE = "https://api.openalex.org";

// ── Runtime config (override via set_config tool or env vars) ────────
const config = {
  api_key: process.env.OPENALEX_API_KEY || null,
  mailto: process.env.OPENALEX_MAILTO || null,
};

// ── HTTP client ─────────────────────────────────────────────────────
export async function openAlexGet(endpoint, params = {}) {
  const url = new URL(endpoint, BASE);
  for (const [k, v] of Object.entries(params)) {
    if (v != null && v !== "") url.searchParams.set(k, String(v));
  }
  // Auth: api_key takes priority, otherwise mailto for polite pool
  if (config.api_key) {
    url.searchParams.set("api_key", config.api_key);
  } else if (config.mailto) {
    url.searchParams.set("mailto", config.mailto);
  }
  const res = await fetch(url.toString(), {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`OpenAlex ${res.status}: ${body.slice(0, 300)}`);
  }
  return res.json();
}

// ── Config setter ───────────────────────────────────────────────────
export function setConfig(key, value) {
  if (key === "api_key" || key === "mailto") {
    config[key] = value || null;
    return true;
  }
  return false;
}

export function getConfig() {
  return { ...config };
}

// ── Filter builder ──────────────────────────────────────────────────
// Converts a flat JS object into OpenAlex filter query string.
// Handles shorthand keys and preserves raw filter values.
export function buildFilterString(filters) {
  if (!filters || typeof filters !== "object") return undefined;

  const FILTER_MAP = {
    from_year: (v) => `from_publication_date:${v}-01-01`,
    to_year: (v) => `to_publication_date:${v}-12-31`,
    open_access: (v) => `open_access.is_oa:${v}`,
    min_citations: (v) => `cited_by_count:>${v}`,
    max_citations: (v) => `cited_by_count:<${v}`,
    author_id: (v) => `author.id:${v}`,
    institution_id: (v) => `institutions.id:${v}`,
    source_id: (v) => `primary_location.source.id:${v}`,
    topic_id: (v) => `topics.id:${v}`,
  };

  const parts = [];
  for (const [key, value] of Object.entries(filters)) {
    if (value == null || value === "") continue;
    const mapper = FILTER_MAP[key];
    if (mapper) {
      parts.push(mapper(value));
    } else {
      // Pass through as-is for direct OpenAlex filter syntax
      parts.push(`${key}:${value}`);
    }
  }
  return parts.length > 0 ? parts.join(",") : undefined;
}

// ── ID resolver ─────────────────────────────────────────────────────
// Detects DOI, ORCID, ROR, PMID, or OpenAlex ID and returns the
// correct lookup path for OpenAlex.
export function resolveId(identifier) {
  const id = identifier.trim();

  // OpenAlex ID: starts with W, A, S, I, T, etc. followed by digits
  if (/^[WASITPKFCDLU]\d{4,}$/.test(id)) return `/works/${id}`;
  if (/^A\d{4,}$/.test(id)) return `/authors/${id}`;
  if (/^[SI]\d{4,}$/.test(id)) return `/${id.startsWith("S") ? "sources" : "institutions"}/${id}`;

  // DOI
  if (/^10\.\d{4,}/.test(id)) return `/works/doi:${id}`;
  if (id.startsWith("https://doi.org/")) return `/works/doi:${id.slice(16)}`;
  if (id.startsWith("doi:")) return `/works/${id}`;

  // ORCID
  if (/^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/.test(id)) return `/authors/orcid:${id}`;
  if (id.startsWith("https://orcid.org/")) return `/authors/orcid:${id.slice(18)}`;

  // PMID
  if (/^PMID:?\s*\d+/i.test(id)) return `/works/pmid:${id.replace(/PMID:?\s*/i, "")}`;

  // ROR
  if (id.startsWith("https://ror.org/")) return `/institutions/${id}`;

  // Fallback: treat as OpenAlex works endpoint
  return `/works/${id}`;
}

// ── Response trimmers ───────────────────────────────────────────────
// Extract only the fields useful for an LLM agent.

export function trimWork(w) {
  if (!w) return null;
  return {
    id: w.id,
    doi: w.doi,
    title: w.title,
    publication_year: w.publication_year,
    type: w.type,
    authors: (w.authorships || []).map((a) => a.author?.display_name).filter(Boolean),
    institutions: [
      ...new Set(
        (w.authorships || [])
          .flatMap((a) => a.institutions || [])
          .map((i) => i.display_name)
          .filter(Boolean),
      ),
    ],
    source: w.primary_location?.source?.display_name || null,
    cited_by_count: w.cited_by_count,
    oa_status: w.open_access?.oa_status || null,
    oa_url: w.open_access?.oa_url || null,
    topic: w.primary_topic?.display_name || null,
    subfield: w.primary_topic?.subfield?.display_name || null,
    field: w.primary_topic?.field?.display_name || null,
    domain: w.primary_topic?.domain?.display_name || null,
    abstract: reconstructAbstract(w.abstract_inverted_index),
  };
}

export function trimAuthor(a) {
  if (!a) return null;
  return {
    id: a.id,
    orcid: a.orcid,
    name: a.display_name,
    name_alternatives: a.display_name_alternatives || [],
    institution: a.last_known_institutions?.[0]?.display_name || null,
    country: a.last_known_institutions?.[0]?.country_code || null,
    works_count: a.works_count,
    cited_by_count: a.cited_by_count,
    h_index: a.summary_stats?.h_index ?? null,
    i10_index: a.summary_stats?.i10_index ?? null,
    "2yr_mean_citedness": a.summary_stats?.["2yr_mean_citedness"] ?? null,
  };
}

export function trimInstitution(i) {
  if (!i) return null;
  return {
    id: i.id,
    name: i.display_name,
    name_alternatives: i.display_name_alternatives || [],
    country_code: i.country_code,
    continent: i.continent,
    type: i.type,
    homepage_url: i.homepage_url || null,
    works_count: i.works_count,
    cited_by_count: i.cited_by_count,
    ror: i.ror || null,
    image_url: i.image_url || null,
  };
}

export function trimSource(s) {
  if (!s) return null;
  return {
    id: s.id,
    name: s.display_name,
    alternate_titles: s.alternate_titles || [],
    abbreviated_name: s.abbreviated_name || null,
    issn_l: s.issn_l || null,
    type: s.type,
    is_oa: s.is_oa,
    is_in_doaj: s.is_in_doaj,
    country_code: s.country_code,
    homepage_url: s.homepage_url || null,
    works_count: s.works_count,
    cited_by_count: s.cited_by_count,
  };
}

export function trimTopic(t) {
  if (!t) return null;
  return {
    id: t.id,
    name: t.display_name,
    description: t.description || null,
    domain: t.domain?.display_name || null,
    field: t.field?.display_name || null,
    subfield: t.subfield?.display_name || null,
    works_count: t.works_count,
    cited_by_count: t.cited_by_count,
  };
}

// ── Helpers ─────────────────────────────────────────────────────────

function reconstructAbstract(invertedIndex) {
  if (!invertedIndex || typeof invertedIndex !== "object") return null;
  const positions = [];
  for (const [word, posArray] of Object.entries(invertedIndex)) {
    for (const pos of posArray) {
      positions[pos] = word;
    }
  }
  return positions.join(" ");
}
