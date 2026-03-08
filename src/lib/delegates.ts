/**
 * Fetches and parses the TC39 delegates list from tc39/notes.
 *
 * The file at delegates.txt contains entries in the format:
 *   Full Name (TLA)
 * One per line. Lines may be blank or comments.
 */

import { cachedFetch } from "./cache.js";

const DELEGATES_URL =
  "https://raw.githubusercontent.com/tc39/notes/main/delegates.txt";

// Delegates list changes infrequently
const DELEGATES_TTL = 86400; // 24 hours

export interface Delegate {
  /** Full name, e.g. "Kevin Gibbons" */
  name: string;
  /** Three-letter abbreviation, e.g. "KG" */
  tla: string;
}

/**
 * Fetch and parse the delegates list. Returns all delegates sorted by name.
 */
async function fetchDelegates(): Promise<Delegate[]> {
  const text = await cachedFetch(DELEGATES_URL, DELEGATES_TTL);
  const delegates: Delegate[] = [];

  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    // Match "Full Name (TLA)" — TLA is 2-4 uppercase letters
    const match = trimmed.match(/^(.+?)\s+\(([A-Z]{2,4})\)\s*$/);
    if (match) {
      delegates.push({
        name: match[1].trim(),
        tla: match[2],
      });
    }
  }

  delegates.sort((a, b) => a.name.localeCompare(b.name));
  return delegates;
}

/**
 * Look up delegates by name, TLA, or partial match.
 *
 * Matching priority:
 * 1. Exact TLA match (case-insensitive)
 * 2. Exact full name match (case-insensitive)
 * 3. Partial name match (case-insensitive substring)
 *
 * @param query - A delegate name, TLA, or partial string
 * @returns Matching delegates, ordered by match quality
 */
export async function lookupDelegate(query: string): Promise<Delegate[]> {
  const delegates = await fetchDelegates();
  const queryLower = query.toLowerCase().trim();

  if (!queryLower) return [];

  // 1. Exact TLA match
  const exactTla = delegates.filter(
    (d) => d.tla.toLowerCase() === queryLower,
  );
  if (exactTla.length > 0) return exactTla;

  // 2. Exact full name match
  const exactName = delegates.filter(
    (d) => d.name.toLowerCase() === queryLower,
  );
  if (exactName.length > 0) return exactName;

  // 3. Partial name match — substring on name or TLA
  const partial = delegates.filter(
    (d) =>
      d.name.toLowerCase().includes(queryLower) ||
      d.tla.toLowerCase().includes(queryLower),
  );

  return partial;
}

/**
 * Return all delegates. Useful for listing/browsing.
 */
export async function listDelegates(): Promise<Delegate[]> {
  return fetchDelegates();
}
