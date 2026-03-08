# tc39-spec-mcp

A remote [MCP](https://modelcontextprotocol.io/) server for searching and reading the [ECMA-262](https://tc39.es/ecma262/) specification, browsing active [TC39 proposals](https://github.com/tc39/proposals), searching [plenary meeting notes](https://github.com/tc39/notes), finding existing [test262](https://github.com/tc39/test262) conformance tests, and fetching [meeting agendas](https://github.com/tc39/agendas).

Deployed as a stateless [Cloudflare Worker](https://developers.cloudflare.com/agents/guides/remote-mcp-server/) using the streamable-http transport.

## Tools

### `search_spec`

Search the ECMA-262 specification by abstract operation name, built-in object, section ID, or section number.

**Parameters:**

- `query` (string, required) — Search term (e.g. `"ValidateTypedArray"`, `"ArrayBuffer"`, `"sec-arraybuffer-objects"`, `"25.1"`)
- `limit` (number, optional) — Maximum results to return. Default: 15.

**Example result:**

```
Found 1 matching section(s) for "ValidateTypedArray":

- **23.2.4.4 ValidateTypedArray ( O, order )**
  ID: `sec-validatetypedarray`
  URL: https://tc39.es/ecma262/multipage/indexed-collections.html#sec-validatetypedarray
```

### `get_spec_section`

Fetch the full content of a specific ECMA-262 section by its ID. Returns the section converted to simplified markdown with algorithm steps, parameters, and cross-references preserved.

**Parameters:**

- `section_id` (string, required) — The section ID (e.g. `"sec-validatetypedarray"`). The `sec-` prefix is optional. Use `search_spec` to discover IDs.

### `list_proposals`

List TC39 proposals from the official [tc39/proposals](https://github.com/tc39/proposals) repository.

**Parameters:**

- `stage` (string, optional) — Filter by stage: `"1"`, `"2"`, `"2.7"`, `"3"`, or `"4"` (finished).
- `search` (string, optional) — Filter by name, author, or champion.

### `get_proposal`

Fetch the README (and optionally the spec text) of a TC39 proposal from its GitHub repository.

**Parameters:**

- `name` (string, required) — Proposal name or search term (e.g. `"Temporal"`, `"decorators"`).
- `include_spec` (boolean, optional) — If `true`, also fetch the proposal's `spec.emu` or `spec.html` file. Default: `false`.

### `search_notes`

Search TC39 plenary meeting notes for discussions about a proposal, topic, or delegate. Returns matching agenda item sections with meeting date, presenter, discussion excerpt, and conclusion.

**Parameters:**

- `query` (string, required) — Search term (e.g. `"Temporal"`, `"iterator helpers"`, `"TypedArray concat"`).
- `from_date` (string, optional) — Only search meetings from this date forward, in `YYYY-MM` format.
- `limit` (number, optional) — Maximum results to return. Default: 10.

**Example result:**

```
Found 1 matching section(s) for "TypedArray concat":

### TypedArray Concatenation
Meeting: November 18, 2025 (2025-11)
Presenter: James Snell (JSL)
Conclusion: Conditional stage 1 accepted pending repo creation.
```

### `search_test262`

Search the [tc39/test262](https://github.com/tc39/test262) conformance test suite for existing tests related to a built-in object, method, or feature.

**Parameters:**

- `query` (string, required) — Feature name, built-in, or method path (e.g. `"ArrayBuffer"`, `"TypedArray.prototype.slice"`, `"ArrayBuffer.prototype.transfer"`).
- `limit` (number, optional) — Maximum results to return. Default: 20.

### `get_agenda`

Fetch and parse a TC39 plenary meeting agenda from the [tc39/agendas](https://github.com/tc39/agendas) repository. Returns all proposals with stage, timebox, advancement goals, supporting material links (slides, spec PRs, test262 PRs), and presenter. Also includes short/long discussions and schedule constraints.

**Parameters:**

- `meeting` (string, optional) — Meeting identifier in `YYYY/MM` format (e.g., `"2026/03"`). If omitted, returns the next upcoming meeting.

## Data Sources

| Data | Source | Cache TTL |
|------|--------|-----------|
| Spec section index | [tc39.es/ecma262/multipage/](https://tc39.es/ecma262/multipage/) TOC | 24 hours |
| Spec section content | Individual multipage HTML files | 24 hours |
| Proposals (stages 1–4) | [github.com/tc39/proposals](https://github.com/tc39/proposals) markdown files | 1 hour |
| Proposal READMEs/spec text | Individual proposal GitHub repos | 1 hour |
| Meeting notes | [github.com/tc39/notes](https://github.com/tc39/notes) meeting directories | 24h list, 7d past notes, 1h recent |
| Test262 tests | [github.com/tc39/test262](https://github.com/tc39/test262) directory tree | 6 hours |
| Meeting agendas | [github.com/tc39/agendas](https://github.com/tc39/agendas) markdown files | 15 minutes |

## Setup

### As an MCP client

Add to your MCP client configuration:

```json
{
  "tc39": {
    "type": "remote",
    "url": "https://tc39-spec-mcp.jasnell.workers.dev/mcp",
    "enabled": true
  }
}
```

### Local development

```sh
npm install
npm start
# MCP endpoint: http://localhost:8787/mcp
```

### Deploy

```sh
npx wrangler deploy
```

## Architecture

- **Stateless** — Uses `createMcpHandler` with a per-request server factory (no Durable Objects).
- **No authentication** — All data sources are public.
- **Caching** — Cloudflare Cache API in production, in-memory `Map` fallback for local dev.
- **HTML-to-markdown** — Spec sections are extracted from the multipage HTML and converted to simplified markdown suitable for LLM consumption.
