/**
 * get_proposal tool: Fetch a TC39 proposal's README and optionally its spec text.
 */

import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  getProposals,
  fetchProposalContent,
} from "../lib/proposal-parser.js";

export const getProposalSchema = {
  name: z
    .string()
    .describe(
      'Proposal name or search term (e.g. "Temporal", "decorators", "iterator-helpers"). ' +
        "Can also be a GitHub repo slug (e.g. \"tc39/proposal-temporal\"). " +
        "The tool will find the best match from the official TC39 proposals list.",
    ),
  include_spec: z
    .boolean()
    .optional()
    .default(false)
    .describe(
      "If true, also attempt to fetch the proposal's spec.emu file (ecmarkup spec text).",
    ),
};

export function registerGetProposal(server: McpServer) {
  server.tool(
    "get_proposal",
    "Fetch the README (and optionally spec text) of a TC39 proposal. " +
      "Searches the official tc39/proposals repository to find the proposal, " +
      "then fetches content from its GitHub repo. Useful for understanding " +
      "a proposal's motivation, API design, and current spec text.",
    getProposalSchema,
    async ({ name, include_spec }) => {
      try {
        // Search across all stages
        const proposals = await getProposals(undefined, name);

        if (proposals.length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: `No proposal found matching "${name}". Use list_proposals to see available proposals.`,
              },
            ],
          };
        }

        // Take the best match (first result from search)
        const proposal = proposals[0];

        if (!proposal.url) {
          return {
            content: [
              {
                type: "text" as const,
                text:
                  `Found proposal "${proposal.name}" (Stage ${proposal.stage}) ` +
                  `but it has no linked repository URL.`,
              },
            ],
          };
        }

        const parts: string[] = [];

        // Header
        parts.push(
          `# ${proposal.name}\n\n` +
            `- **Stage**: ${proposal.stage}\n` +
            `- **Author**: ${proposal.author || "N/A"}\n` +
            `- **Champion**: ${proposal.champion || "N/A"}\n` +
            `- **Repository**: ${proposal.url}\n`,
        );

        // Fetch README
        try {
          const readme = await fetchProposalContent(proposal.url, "README.md");
          parts.push("---\n\n## README\n\n" + readme);
        } catch (err) {
          parts.push(
            `\n---\n\n*Could not fetch README: ${err instanceof Error ? err.message : String(err)}*`,
          );
        }

        // Optionally fetch spec text
        if (include_spec) {
          try {
            const specText = await fetchProposalContent(
              proposal.url,
              "spec.emu",
            );
            parts.push("\n---\n\n## Spec Text (spec.emu)\n\n```html\n" + specText + "\n```");
          } catch {
            // spec.emu might not exist - try spec.html
            try {
              const specHtml = await fetchProposalContent(
                proposal.url,
                "spec.html",
              );
              parts.push(
                "\n---\n\n## Spec Text (spec.html)\n\n```html\n" + specHtml + "\n```",
              );
            } catch {
              parts.push(
                "\n---\n\n*No spec text file found (tried spec.emu and spec.html).*",
              );
            }
          }
        }

        return {
          content: [{ type: "text" as const, text: parts.join("\n") }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error fetching proposal: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}
