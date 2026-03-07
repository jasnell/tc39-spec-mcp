/**
 * Builds and queries an index of ECMA-262 spec sections from the multipage TOC.
 *
 * The multipage spec at https://tc39.es/ecma262/multipage/ has a table of contents
 * page that links to individual HTML files. Each link has an href like
 * "indexed-collections.html#sec-array-objects". We parse this to build a map of
 * section IDs to their page file, title, and section number.
 */

import { cachedFetch } from "./cache.js";

const MULTIPAGE_BASE = "https://tc39.es/ecma262/multipage/";
const TOC_URL = MULTIPAGE_BASE;
const TOC_TTL = 86400; // 24 hours

export interface SpecSectionEntry {
  /** Section ID, e.g. "sec-array-objects" */
  id: string;
  /** Human-readable title, e.g. "Array Objects" */
  title: string;
  /** Section number, e.g. "23.1" */
  number: string;
  /** Page file within the multipage spec, e.g. "indexed-collections.html" */
  pageFile: string;
  /** Full URL to the section */
  url: string;
}

let cachedIndex: SpecSectionEntry[] | null = null;
let cachedIndexTime = 0;
const INDEX_MEMORY_TTL = 300_000; // 5 minutes in-memory

/**
 * Parse the multipage TOC HTML to extract section entries.
 *
 * TOC links look like:
 *   <a href="scope.html#sec-scope" title="Scope"><span class="secnum">1</span> Scope</a>
 *   <a href="abstract-operations.html#sec-toprimitive" title="..."><span class="secnum">7.1.1</span> ToPrimitive ( ... )</a>
 *
 * The <a> content contains a <span class="secnum"> with the number, followed by the title text.
 */
function parseToc(html: string): SpecSectionEntry[] {
  const entries: SpecSectionEntry[] = [];
  const seen = new Set<string>();

  // Match TOC links with inner HTML content (including <span> tags)
  const linkRegex =
    /<a\s+href="([^"#]+\.html)#([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;

  let match: RegExpExecArray | null;
  while ((match = linkRegex.exec(html)) !== null) {
    const pageFile = match[1];
    const id = match[2];
    const innerHtml = match[3];

    // Skip duplicates
    if (seen.has(id)) continue;
    seen.add(id);

    // Extract section number from <span class="secnum">...</span>
    const secnumMatch = innerHtml.match(
      /<span class="secnum">([\d.]+)<\/span>/,
    );
    const number = secnumMatch ? secnumMatch[1] : "";

    // Extract title: strip all HTML tags from inner content
    let title = innerHtml
      .replace(/<[^>]+>/g, "")
      .trim();

    // If the title starts with the section number, remove it
    if (number && title.startsWith(number)) {
      title = title.slice(number.length).trim();
    }

    if (!title) continue;

    entries.push({
      id,
      title: decodeHtmlEntities(title),
      number,
      pageFile,
      url: `${MULTIPAGE_BASE}${pageFile}#${id}`,
    });
  }

  return entries;
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#8209;/g, "-")
    .replace(/&nbsp;/g, " ");
}

/** Get the full spec section index. Cached in memory and via Cache API. */
export async function getSpecIndex(): Promise<SpecSectionEntry[]> {
  // Check in-memory cache first
  if (cachedIndex && Date.now() - cachedIndexTime < INDEX_MEMORY_TTL) {
    return cachedIndex;
  }

  const html = await cachedFetch(TOC_URL, TOC_TTL);
  const entries = parseToc(html);

  cachedIndex = entries;
  cachedIndexTime = Date.now();

  return entries;
}

/**
 * Search the spec index for sections matching a query.
 * Matches against section IDs, titles, and section numbers.
 */
export async function searchSpecIndex(
  query: string,
  limit = 20,
): Promise<SpecSectionEntry[]> {
  const index = await getSpecIndex();
  const lower = query.toLowerCase();

  // Score each entry for relevance
  const scored = index
    .map((entry) => {
      let score = 0;
      const titleLower = entry.title.toLowerCase();
      const idLower = entry.id.toLowerCase();

      // Exact title match
      if (titleLower === lower) score += 100;
      // ID exact match (with or without "sec-" prefix)
      if (idLower === lower || idLower === `sec-${lower}`) score += 100;
      // Title starts with query
      if (titleLower.startsWith(lower)) score += 50;
      // Title contains query as a word boundary
      if (new RegExp(`\\b${escapeRegex(lower)}\\b`).test(titleLower))
        score += 30;
      // ID contains query
      if (idLower.includes(lower.replace(/\s+/g, "-"))) score += 25;
      // Title contains query anywhere
      if (titleLower.includes(lower)) score += 10;
      // Section number match
      if (entry.number === query) score += 80;
      if (entry.number.startsWith(query)) score += 20;

      return { entry, score };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return scored.map((s) => s.entry);
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
