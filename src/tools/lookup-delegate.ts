/**
 * lookup_delegate tool: Look up TC39 delegates by name, TLA, or partial match.
 */

import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { lookupDelegate, formatDelegate } from "../lib/delegates.js";

export const lookupDelegateSchema = {
  query: z
    .string()
    .describe(
      "Delegate name, TLA (three-letter abbreviation), or partial match. " +
        'Examples: "KG", "Kevin Gibbons", "gibbons", "JHD".',
    ),
};

export function registerLookupDelegate(server: McpServer) {
  server.tool(
    "lookup_delegate",
    "Look up a TC39 delegate by name, TLA (three-letter abbreviation), or " +
      "partial match. Returns the delegate's full name and TLA. Useful for " +
      "resolving abbreviations found in meeting notes transcripts.",
    lookupDelegateSchema,
    async ({ query }) => {
      try {
        const matches = await lookupDelegate(query);

        if (matches.length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text:
                  `No delegates found matching "${query}". ` +
                  "Try a different name, TLA, or partial match.",
              },
            ],
          };
        }

        const lines = matches.map(
          (d) => `- ${formatDelegate(d)}`,
        );

        const text =
          matches.length === 1
            ? `Found delegate: ${formatDelegate(matches[0])}`
            : `Found ${matches.length} matching delegate(s) for "${query}":\n\n` +
              lines.join("\n");

        return {
          content: [{ type: "text" as const, text }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error looking up delegate: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}
