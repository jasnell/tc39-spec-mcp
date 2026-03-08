/**
 * get_agenda tool: Fetch and parse a TC39 meeting agenda.
 */

import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getAgenda } from "../lib/agenda-parser.js";
import { resolvePresenter } from "../lib/delegates.js";

export const getAgendaSchema = {
  meeting: z
    .string()
    .optional()
    .describe(
      "Meeting identifier in YYYY/MM format (e.g., \"2026/03\"). " +
        "If omitted, fetches the next upcoming meeting's agenda.",
    ),
};

export function registerGetAgenda(server: McpServer) {
  server.tool(
    "get_agenda",
    "Fetch and parse a TC39 plenary meeting agenda from the tc39/agendas " +
      "repository. Returns structured information about proposals scheduled " +
      "for discussion, including stage, timebox, advancement goals, and " +
      "supporting material links. If no meeting is specified, returns the " +
      "next upcoming meeting.",
    getAgendaSchema,
    async ({ meeting }) => {
      try {
        const agenda = await getAgenda(meeting);

        // Collect all unique presenter strings and resolve them in parallel
        const allPresenters = new Set<string>();
        for (const p of agenda.proposals) {
          if (p.presenter) allPresenters.add(p.presenter);
        }
        for (const d of agenda.shortDiscussions) {
          if (d.presenter) allPresenters.add(d.presenter);
        }
        for (const d of agenda.longDiscussions) {
          if (d.presenter) allPresenters.add(d.presenter);
        }

        const presenterEntries = [...allPresenters];
        const resolved = await Promise.all(
          presenterEntries.map((p) => resolvePresenter(p)),
        );
        const presenterMap = new Map<string, string>();
        for (let i = 0; i < presenterEntries.length; i++) {
          presenterMap.set(presenterEntries[i], resolved[i]);
        }
        const rp = (name: string) => presenterMap.get(name) ?? name;

        const parts: string[] = [];

        // Meeting header
        parts.push(`# ${agenda.meeting.title}\n`);
        if (agenda.meeting.dates) {
          parts.push(`**Dates**: ${agenda.meeting.dates}`);
        }
        if (agenda.meeting.location) {
          parts.push(`**Location**: ${agenda.meeting.location}`);
        }
        if (agenda.meeting.host) {
          parts.push(`**Host**: ${agenda.meeting.host}`);
        }
        parts.push("");

        // Proposals
        if (agenda.proposals.length > 0) {
          parts.push("## Proposals\n");
          parts.push(
            "| Stage | Time | Proposal | Advancement | Presenter |",
          );
          parts.push("|:-----:|:----:|----------|-------------|-----------|");

          for (const p of agenda.proposals) {
            const name = p.proposalUrl
              ? `[${p.proposalName}](${p.proposalUrl})`
              : p.proposalName;
            const links = p.supportingLinks
              .map((l) => `[${l.label}](${l.url})`)
              .join(", ");
            const materials = links ? ` (${links})` : "";
            const emoji = p.emoji ? `${p.emoji} ` : "";

            parts.push(
              `| ${p.stage} | ${p.timebox} | ${emoji}${name}${materials} | ${p.advancement || "—"} | ${rp(p.presenter)} |`,
            );
          }
          parts.push("");
        }

        // Short discussions
        if (agenda.shortDiscussions.length > 0) {
          parts.push("## Short Discussions (≤30m)\n");
          parts.push("| Time | Topic | Presenter |");
          parts.push("|:----:|-------|-----------|");
          for (const d of agenda.shortDiscussions) {
            parts.push(
              `| ${d.timebox} | ${d.topic} | ${rp(d.presenter)} |`,
            );
          }
          parts.push("");
        }

        // Long discussions
        if (agenda.longDiscussions.length > 0) {
          parts.push("## Longer Discussions\n");
          parts.push("| Time | Topic | Presenter |");
          parts.push("|:----:|-------|-----------|");
          for (const d of agenda.longDiscussions) {
            parts.push(
              `| ${d.timebox} | ${d.topic} | ${rp(d.presenter)} |`,
            );
          }
          parts.push("");
        }

        // Schedule constraints
        if (agenda.scheduleConstraints.length > 0) {
          parts.push("## Schedule Constraints\n");
          for (const c of agenda.scheduleConstraints) {
            parts.push(c);
          }
          parts.push("");
        }

        // Summary stats
        const totalTimebox = agenda.proposals.reduce((sum, p) => {
          const m = parseInt(p.timebox, 10);
          return sum + (isNaN(m) ? 0 : m);
        }, 0);
        parts.push("## Summary\n");
        parts.push(`- **${agenda.proposals.length}** proposals scheduled`);
        parts.push(
          `- **${totalTimebox}m** total proposal discussion time`,
        );
        parts.push(
          `- **${agenda.shortDiscussions.length}** short discussions`,
        );
        parts.push(
          `- **${agenda.longDiscussions.length}** longer discussions`,
        );
        parts.push(
          `- **${agenda.scheduleConstraints.length}** schedule constraints`,
        );

        return {
          content: [{ type: "text" as const, text: parts.join("\n") }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error fetching agenda: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}
