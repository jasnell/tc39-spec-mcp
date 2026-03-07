/**
 * search_spec tool: Search the ECMA-262 spec for abstract operations,
 * types, built-in objects, etc. by name or keyword.
 */

import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { searchSpecIndex } from "../lib/spec-index.js";

export const searchSpecSchema = {
  query: z
    .string()
    .describe(
      'Search query. Can be an abstract operation name (e.g. "ValidateTypedArray"), ' +
        'a built-in object (e.g. "ArrayBuffer"), a section ID (e.g. "sec-arraybuffer-objects"), ' +
        'or a section number (e.g. "25.1").',
    ),
  limit: z
    .number()
    .optional()
    .default(15)
    .describe("Maximum number of results to return (default 15)."),
};

export function registerSearchSpec(server: McpServer) {
  server.tool(
    "search_spec",
    "Search the ECMA-262 (ECMAScript) specification for sections by name, " +
      "abstract operation, built-in object, or section number. Returns matching " +
      "section titles, IDs, and URLs.",
    searchSpecSchema,
    async ({ query, limit }) => {
      try {
        const results = await searchSpecIndex(query, limit);

        if (results.length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: `No spec sections found matching "${query}".`,
              },
            ],
          };
        }

        const lines = results.map((entry) => {
          const num = entry.number ? `${entry.number} ` : "";
          return `- **${num}${entry.title}**\n  ID: \`${entry.id}\`\n  URL: ${entry.url}`;
        });

        const text =
          `Found ${results.length} matching section(s) for "${query}":\n\n` +
          lines.join("\n\n") +
          "\n\nUse `get_spec_section` with a section ID to fetch the full content.";

        return {
          content: [{ type: "text" as const, text }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error searching spec: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}
