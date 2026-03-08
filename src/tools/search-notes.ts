/**
 * search_notes tool: Search TC39 meeting notes for discussions about
 * proposals, topics, or delegates.
 */

import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { searchMeetingNotes } from "../lib/notes-index.js";

export const searchNotesSchema = {
  query: z
    .string()
    .describe(
      "Search term — a proposal name, topic, or delegate name. " +
        'Examples: "Temporal", "iterator helpers", "TypedArray concat", "KG".',
    ),
  from_date: z
    .string()
    .optional()
    .describe(
      "Only search meetings from this date forward, in YYYY-MM format. " +
        'Example: "2024-01" to search from January 2024 onward.',
    ),
  limit: z
    .number()
    .optional()
    .default(10)
    .describe("Maximum number of matching sections to return (default 10)."),
};

export function registerSearchNotes(server: McpServer) {
  server.tool(
    "search_notes",
    "Search TC39 plenary meeting notes for discussions about a proposal, " +
      "topic, or delegate. Returns matching agenda item sections with the " +
      "meeting date, presenter, discussion excerpt, and conclusion. " +
      "Searches the tc39/notes repository, covering the most recent ~2 years by default.",
    searchNotesSchema,
    async ({ query, from_date, limit }) => {
      try {
        const results = await searchMeetingNotes(
          query,
          from_date,
          limit,
        );

        if (results.length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text:
                  `No meeting notes found matching "${query}".` +
                  (from_date
                    ? ` (searched from ${from_date} onward)`
                    : " (searched most recent ~2 years)") +
                  "\n\nTry a different search term, or use from_date to expand the range.",
              },
            ],
          };
        }

        const sections = results.map((section) => {
          const parts: string[] = [];
          parts.push(`### ${section.heading}`);
          parts.push(`**Meeting**: ${section.date} (${section.meeting})`);
          if (section.presenter) {
            parts.push(`**Presenter**: ${section.presenter}`);
          }
          if (section.proposalUrl) {
            parts.push(`**Proposal**: ${section.proposalUrl}`);
          }
          if (section.conclusion) {
            parts.push(`\n**Conclusion**: ${section.conclusion}`);
          }

          // Truncate excerpt for readability
          const excerpt =
            section.excerpt.length > 600
              ? section.excerpt.substring(0, 600) + "..."
              : section.excerpt;
          parts.push(`\n${excerpt}`);

          return parts.join("\n");
        });

        const text =
          `Found ${results.length} matching section(s) for "${query}":\n\n` +
          sections.join("\n\n---\n\n");

        return {
          content: [{ type: "text" as const, text }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error searching meeting notes: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}
