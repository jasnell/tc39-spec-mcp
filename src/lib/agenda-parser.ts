/**
 * Fetches and parses TC39 meeting agendas from the tc39/agendas GitHub repository.
 *
 * Agendas are stored as YYYY/MM.md files. Each agenda contains:
 * - Meeting metadata (number, host, dates, location)
 * - Proposals table (stage, timebox, topic with links, presenter)
 * - Other discussion sections (short, long, overflow)
 * - Schedule constraints
 */

import { cachedFetch } from "./cache.js";

const GITHUB_API_BASE =
  "https://api.github.com/repos/tc39/agendas/contents";
const RAW_BASE =
  "https://raw.githubusercontent.com/tc39/agendas/main";

// Short TTLs — agendas are actively edited before meetings
const DIR_LISTING_TTL = 3600; // 1 hour
const AGENDA_TTL = 900; // 15 minutes — agendas change frequently before meetings

export interface AgendaMeeting {
  /** e.g. "113th meeting of Ecma TC39" */
  title: string;
  /** e.g. "2026-03" */
  id: string;
  host?: string;
  dates?: string;
  location?: string;
}

export interface AgendaProposal {
  stage: string;
  timebox: string;
  topic: string;
  /** Proposal name extracted from the link */
  proposalName: string;
  /** URL to the proposal repo */
  proposalUrl?: string;
  /** What advancement is being sought, e.g. "for Stage 2", "update", "withdraw" */
  advancement?: string;
  /** Links to slides, spec PRs, etc. */
  supportingLinks: { label: string; url: string }[];
  presenter: string;
  /** Emoji prefixes (⌛️, ❄️, 🔒, 🔁) */
  emoji?: string;
}

export interface AgendaDiscussion {
  timebox: string;
  topic: string;
  presenter: string;
}

export interface ParsedAgenda {
  meeting: AgendaMeeting;
  proposals: AgendaProposal[];
  shortDiscussions: AgendaDiscussion[];
  longDiscussions: AgendaDiscussion[];
  scheduleConstraints: string[];
  /** Raw markdown content */
  raw: string;
}

/**
 * Parse a GitHub Contents API JSON response.
 */
function parseGitHubContents(
  json: string,
): { name: string; type: string }[] {
  try {
    return JSON.parse(json);
  } catch {
    return [];
  }
}

/**
 * Find the next upcoming meeting by listing agenda files.
 * Returns the meeting ID in YYYY/MM format, or null if none found.
 */
export async function findNextMeeting(): Promise<string | null> {
  const now = new Date();
  const currentYear = now.getFullYear();

  // Check current year and next year
  for (const year of [currentYear, currentYear + 1]) {
    try {
      const url = `${GITHUB_API_BASE}/${year}`;
      const json = await cachedFetch(url, DIR_LISTING_TTL);
      const entries = parseGitHubContents(json);

      const agendaFiles = entries
        .filter(
          (e) => e.type === "file" && /^\d{2}\.md$/.test(e.name),
        )
        .map((e) => ({
          year,
          month: parseInt(e.name.replace(".md", ""), 10),
          id: `${year}/${e.name.replace(".md", "")}`,
        }))
        .sort((a, b) => a.month - b.month);

      for (const meeting of agendaFiles) {
        // Consider a meeting "upcoming" if it's in the current month or later
        const meetingDate = new Date(meeting.year, meeting.month - 1, 28);
        if (meetingDate >= now) {
          return meeting.id;
        }
      }
    } catch {
      // Year directory might not exist yet
    }
  }

  return null;
}

/**
 * Fetch the raw markdown content of an agenda file.
 * @param meetingId - Meeting ID in YYYY/MM format (e.g., "2026/03")
 */
async function fetchAgendaRaw(meetingId: string): Promise<string> {
  const url = `${RAW_BASE}/${meetingId}.md`;
  return cachedFetch(url, AGENDA_TTL);
}

/**
 * Parse meeting metadata from the agenda header.
 */
