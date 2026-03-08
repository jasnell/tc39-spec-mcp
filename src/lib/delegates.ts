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

/**
 * Format a delegate in the canonical display format: "Full Name (TLA)".
 */
export function formatDelegate(delegate: Delegate): string {
  return `${delegate.name} (${delegate.tla})`;
}

/**
 * Resolve a presenter string to canonical "Full Name (TLA)" format.
 *
 * Handles common patterns found in meeting notes and agendas:
 * - Already canonical: "Kevin Gibbons (KG)" → returned as-is
 * - Name only: "Kevin Gibbons" → resolved to "Kevin Gibbons (KG)"
 * - TLA only: "KG" → resolved to "Kevin Gibbons (KG)"
 * - Comma-separated list: "KG, JHD" → each resolved individually
 *
 * If resolution fails for a name, the original text is kept unchanged.
 */
export async function resolvePresenter(presenter: string): Promise<string> {
  if (!presenter || !presenter.trim()) return presenter;

  // Already in "Name (TLA)" format? Return as-is.
  if (/^.+\s+\([A-Z]{2,4}\)$/.test(presenter.trim())) {
    return presenter.trim();
  }

  // Handle comma-separated lists (e.g., "KG, JHD" or "Kevin Gibbons, Jordan Harband")
  if (presenter.includes(",")) {
    const parts = presenter.split(",").map((p) => p.trim());
    const resolved = await Promise.all(parts.map((p) => resolveSingle(p)));
    return resolved.join(", ");
  }

  // Handle " and "-separated lists (e.g., "KG and JHD")
  if (/\band\b/i.test(presenter)) {
    const parts = presenter.split(/\band\b/i).map((p) => p.trim());
    const resolved = await Promise.all(parts.map((p) => resolveSingle(p)));
    return resolved.join(" and ");
  }

  return resolveSingle(presenter);
}

/**
 * Resolve a single presenter name/TLA to "Full Name (TLA)" format.
 */
async function resolveSingle(input: string): Promise<string> {
  const trimmed = input.trim();
  if (!trimmed) return trimmed;

  // Already canonical
  if (/^.+\s+\([A-Z]{2,4}\)$/.test(trimmed)) return trimmed;

  const matches = await lookupDelegate(trimmed);
  if (matches.length === 1) {
    return formatDelegate(matches[0]);
  }

  // If exact TLA or name matched multiple (unlikely), take the first
  if (matches.length > 1) {
    // Check for exact match first
    const exact = matches.find(
      (d) =>
        d.tla.toLowerCase() === trimmed.toLowerCase() ||
        d.name.toLowerCase() === trimmed.toLowerCase(),
    );
    if (exact) return formatDelegate(exact);
  }

  // Unresolvable — return as-is
  return trimmed;
}
