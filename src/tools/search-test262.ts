/**
 * search_test262 tool: Search the tc39/test262 repository for existing tests
 * related to a built-in, method, or feature.
 */

import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { searchTest262 } from "../lib/test262-index.js";

export const searchTest262Schema = {
  query: z
    .string()
    .describe(
      "Feature name, built-in object, or method path to search for. " +
        'Examples: "ArrayBuffer", "TypedArray.prototype.slice", ' +
        '"ArrayBuffer.prototype.transfer", "%TypedArray%.concat".',
    ),
  limit: z
    .number()
    .optional()
    .default(20)
    .describe("Maximum number of test files to return (default 20)."),
};

export function registerSearchTest262(server: McpServer) {
  server.tool(
    "search_test262",
    "Search the tc39/test262 conformance test suite for existing tests " +
      "related to a built-in object, method, or feature. Returns matching " +
      "test file paths with descriptions and spec section references (esid). " +
      "Useful for understanding existing test coverage before writing new tests.",
    searchTest262Schema,
    async ({ query, limit }) => {
      try {
        const { files, feature, totalFound } = await searchTest262(
          query,
          limit,
        );

        if (files.length === 0 && !feature) {
          return {
            content: [
              {
                type: "text" as const,
                text:
                  `No test262 tests found for "${query}".\n\n` +
                  "This could mean:\n" +
                  "- The feature doesn't have dedicated tests yet\n" +
                  "- The feature uses a different name in test262\n" +
                  "- Tests may be under a parent directory (try a broader query)\n\n" +
                  "Test262 directory structure: `test/built-ins/{BuiltIn}/prototype/{method}/`",
              },
            ],
          };
        }

        if (files.length === 0 && feature) {
          return {
            content: [
              {
                type: "text" as const,
                text:
                  `No test directory found for "${query}", but found a matching ` +
                  `feature flag in features.txt: \`${feature}\`\n\n` +
                  "Tests for this feature may be spread across multiple directories. " +
                  "Try searching for the specific built-in or method name.",
              },
            ],
          };
        }

        const parts: string[] = [];
        parts.push(
          `Found **${totalFound}** test file(s) for "${query}"` +
            (totalFound > files.length
              ? ` (showing first ${files.length}):`
              : ":"),
        );
        parts.push("");

        // Group files by directory for readability
        const byDir = new Map<string, typeof files>();
        for (const file of files) {
          const dir =
            file.path.substring(0, file.path.lastIndexOf("/")) || file.path;
          if (!byDir.has(dir)) byDir.set(dir, []);
          byDir.get(dir)!.push(file);
        }

        for (const [dir, dirFiles] of byDir) {
          parts.push(`### \`${dir}/\``);
          parts.push("");

          for (const file of dirFiles) {
            const line = [`- **\`${file.name}\`**`];

            if (file.description) {
              line.push(`  ${file.description}`);
            }
            if (file.esid) {
              line.push(`  esid: \`${file.esid}\``);
            }
            if (file.features && file.features.length > 0) {
              line.push(
                `  features: ${file.features.map((f) => `\`${f}\``).join(", ")}`,
              );
            }

            parts.push(line.join("\n"));
          }

          parts.push("");
        }

        return {
          content: [{ type: "text" as const, text: parts.join("\n") }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error searching test262: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}