function parseMeetingInfo(
  markdown: string,
  meetingId: string,
): AgendaMeeting {
  const meeting: AgendaMeeting = {
    title: "",
    id: meetingId,
  };

  // Title: "# Agenda for the 113th meeting of Ecma TC39"
  const titleMatch = markdown.match(
    /^# (.+)$/m,
  );
  if (titleMatch) {
    meeting.title = titleMatch[1].trim();
  }

  // Host — matches both "**Host**: X" and "- **Host**: X"
  const hostMatch = markdown.match(
    /^-?\s*\*\*Host\*\*:\s*(.+)$/m,
  );
  if (hostMatch) {
    meeting.host = hostMatch[1].trim();
  }

  // Location — matches both "**Location**: X" and "- **Location**: X"
  const locationMatch = markdown.match(
    /^-?\s*\*\*Location\*\*:\s*(.+)$/m,
  );
  if (locationMatch) {
    meeting.location = locationMatch[1].trim();
  }

  // Dates — the header may be "**Dates and times**:" or "- **Dates and times**:"
  // followed by indented list items with individual day entries
  const datesMatch = markdown.match(
    /^-?\s*\*\*Dates and times\*\*:\s*\n([\s\S]*?)(?=^-?\s*\*\*|\n\n)/m,
  );
  if (datesMatch) {
    const dateLines = datesMatch[1]
      .split("\n")
      .map((l) => l.replace(/^\s*-\s*/, "").trim())
      .filter(Boolean);
    meeting.dates = dateLines.join("; ");
  }

  return meeting;
}

/**
 * Parse a proposals table from the agenda.
 * The table has columns: stage | timebox | topic | presenter
 */
function parseProposalsTable(tableSection: string): AgendaProposal[] {
  const proposals: AgendaProposal[] = [];
  const lines = tableSection.split("\n");

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("|")) continue;

    // Skip separator rows (|:---:|...) and header rows (| stage | timebox |...)
    if (/^[|\s:-]+$/.test(trimmed)) continue;

    const cells = trimmed
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map((c) => c.trim());

    if (cells.length < 4) continue;

    const stage = cells[0].trim();
    const timebox = cells[1].trim();
    const topicRaw = cells[2].trim();
    const presenter = cells[3].trim();

    // Skip header rows where the first cell is literally "stage"
    if (stage === "stage" || !stage) continue;

    // Parse the topic cell
    const parsed = parseTopicCell(topicRaw);

    proposals.push({
      stage,
      timebox,
      topic: topicRaw,
      proposalName: parsed.name,
      proposalUrl: parsed.url,
      advancement: parsed.advancement,
      supportingLinks: parsed.links,
      presenter,
      emoji: parsed.emoji,
    });
  }

  return proposals;
}

/**
 * Parse a discussion table (timebox | topic | presenter).
 */
function parseDiscussionTable(
  tableSection: string,
): AgendaDiscussion[] {
  const items: AgendaDiscussion[] = [];
  const lines = tableSection.split("\n");

  for (const line of lines) {
    const trimmed = line.trim();
    if (
      !trimmed.startsWith("|") ||
      trimmed.includes("timebox") ||
      trimmed.includes("---")
    ) {
      continue;
    }

    const cells = trimmed
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map((c) => c.trim());

    if (cells.length < 3) continue;
    if (!cells[0] || cells[0] === "timebox") continue;

    items.push({
      timebox: cells[0].trim(),
      topic: cells[1].trim(),
      presenter: cells[2].trim(),
    });
  }

  return items;
}

/**
 * Parse the topic cell of a proposals table row.
 * Extracts: emoji prefix, proposal name+url, advancement text, supporting links.
 */
