/**
 * TC39 Spec MCP Server
 *
 * A remote MCP server deployed on Cloudflare Workers that provides tools
 * for searching and reading the ECMA-262 specification and browsing
 * active TC39 proposals.
 *
 * Tools:
 * - search_spec: Search ECMA-262 for abstract operations, types, built-ins
 * - get_spec_section: Fetch a specific spec section as simplified markdown
 * - list_proposals: List TC39 proposals filtered by stage
 * - get_proposal: Fetch a proposal's README and optionally its spec text
 * - search_notes: Search TC39 plenary meeting notes
 * - search_test262: Search the test262 conformance test suite
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createMcpHandler } from "agents/mcp";
import { registerSearchSpec } from "./tools/search-spec.js";
import { registerGetSpecSection } from "./tools/get-section.js";
import { registerListProposals } from "./tools/list-proposals.js";
import { registerGetProposal } from "./tools/get-proposal.js";
import { registerSearchNotes } from "./tools/search-notes.js";
import { registerSearchTest262 } from "./tools/search-test262.js";

function createServer(): McpServer {
  const server = new McpServer({
    name: "tc39-spec-mcp",
    version: "1.0.0",
  });

  registerSearchSpec(server);
  registerGetSpecSection(server);
  registerListProposals(server);
  registerGetProposal(server);
  registerSearchNotes(server);
  registerSearchTest262(server);

  return server;
}

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    // Create a new server instance per request (required by MCP SDK 1.26.0+)
    const server = createServer();
    return createMcpHandler(server)(request, env, ctx);
  },
};
