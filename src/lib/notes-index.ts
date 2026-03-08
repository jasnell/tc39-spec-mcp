/**
 * Fetches and searches TC39 meeting notes from the tc39/notes GitHub repository.
 *
 * Meeting notes are organized as:
 *   meetings/YYYY-MM/month-DD.md
 *
 * Each day's file contains multiple agenda items separated by ## headings.
 * Each section typically has: heading, presenter, discussion, conclusion.
 */

import { cachedFetch } from "./cache.js";

const GITHUB_API = "https://api.github.com/repos/tc39/notes/contents/meetings";
const RAW_BASE =
  "https://raw.githubusercontent.com/tc39/notes/main/meetings";

// Cache TTLs
const MEETINGS_LIST_TTL = 86400; // 24 hours — meeting list changes rarely
const MEETING_FILES_TTL = 86400; // 24 hours — file list within a meeting
const OLD_NOTES_TTL = 604800; // 7 days — past notes are immutable
const RECENT_NOTES_TTL = 3600; // 1 hour — most recent meeting may update

interface MeetingInfo {
  /** Directory name, e.g. "2025-02" */
  id: string;
  year: number;
  month: number;
}

export interface MeetingSection {
  /** Meeting directory, e.g. "2025-02" */
  meeting: string;
  /** Human-readable date derived from filename, e.g. "February 18" */
  date: string;
  /** H2 heading text (agenda item title) */
  heading: string;
  /** Presenter line, if present */
  presenter?: string;
  /** Conclusion subsection text, if present */
  conclusion?: string;
  /** Truncated body text for context */
  excerpt: string;
  /** Link to proposal repo, if referenced */
  proposalUrl?: string;
}

/**
 * Parse a GitHub Contents API JSON response into a list of entries.
 * The API returns an array of objects with name, type, etc.
 */
function parseGitHubContents(
  json: string,
): { name: string; type: string; size?: number }[] {
  try {
    return JSON.parse(json);
  } catch {
    return [];
  }
}

/**
 * Fetch the list of meeting directories, sorted by date descending (most recent first).
 */
async function getMeetingList(): Promise<MeetingInfo[]> {
  const json = await cachedFetch(GITHUB_API, MEETINGS_LIST_TTL);
  const entries = parseGitHubContents(json);

  const meetings: MeetingInfo[] = [];
  for (const entry of entries) {
    if (entry.type !== "dir") continue;
    const match = entry.name.match(/^(\d{4})-(\d{2})$/);
    if (!match) continue;
    meetings.push({
      id: entry.name,
      year: parseInt(match[1], 10),
      month: parseInt(match[2], 10),
    });
  }

  // Sort by date descending (most recent first)
  meetings.sort((a, b) => {
    if (a.year !== b.year) return b.year - a.year;
    return b.month - a.month;
  });

  return meetings;
}

/**
 * Fetch the list of files in a specific meeting directory.
 * Returns only .md files, excluding README.md and toc.md.
 */
async function getMeetingFiles(meetingId: string): Promise<string[]> {
  const url = `${GITHUB_API}/${meetingId}`;
  const json = await cachedFetch(url, MEETING_FILES_TTL);
  const entries = parseGitHubContents(json);

  return entries
    .filter(
      (e) =>
        e.type === "file" &&
        e.name.endsWith(".md") &&
        e.name !== "README.md" &&
        e.name !== "toc.md",
    )
    .map((e) => e.name)
    .sort(); // Sort alphabetically (day order within a meeting)
}

/**
 * Determine if a meeting is "recent" (within the last 2 months).
 * Recent meetings get shorter cache TTLs since notes may still be updated.
 */
function isRecentMeeting(meetingId: string): boolean {
  const match = meetingId.match(/^(\d{4})-(\d{2})$/);
  if (!match) return false;
  const meetingDate = new Date(
    parseInt(match[1], 10),
    parseInt(match[2], 10) - 1,
  );
  const twoMonthsAgo = new Date();
  twoMonthsAgo.setMonth(twoMonthsAgo.getMonth() - 2);
  return meetingDate >= twoMonthsAgo;
}

/**
 * Fetch a specific meeting note file via raw.githubusercontent.com.
 */
async function getMeetingNote(
  meetingId: string,
  file: string,
): Promise<string> {
  const url = `${RAW_BASE}/${meetingId}/${file}`;
  const ttl = isRecentMeeting(meetingId) ? RECENT_NOTES_TTL : OLD_NOTES_TTL;
  return cachedFetch(url, ttl);
}

/**
 * Derive a human-readable date string from a meeting ID and filename.
 * e.g., ("2025-02", "february-18.md") -> "February 18, 2025"
 */