function parseTopicCell(cell: string): {
  emoji?: string;
  name: string;
  url?: string;
  advancement?: string;
  links: { label: string; url: string }[];
} {
  let remaining = cell;

  // Extract emoji prefix
  let emoji: string | undefined;
  const emojiMatch = remaining.match(/^([⌛️❄️🔒🔁]+)\s*/);
  if (emojiMatch) {
    emoji = emojiMatch[1];
    remaining = remaining.substring(emojiMatch[0].length);
  }

  // Extract the primary proposal link: [Name](url)
  let name = remaining;
  let url: string | undefined;
  const linkMatch = remaining.match(/\[([^\]]+)\]\(([^)]+)\)/);
  if (linkMatch) {
    name = linkMatch[1];
    url = linkMatch[2];
  }

  // Extract advancement text: "for Stage N", "update", "withdraw", etc.
  let advancement: string | undefined;
  const advMatch = remaining.match(
    /(?:for\s+Stage\s+[\d.]+(?:\s+or\s+[\d.]+)*|(?:Stage\s+\d+\s+)?(?:Status\s+)?[Uu]pdate|[Ww]ithdraw\w*|Conditional\s+Stage\s+\d+)/i,
  );
  if (advMatch) {
    advancement = advMatch[0];
  }

  // Extract all parenthesized link groups: ([slides](...), [spec PR](...))
  const links: { label: string; url: string }[] = [];
  const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
  let match;
  let first = true;
  while ((match = linkRegex.exec(remaining)) !== null) {
    if (first) {
      first = false;
      continue; // Skip the primary proposal link
    }
    links.push({ label: match[1], url: match[2] });
  }

  return { emoji, name, url, advancement, links };
}

/**
 * Parse schedule constraints from the agenda.
 */
function parseScheduleConstraints(markdown: string): string[] {
  const constraints: string[] = [];

  // Find the Normal Constraints section
  const normalMatch = markdown.match(
    /#### Normal Constraints\s*\n(?:<!--[^>]*-->\s*\n)*([\s\S]*?)(?=####|$)/,
  );
  if (normalMatch) {
    const lines = normalMatch[1]
      .split("\n")
      .map((l) => l.trim())
      .filter(
        (l) => l.startsWith("-") && !l.startsWith("<!--"),
      );
    constraints.push(...lines);
  }

  // Find Late-breaking constraints
  const lateMatch = markdown.match(
    /#### Late-breaking Schedule Constraints\s*\n(?:<!--[^>]*-->\s*\n)*([\s\S]*?)$/,
  );
  if (lateMatch) {
    const lines = lateMatch[1]
      .split("\n")
      .map((l) => l.trim())
      .filter(
        (l) => l.startsWith("-") && !l.startsWith("<!--"),
      );
    constraints.push(...lines);
  }

  return constraints;
}

/**
 * Fetch and parse a TC39 meeting agenda.
 *
 * @param meetingId - Meeting ID in YYYY/MM format (e.g., "2026/03").
 *                    If omitted, finds the next upcoming meeting.
 */
export async function getAgenda(
  meetingId?: string,
): Promise<ParsedAgenda> {
  // Resolve meeting ID
  let id = meetingId;
  if (!id) {
    const next = await findNextMeeting();
    if (!next) {
      throw new Error(
        "Could not determine the next upcoming TC39 meeting. " +
          "Provide a meeting ID in YYYY/MM format.",
      );
    }
    id = next;
  }

  const raw = await fetchAgendaRaw(id);
  const meeting = parseMeetingInfo(raw, id);

  // Find and parse the Proposals section.
  // Capture everything after "N. Proposals" until the next top-level numbered item.
  // Note: /m makes ^ match start-of-line, but also makes $ match end-of-line,
  // so we must NOT use $ as a fallback — it would match immediately with [\s\S]*?.
  const proposalsMatch = raw.match(
    /^\d+\.\s+Proposals\s*\n([\s\S]*?)(?=^\d+\.\s+\S)/m,
  );
  const proposals = proposalsMatch
    ? parseProposalsTable(proposalsMatch[1])
    : [];

  // Find and parse Short Discussions
  const shortMatch = raw.match(
    /^\d+\.\s+Short.*?Timeboxed Discussions\s*\n([\s\S]*?)(?=^\d+\.\s+\S)/m,
  );
  const shortDiscussions = shortMatch
    ? parseDiscussionTable(shortMatch[1])
    : [];

  // Find and parse Longer Discussions
  const longMatch = raw.match(
    /^\d+\.\s+Longer or open-ended discussions\s*\n([\s\S]*?)(?=^\d+\.\s+\S)/m,
  );
  const longDiscussions = longMatch
    ? parseDiscussionTable(longMatch[1])
    : [];

  // Parse schedule constraints
  const scheduleConstraints = parseScheduleConstraints(raw);

  return {
    meeting,
    proposals,
    shortDiscussions,
    longDiscussions,
    scheduleConstraints,
    raw,
  };
}
