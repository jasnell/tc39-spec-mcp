/**
 * Fetches and parses TC39 proposal data from the canonical proposals repo.
 * Source: https://github.com/tc39/proposals
 *
 * The proposals are stored in markdown files with tables:
 * - README.md: Stage 2, 2.7, 3 proposals
 * - stage-1-proposals.md: Stage 1 proposals
 * - finished-proposals.md: Stage 4 (finished) proposals
 */

import { cachedFetch } from "./cache.js";

const RAW_BASE =
  "https://raw.githubusercontent.com/tc39/proposals/main";
const PROPOSALS_TTL = 3600; // 1 hour

export type ProposalStage = "1" | "2" | "2.7" | "3" | "4";

export interface Proposal {
  /** Proposal name/title */
  name: string;
  /** URL to the proposal repo */
  url: string | null;
  /** Author(s) */
  author: string;
  /** Champion(s) */
  champion: string;
  /** Current stage */
  stage: ProposalStage;
}

/**
 * Resolve the links in a markdown document.
 *
 * The proposals markdown uses reference-style links like:
 *   [Temporal][temporal]
 *   ...
 *   [temporal]: https://github.com/tc39/proposal-temporal
 *
 * Returns a map of lowercased label → URL.
 */
function resolveRefLinks(markdown: string): Map<string, string> {
  const links = new Map<string, string>();
  const refRegex = /^\[([^\]]+)\]:\s*(.+)$/gm;
  let match;
  while ((match = refRegex.exec(markdown)) !== null) {
    links.set(match[1].toLowerCase(), match[2].trim());
  }
  return links;
}

/**
 * Parse a markdown table row into cells.
 * Handles the pipe-delimited format: | cell1 | cell2 | cell3 |
 */
function parseTableRow(row: string): string[] {
  // Remove leading/trailing pipes and split
  const trimmed = row.replace(/^\|/, "").replace(/\|$/, "");
  return trimmed.split("|").map((cell) => cell.trim());
}

/**
 * Extract proposal URL from a cell that may contain markdown links.
 * Handles both inline links [text](url) and reference links [text][ref].
 */
function extractLink(
  cell: string,
  refLinks: Map<string, string>,
): { name: string; url: string | null } {
  // Inline link: [text](url)
  const inlineMatch = cell.match(/\[([^\]]+)\]\(([^)]+)\)/);
  if (inlineMatch) {
    return { name: cleanName(inlineMatch[1]), url: inlineMatch[2] };
  }

  // Reference link: [text][ref]
  const refMatch = cell.match(/\[([^\]]+)\]\[([^\]]+)\]/);
  if (refMatch) {
    const url = refLinks.get(refMatch[2].toLowerCase()) || null;
    return { name: cleanName(refMatch[1]), url };
  }

  // Reference link shorthand: [text][]
  const shortRefMatch = cell.match(/\[([^\]]+)\]\[\]/);
  if (shortRefMatch) {
    const url = refLinks.get(shortRefMatch[1].toLowerCase()) || null;
    return { name: cleanName(shortRefMatch[1]), url };
  }

  // Just plain text
  return { name: cleanName(cell), url: null };
}