function formatDate(meetingId: string, file: string): string {
  const name = file.replace(".md", "");
  const parts = name.split("-");
  if (parts.length >= 2) {
    const month = parts[0].charAt(0).toUpperCase() + parts[0].slice(1);
    const day = parts.slice(1).join("-"); // Handle edge cases
    const year = meetingId.split("-")[0];
    return `${month} ${day}, ${year}`;
  }
  return meetingId;
}

/**
 * Split a meeting note file into sections at ## (H2) heading boundaries.
 * Extracts metadata from each section: presenter, conclusion, proposal links.
 */
function splitIntoSections(
  content: string,
  meetingId: string,
  file: string,
): MeetingSection[] {
  const sections: MeetingSection[] = [];
  const date = formatDate(meetingId, file);

  // Split at ## headings. The first chunk is the preamble (attendees, etc.)
  const chunks = content.split(/^## /m);

  for (let i = 1; i < chunks.length; i++) {
    const chunk = chunks[i];
    const firstNewline = chunk.indexOf("\n");
    if (firstNewline === -1) continue;

    const heading = chunk.substring(0, firstNewline).trim();

    // Skip administrative headings
    const lowerHeading = heading.toLowerCase();
    if (
      lowerHeading.startsWith("attendees") ||
      lowerHeading.startsWith("opening") ||
      lowerHeading.startsWith("secretariat") ||
      lowerHeading === "end of day" ||
      lowerHeading === "adjournment"
    ) {
      continue;
    }

    // Extract presenter
    let presenter: string | undefined;
    const presenterMatch = chunk.match(
      /Presenter:\s*(.+?)(?:\n|$)/,
    );
    if (presenterMatch) {
      presenter = presenterMatch[1].trim();
    }

    // Extract conclusion
    let conclusion: string | undefined;
    const conclusionMatch = chunk.match(
      /### Conclusion[\s\S]*?\n([\s\S]*?)(?=\n### |\n## |$)/,
    );
    if (conclusionMatch) {
      conclusion = conclusionMatch[1].trim().substring(0, 500);
    }

    // Extract proposal URL
    let proposalUrl: string | undefined;
    const urlMatch = chunk.match(
      /\[proposal\]\(([^)]+)\)/,
    );
    if (urlMatch) {
      proposalUrl = urlMatch[1];
    }

    // Create excerpt: skip the heading, take the first ~800 chars of body
    const body = chunk.substring(firstNewline + 1).trim();
    const excerpt = body.substring(0, 800);

    sections.push({
      meeting: meetingId,
      date,
      heading,
      presenter,
      conclusion,
      excerpt,
      proposalUrl,
    });
  }

  return sections;
}

/**
 * Search TC39 meeting notes for a query string.
 *
 * Searches section headings and body text (case-insensitive) across
 * recent meetings. Returns matching sections with metadata and excerpts.
 *
 * @param query - Search term (proposal name, topic, delegate name)
 * @param fromDate - Only search meetings from this date forward (YYYY-MM format)
 * @param limit - Maximum number of results to return
 * @param maxMeetings - Maximum number of meetings to search (default 12, ~2 years)
 */
export async function searchMeetingNotes(
  query: string,
  fromDate?: string,
  limit: number = 10,
  maxMeetings: number = 12,
): Promise<MeetingSection[]> {
  const meetings = await getMeetingList();

  // Filter by date range
  let filtered = meetings;
  if (fromDate) {
    filtered = meetings.filter((m) => m.id >= fromDate);
  }

  // Limit the number of meetings to search
  const toSearch = filtered.slice(0, maxMeetings);

  const results: MeetingSection[] = [];
  const queryLower = query.toLowerCase();
  // Also split query into words for broader matching
  const queryWords = queryLower
    .split(/[\s-]+/)
    .filter((w) => w.length > 2);

  for (const meeting of toSearch) {
    if (results.length >= limit) break;

    let files: string[];
    try {
      files = await getMeetingFiles(meeting.id);
    } catch {
      continue; // Skip meetings where file listing fails
    }

    for (const file of files) {
      if (results.length >= limit) break;

      try {
        const content = await getMeetingNote(meeting.id, file);
        const sections = splitIntoSections(content, meeting.id, file);

        for (const section of sections) {
          if (results.length >= limit) break;

          // Check if the query matches the heading, presenter, or body
          const headingLower = section.heading.toLowerCase();
          const excerptLower = section.excerpt.toLowerCase();
          const conclusionLower = (section.conclusion || "").toLowerCase();

          const matches =
            headingLower.includes(queryLower) ||
            excerptLower.includes(queryLower) ||
            conclusionLower.includes(queryLower) ||
            // Also check if all significant query words appear in the section
            (queryWords.length > 1 &&
              queryWords.every(
                (w) =>
                  headingLower.includes(w) ||
                  excerptLower.includes(w),
              ));

          if (matches) {
            results.push(section);
          }
        }
      } catch {
        // Skip files that fail to fetch
      }
    }
  }

  return results;
}
