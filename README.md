# tc39-spec-mcp

A remote [MCP](https://modelcontextprotocol.io/) server for searching and reading the [ECMA-262](https://tc39.es/ecma262/) specification and browsing active [TC39 proposals](https://github.com/tc39/proposals).

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

## Data Sources

| Data | Source | Cache TTL |
|------|--------|-----------|
| Spec section index | [tc39.es/ecma262/multipage/](https://tc39.es/ecma262/multipage/) TOC | 24 hours |
| Spec section content | Individual multipage HTML files | 24 hours |
| Proposals (stages 1–4) | [github.com/tc39/proposals](https://github.com/tc39/proposals) markdown files | 1 hour |
| Proposal READMEs/spec text | Individual proposal GitHub repos | 1 hour |

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
