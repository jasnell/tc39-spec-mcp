/**
 * list_proposals tool: List TC39 proposals filtered by stage and/or search term.
 * Data source: https://github.com/tc39/proposals
 */

import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getProposals, type ProposalStage } from "../lib/proposal-parser.js";

export const listProposalsSchema = {
  stage: z
    .enum(["1", "2", "2.7", "3", "4"])
    .optional()
    .describe(
      "Filter by proposal stage. If omitted, returns proposals from all stages (1-4).",
    ),
  search: z
    .string()
    .optional()
    .describe(
      "Optional search term to filter proposals by name, author, or champion.",
    ),
};

export function registerListProposals(server: McpServer) {
  server.tool(
    "list_proposals",
    "List active TC39 proposals from the official tc39/proposals repository. " +
      "Filter by stage (1, 2, 2.7, 3, or 4) and/or search by name, author, " +
      "or champion. Stage 4 proposals are finished and included in the standard.",
    listProposalsSchema,
    async ({ stage, search }) => {
      try {
        const proposals = await getProposals(
          stage as ProposalStage | undefined,
          search,
        );

        if (proposals.length === 0) {
          let msg = "No proposals found";
          if (stage) msg += ` at stage ${stage}`;
          if (search) msg += ` matching "${search}"`;
          msg += ".";
          return {
            content: [{ type: "text" as const, text: msg }],
          };
        }

        // Format as a readable list grouped by stage
        const byStage = new Map<string, typeof proposals>();
        for (const p of proposals) {
          const key = p.stage;
          if (!byStage.has(key)) byStage.set(key, []);
          byStage.get(key)!.push(p);
        }

        const stageOrder = ["3", "2.7", "2", "1", "4"];
        const sections: string[] = [];

        for (const s of stageOrder) {
          const group = byStage.get(s);
          if (!group || group.length === 0) continue;

          const stageName =
            s === "4" ? "Stage 4 (Finished)" : `Stage ${s}`;

          const lines = group.map((p) => {
            const url = p.url ? ` — ${p.url}` : "";
            const author =
              p.author && p.author !== p.champion
                ? `\n  Author: ${p.author}`
                : "";
            const champion = p.champion
              ? `\n  Champion: ${p.champion}`
              : "";
            return `- **${p.name}**${url}${author}${champion}`;
          });

          sections.push(`### ${stageName} (${group.length})\n\n${lines.join("\n\n")}`);
        }

        const header = stage
          ? `TC39 Stage ${stage} proposals`
          : "TC39 proposals (stages 1-4)";
        const searchNote = search ? ` matching "${search}"` : "";
        const text =
          `${header}${searchNote} — ${proposals.length} result(s):\n\n` +
          sections.join("\n\n") +
          "\n\nUse `get_proposal` with a proposal name to fetch its full README.";

        return {
          content: [{ type: "text" as const, text }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error listing proposals: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}
