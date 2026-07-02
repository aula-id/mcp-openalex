# OpenAlex MCP Server

An MCP server that connects AI assistants to OpenAlex — the world's largest open catalog of scholarly research. Search 250M+ papers, 90M+ authors, and 109K+ institutions directly from your AI workflow.

## What is this?

This is a [Model Context Protocol](https://modelcontextprotocol.io/) server that bridges your AI assistant to the [OpenAlex API](https://openalex.org). It gives your AI the ability to:

- Search and discover scholarly papers with full-text queries and structured filters
- Look up any paper by DOI, PMID, or OpenAlex ID
- Explore citation networks — what cites what
- Find researchers and explore their publication profiles
- Browse institutions, journals, and topic taxonomies
- Run aggregate statistics on publication trends

## Quick Start

### Prerequisites

- **Node.js** v18 or later
- An **MCP client** (Claude Desktop, Cursor, Windsurf, Zed, or any MCP-compatible client)

### 1. Clone or copy

```bash
git clone <your-repo-url> openalex-mcp
cd openalex-mcp
npm install
```

### 2. Configure (optional but recommended)

Get a free API key at [openalex.org/settings/api](https://openalex.org/settings/api) for higher rate limits.

Set environment variables:

```bash
export OPENALEX_API_KEY="your-key-here"
export OPENALEX_MAILTO="your@email.com"  # polite pool — faster responses
```

Or skip this — the API works without a key, just with lower rate limits.

### 3. Connect to your MCP client

Add to your MCP client config:

```json
{
  "mcpServers": {
    "openalex": {
      "command": "node",
      "args": ["/absolute/path/to/openalex-mcp/server.js"],
      "env": {
        "OPENALEX_API_KEY": "your-key-here",
        "OPENALEX_MAILTO": "your@email.com"
      }
    }
  }
}
```

That's it. Your AI assistant can now search scholarly literature.

## Available Tools

### Search & Discovery

| Tool | Description | Credits |
|---|---|---|
| `search_works` | Search papers by keyword with filters (year, type, OA status, citations, author, institution, topic) | 10 |
| `search_authors` | Find researchers by name with metrics (h-index, institution, citations) | 10 |
| `search_institutions` | Find universities and research organizations | 10 |
| `search_topics` | Browse the OpenAlex research topic taxonomy | 1 |

### Lookup & Detail

| Tool | Description | Credits |
|---|---|---|
| `get_work` | Full details of a paper by DOI, PMID, or OpenAlex ID | 0 |
| `get_author` | Researcher profile with h-index, citation metrics, and affiliation | 0 |

### Citation Analysis

| Tool | Description | Credits |
|---|---|---|
| `get_work_citations` | Works that cite a given paper | 1 |
| `get_work_references` | Works cited BY a given paper (its reference list) | 1 |

### Author Publications

| Tool | Description | Credits |
|---|---|---|
| `get_works_by_author` | List an author's publications with filters | 1 |

### Analytics

| Tool | Description | Credits |
|---|---|---|
| `aggregate_works` | Group-by statistics — publication counts by year, type, OA status, institution, topic, country, or language | 1 |

### Configuration

| Tool | Description | Credits |
|---|---|---|
| `set_config` | Set `api_key` or `mailto` at runtime (persists for the session) | 0 |

## Tool Details & Examples

### `search_works` — Find papers

The primary search tool. Supports full-text queries with boolean logic.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `query` | string | yes | Search terms. Supports boolean: `("deep learning" AND "medical imaging") NOT survey` |
| `filters` | object | no | Structured filters (see below) |
| `sort` | string | no | `relevance_score:desc` (default), `cited_by_count:desc`, `publication_date:desc` |
| `per_page` | number | no | Results per page (1-50, default 10) |
| `page` | number | no | Page number (default 1) |

**Available filters:**

| Filter | Example | Effect |
|---|---|---|
| `from_year` | `2020` | Papers published from 2020 onward |
| `to_year` | `2024` | Papers published up to 2024 |
| `type` | `"article"`, `"review"`, `"article\|review"` | Filter by work type |
| `open_access` | `true` | Only open access papers |
| `min_citations` | `50` | At least 50 citations |
| `max_citations` | `1000` | At most 1000 citations |
| `author_id` | `"A5023888391"` | Papers by a specific author |
| `institution_id` | `"I138006243"` | Papers from a specific institution |
| `source_id` | `"S137773608"` | Papers in a specific journal/source |
| `topic_id` | `"T10102"` | Papers on a specific topic |

**Example prompts:**
- *"Find recent papers about transformer architectures in biology with over 100 citations"*
- *"Search for open access reviews on CRISPR from 2022-2024"*

### `get_work` — Paper details

Fetch full metadata for a specific paper. Pass a DOI, PMID, or OpenAlex ID.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `identifier` | string | yes | DOI (`10.1234/example`), PMID (`29456894`), or OpenAlex ID (`W2741809807`) |
| `full` | boolean | no | Set `true` for complete raw metadata (default `false` returns trimmed summary) |

**Example prompts:**
- *"Get details for DOI 10.7717/peerj.4375"*
- *"What's the paper with PMID 29456894 about?"*

### `get_work_citations` — Who cites a paper

Find works that cite a given paper. Sorted by citation count by default — shows the most impactful citing works first.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `work_id` | string | yes | Paper identifier (OpenAlex ID or DOI) |
| `per_page` | number | no | Results per page (default 10) |
| `sort` | string | no | `cited_by_count:desc` (default) or `publication_date:desc` |

### `get_work_references` — What a paper cites

Explore the reference list of a paper — the foundation it builds on.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `work_id` | string | yes | Paper identifier |
| `per_page` | number | no | Results per page (default 10) |

### `get_works_by_author` — Author publications

List a researcher's publications with the same filter options as `search_works`.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `author_id` | string | yes | OpenAlex ID (`A5023888391`) or ORCID (`0000-0001-6187-6610`) |
| `filters` | object | no | Same filters as `search_works` |
| `sort` | string | no | `publication_date:desc` (default) or `cited_by_count:desc` |
| `per_page` | number | no | Results per page (default 10) |

### `search_authors` — Find researchers

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `query` | string | yes | Author name |
| `institution_id` | string | no | Filter by institution |
| `has_orcid` | boolean | no | Only verified ORCIDs |
| `min_works` | number | no | Minimum publications |
| `min_citations` | number | no | Minimum total citations |

### `aggregate_works` — Statistics

Get distribution counts across any works query. Useful for understanding trends.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `query` | string | no | Optional search to scope results |
| `filters` | object | no | Same filters as `search_works` |
| `group_by` | string | yes | Field to group by (see options below) |

**Available `group_by` values:**
- `publication_year` — papers per year
- `type` — by work type (article, review, preprint, etc.)
- `open_access.oa_status` — by OA status (gold, green, hybrid, bronze, closed)
- `institutions.id` — by institution
- `topics.id` — by topic
- `primary_topic.field.display_name` — by research field
- `primary_topic.domain.display_name` — by domain
- `authorships.countries` — by country
- `language` — by language

**Example prompt:**
- *"How many AI papers were published each year since 2015?"*

### `set_config` — Runtime configuration

Update the API key or email for the current session without restarting.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `key` | string | yes | `"api_key"` or `"mailto"` |
| `value` | string | yes | The value to set (pass empty string to clear) |

## Response Format

All search tools return trimmed responses with only the fields useful for research:

```json
{
  "meta": {
    "count": 12345,
    "page": 1,
    "per_page": 10
  },
  "results": [
    {
      "id": "https://openalex.org/W2741809807",
      "doi": "https://doi.org/10.7717/peerj.4375",
      "title": "The state of OA: a large-scale analysis...",
      "publication_year": 2018,
      "type": "journal-article",
      "authors": ["Heather Piwowar", "Jason Priem", "..."],
      "institutions": ["University of Washington", "..."],
      "source": "PeerJ",
      "cited_by_count": 1221,
      "oa_status": "gold",
      "topic": "scientometrics and bibliometrics research",
      "field": "Decision Sciences",
      "domain": "Social Sciences"
    }
  ]
}
```

Use `get_work` with `full: true` to get the complete raw response when you need all metadata.

## Credit Costs

OpenAlex uses a credit system. Costs per request:

| Operation | Credits |
|---|---|
| Single entity lookup (`get_work`, `get_author`) | 0 |
| List/filter query | 1 |
| Full-text search | 10 |

Without an API key you get 100,000 credits/day. With a free key you get more headroom.

## Supported ID Formats

The tools auto-detect identifier formats — no need to specify the type:

| Format | Example |
|---|---|
| DOI | `10.7717/peerj.4375` |
| DOI URL | `https://doi.org/10.7717/peerj.4375` |
| PMID | `29456894` |
| OpenAlex ID | `W2741809807` (works), `A5023888391` (authors), `I138006243` (institutions) |
| ORCID | `0000-0001-6187-6610` |
| ROR URL | `https://ror.org/057zh3y96` |

## Architecture

```
openalex-mcp/
├── package.json       # Dependencies
├── server.js          # MCP server entry — tool definitions and registration
└── openalex.js        # OpenAlex HTTP client, ID resolver, filter builder, response trimmers
```

- **`openalex.js`** handles all OpenAlex API communication, ID auto-detection, filter string construction, and response trimming
- **`server.js`** registers 11 tools with the MCP SDK and wires them to the client
- No database, no state — pure stateless API bridge over stdio

## License

MIT
