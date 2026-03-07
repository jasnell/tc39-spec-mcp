/**
 * get_spec_section tool: Fetch a specific ECMA-262 spec section by its ID
 * and return it as simplified markdown.
 */

import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { searchSpecIndex } from "../lib/spec-index.js";
import { getSpecSection } from "../lib/spec-parser.js";

export const getSpecSectionSchema = {
  section_id: z
    .string()
    .describe(
      'The section ID to fetch (e.g. "sec-arraybuffer-objects", "sec-validatetypedarray"). ' +
        'Use search_spec to find the correct section ID. The "sec-" prefix is optional.',
    ),
};

export function registerGetSpecSection(server: McpServer) {
  server.tool(
    "get_spec_section",
    "Fetch the full content of a specific ECMA-262 spec section by its ID. " +
      "Returns the section text converted to simplified markdown, including " +
      "algorithm steps, parameters, and cross-references. Use search_spec " +
      "first to find the correct section ID.",
    getSpecSectionSchema,
    async ({ section_id }) => {
      try {
        // Normalize the section ID
        let id = section_id.trim();
        if (!id.startsWith("sec-") && !id.startsWith("table-")) {
          id = `sec-${id}`;
        }

        // Look up which page file contains this section
        const results = await searchSpecIndex(id, 5);

        // Try exact match first
        let entry = results.find((e) => e.id === id);

        // If no exact match, try the original input
        if (!entry) {
          entry = results.find((e) => e.id === section_id.trim());
        }

        // If still no match, try the first result
        if (!entry && results.length > 0) {
          entry = results[0];
        }

        if (!entry) {
          return {
            content: [
              {
                type: "text" as const,
                text:
                  `Section "${section_id}" not found in the spec index. ` +
                  `Use search_spec to find the correct section ID.`,
              },
            ],
          };
        }

        const markdown = await getSpecSection(entry.pageFile, entry.id);

        const header =
          `## ${entry.number ? entry.number + " " : ""}${entry.title}\n` +
          `Section ID: \`${entry.id}\`\n` +
          `URL: ${entry.url}\n\n---\n\n`;

        return {
          content: [{ type: "text" as const, text: header + markdown }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error fetching spec section: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}