function cleanName(name: string): string {
  // Remove backticks and extra whitespace
  return name.replace(/`/g, "").trim();
}

/**
 * Clean up HTML/markdown formatting from cell content.
 * Proposal tables sometimes contain <br />, <sub>, etc.
 */
function cleanCell(cell: string): string {
  return cell
    .replace(/<br\s*\/?>/g, ", ")
    .replace(/<sub>/g, "")
    .replace(/<\/sub>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&#8209;/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Parse proposals from a markdown table.
 * Tables have the format:
 *   | Proposal | Author | Champion | ... |
 *   | -------- | ------ | -------- | --- |
 *   | [Name][ref] | Author | Champion | ... |
 */
function parseProposalTable(
  markdown: string,
  stage: ProposalStage,
  refLinks: Map<string, string>,
): Proposal[] {
  const proposals: Proposal[] = [];
  const lines = markdown.split("\n");
  let inTable = false;
  let headerParsed = false;
  let proposalCol = 0;
  let authorCol = 1;
  let championCol = 2;

  for (const line of lines) {
    const trimmed = line.trim();

    // Detect table start (header row)
    if (trimmed.startsWith("|") && trimmed.includes("Proposal")) {
      inTable = true;
      headerParsed = false;

      // Determine column indices from header
      const headers = parseTableRow(trimmed).map((h) => h.toLowerCase());
      proposalCol = headers.findIndex((h) => h.includes("proposal"));
      authorCol = headers.findIndex((h) => h.includes("author"));
      championCol = headers.findIndex((h) => h.includes("champion"));

      if (proposalCol === -1) proposalCol = 0;
      if (authorCol === -1) authorCol = 1;
      if (championCol === -1) championCol = 2;

      continue;
    }

    // Skip separator row
    if (inTable && !headerParsed && /^\|[\s-:|]+\|$/.test(trimmed)) {
      headerParsed = true;
      continue;
    }

    // Parse data row
    if (inTable && headerParsed && trimmed.startsWith("|")) {
      const cells = parseTableRow(trimmed);
      if (cells.length <= proposalCol) {
        inTable = false;
        continue;
      }

      const proposalCell = cleanCell(cells[proposalCol] || "");
      const { name, url } = extractLink(proposalCell, refLinks);

      if (!name || name.startsWith("---")) continue;

      const author = cleanCell(cells[authorCol] || "");
      const champion = cleanCell(cells[championCol] || "");

      proposals.push({ name, url, author, champion, stage });
    } else if (inTable && headerParsed && !trimmed.startsWith("|")) {
      // End of table
      inTable = false;
      headerParsed = false;
    }
  }

  return proposals;
}

/**
 * Fetch and parse the README.md which contains Stage 2, 2.7, and 3 proposals.
 * The README has three tables under ### Stage 3, ### Stage 2.7, ### Stage 2 headings.
 */
async function parseActiveProposals(): Promise<Proposal[]> {
  const url = `${RAW_BASE}/README.md`;
  const markdown = await cachedFetch(url, PROPOSALS_TTL);
  const refLinks = resolveRefLinks(markdown);

  const proposals: Proposal[] = [];

  // Split by stage headings
  const stage3Match = markdown.match(
    /###\s+Stage\s+3\s*\n([\s\S]*?)(?=###\s+Stage\s+2\.7|$)/,
  );
  const stage27Match = markdown.match(
    /###\s+Stage\s+2\.7\s*\n([\s\S]*?)(?=###\s+Stage\s+2(?!\.)[\s\n]|$)/,
  );
  const stage2Match = markdown.match(
    /###\s+Stage\s+2\s*\n([\s\S]*?)(?=##[^#]|$)/,
  );

  if (stage3Match) {
    proposals.push(...parseProposalTable(stage3Match[1], "3", refLinks));
  }
  if (stage27Match) {
    proposals.push(...parseProposalTable(stage27Match[1], "2.7", refLinks));
  }
  if (stage2Match) {
    proposals.push(...parseProposalTable(stage2Match[1], "2", refLinks));
  }

  return proposals;
}

/**
 * Fetch and parse stage-1-proposals.md.
 */
async function parseStage1Proposals(): Promise<Proposal[]> {
  const url = `${RAW_BASE}/stage-1-proposals.md`;
  const markdown = await cachedFetch(url, PROPOSALS_TTL);
  const refLinks = resolveRefLinks(markdown);
  return parseProposalTable(markdown, "1", refLinks);
}

/**
 * Fetch and parse finished-proposals.md (stage 4).
 */
async function parseFinishedProposals(): Promise<Proposal[]> {
  const url = `${RAW_BASE}/finished-proposals.md`;
  const markdown = await cachedFetch(url, PROPOSALS_TTL);
  const refLinks = resolveRefLinks(markdown);
  return parseProposalTable(markdown, "4", refLinks);
}

/** Get all proposals for a specific stage, or all stages if not specified. */
export async function getProposals(
  stage?: ProposalStage,
  search?: string,
): Promise<Proposal[]> {
  let proposals: Proposal[];

  if (stage) {
    switch (stage) {
      case "1":
        proposals = await parseStage1Proposals();
        break;
      case "2":
      case "2.7":
      case "3": {
        const active = await parseActiveProposals();
        proposals = active.filter((p) => p.stage === stage);
        break;
      }
      case "4":
        proposals = await parseFinishedProposals();
        break;
      default:
        proposals = [];
    }
  } else {
    // Fetch all stages in parallel
    const [active, stage1, finished] = await Promise.all([
      parseActiveProposals(),
      parseStage1Proposals(),
      parseFinishedProposals(),
    ]);
    proposals = [...active, ...stage1, ...finished];
  }

  // Apply search filter
  if (search) {
    const lower = search.toLowerCase();
    proposals = proposals.filter(
      (p) =>
        p.name.toLowerCase().includes(lower) ||
        p.author.toLowerCase().includes(lower) ||
        p.champion.toLowerCase().includes(lower) ||
        (p.url && p.url.toLowerCase().includes(lower)),
    );
  }

  return proposals;
}

/**
 * Resolve a proposal's GitHub repo URL to fetch its README or spec text.
 * Tries common branch names: main, master.
 */
export async function fetchProposalContent(
  repoUrl: string,
  file: string = "README.md",
): Promise<string> {
  // Convert GitHub repo URL to raw content URL
  // https://github.com/tc39/proposal-temporal → raw.githubusercontent.com/tc39/proposal-temporal/main/README.md
  const match = repoUrl.match(
    /github\.com\/([^/]+\/[^/]+)/,
  );
  if (!match) {
    throw new Error(`Cannot parse GitHub URL: ${repoUrl}`);
  }

  const repoPath = match[1];

  // Try main branch first, then master
  for (const branch of ["main", "master"]) {
    const rawUrl = `https://raw.githubusercontent.com/${repoPath}/${branch}/${file}`;
    try {
      return await cachedFetch(rawUrl, PROPOSALS_TTL);
    } catch {
      // Try next branch
    }
  }

  throw new Error(
    `Could not fetch ${file} from ${repoUrl} (tried main and master branches)`,
  );
}
