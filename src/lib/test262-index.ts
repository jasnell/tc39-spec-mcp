/**
 * Fetches and searches the tc39/test262 repository for existing tests.
 *
 * Test262 is organized as:
 *   test/built-ins/{BuiltIn}/prototype/{method}/test-file.js
 *   test/built-ins/{BuiltIn}/{staticMethod}/test-file.js
 *   test/language/{feature}/...
 *
 * Each test file has YAML frontmatter (between /*--- and ---*​/) with:
 *   esid, description, info, features, includes, flags, negative
 */

import { cachedFetch } from "./cache.js";

const GITHUB_API_BASE =
  "https://api.github.com/repos/tc39/test262/contents";
const RAW_BASE =
  "https://raw.githubusercontent.com/tc39/test262/main";

// Cache TTLs
const DIR_LISTING_TTL = 21600; // 6 hours — test262 gets regular PRs
const FILE_CONTENT_TTL = 21600; // 6 hours
const FEATURES_TTL = 21600; // 6 hours

export interface TestEntry {
  /** File path relative to repo root, e.g. "test/built-ins/ArrayBuffer/prototype/transfer/this-is-not-object.js" */
  path: string;
  /** Filename, e.g. "this-is-not-object.js" */
  name: string;
}

export interface TestDetail extends TestEntry {
  /** esid from frontmatter, e.g. "sec-arraybuffer.prototype.transfer" */
  esid?: string;
  /** Short description from frontmatter */
  description?: string;
  /** Feature flags from frontmatter */
  features?: string[];
  /** info field (spec algorithm quote) — truncated */
  info?: string;
}

/**
 * Parse a GitHub Contents API JSON response.
 */
function parseGitHubContents(
  json: string,
): { name: string; type: string; path: string; size?: number }[] {
  try {
    return JSON.parse(json);
  } catch {
    return [];
  }
}

/**
 * Fetch the list of top-level built-in directories under test/built-ins/.
 */
async function getBuiltInDirectories(): Promise<string[]> {
  const url = `${GITHUB_API_BASE}/test/built-ins`;
  const json = await cachedFetch(url, DIR_LISTING_TTL);
  const entries = parseGitHubContents(json);
  return entries.filter((e) => e.type === "dir").map((e) => e.name);
}

/**
 * List entries (files and subdirectories) at a given path in the test262 repo.
 */
async function listDirectory(
  path: string,
): Promise<{ name: string; type: string; path: string }[]> {
  const url = `${GITHUB_API_BASE}/${path}`;
  const json = await cachedFetch(url, DIR_LISTING_TTL);
  return parseGitHubContents(json);
}

/**
 * Recursively list all .js test files under a directory path.
 * Limits depth to avoid excessive API calls.
 */
async function listTestFiles(
  dirPath: string,
  maxDepth: number = 2,
): Promise<TestEntry[]> {
  const entries = await listDirectory(dirPath);
  const files: TestEntry[] = [];

  for (const entry of entries) {
    if (entry.type === "file" && entry.name.endsWith(".js")) {
      files.push({ path: entry.path, name: entry.name });
    } else if (entry.type === "dir" && maxDepth > 0) {
      try {
        const subFiles = await listTestFiles(entry.path, maxDepth - 1);
        files.push(...subFiles);
      } catch {
        // Skip directories that fail to list
      }
    }
  }

  return files;
}

/**
 * Fetch a test file and parse its YAML frontmatter.
 */
async function fetchTestDetail(filePath: string): Promise<TestDetail> {
  const url = `${RAW_BASE}/${filePath}`;
  const content = await cachedFetch(url, FILE_CONTENT_TTL);
  const frontmatter = parseTestFrontmatter(content);

  return {
    path: filePath,
    name: filePath.split("/").pop() || filePath,
    ...frontmatter,
  };
}

/**
 * Parse the YAML frontmatter from a test262 test file.
 * Frontmatter is between /*--- and ---*​/ markers.
 */
function parseTestFrontmatter(content: string): {
  esid?: string;
  description?: string;
  features?: string[];
  info?: string;
} {
  const match = content.match(/\/\*---\s*\n([\s\S]*?)\n---\*\//);
  if (!match) return {};

  const yaml = match[1];
  const result: {
    esid?: string;
    description?: string;
    features?: string[];
    info?: string;
  } = {};

  // Parse esid
  const esidMatch = yaml.match(/^esid:\s*(.+)$/m);
  if (esidMatch) result.esid = esidMatch[1].trim();

  // Parse description (can be single line or multiline with >)
  const descMatch = yaml.match(
    /^description:\s*(?:>\s*\n\s*(.+)|(.+))$/m,
  );
  if (descMatch) result.description = (descMatch[1] || descMatch[2]).trim();

  // Parse features list
  const featuresMatch = yaml.match(/^features:\s*\[([^\]]*)\]/m);
  if (featuresMatch) {
    result.features = featuresMatch[1]
      .split(",")
      .map((f) => f.trim())
      .filter(Boolean);
  }

  // Parse info (multiline, take first 300 chars)
  const infoMatch = yaml.match(/^info:\s*\|\s*\n([\s\S]*?)(?=\n\w|\n---)/m);
  if (infoMatch) {
    result.info = infoMatch[1].trim().substring(0, 300);
  }

  return result;
}

/**
 * Fetch the features.txt file from test262.
 * Returns the raw text content.
 */
async function getFeaturesList(): Promise<string> {
  const url = `${RAW_BASE}/features.txt`;
  return cachedFetch(url, FEATURES_TTL);
}

/**
 * Map a search query to potential test262 directory paths.
 *
 * Examples:
 *   "ArrayBuffer" -> ["test/built-ins/ArrayBuffer"]
 *   "ArrayBuffer.prototype.transfer" -> ["test/built-ins/ArrayBuffer/prototype/transfer"]
 *   "%TypedArray%.prototype.slice" -> ["test/built-ins/TypedArray/prototype/slice"]
 *   "ValidateTypedArray" -> [] (AOs don't have test directories, search by esid instead)
 */
function queryToDirectoryPaths(query: string, builtIns: string[]): string[] {
  // Normalize: remove % wrappers, trim
  const normalized = query.replace(/%/g, "").trim();

  // Split on dots to get segments: "ArrayBuffer.prototype.transfer" -> ["ArrayBuffer", "prototype", "transfer"]
  const segments = normalized.split(".");

  // Check if the first segment matches a known built-in (case-insensitive)
  const builtIn = builtIns.find(
    (b) => b.toLowerCase() === segments[0].toLowerCase(),
  );

  if (builtIn) {
    // Build the full path
    const pathSegments = [builtIn, ...segments.slice(1)];
    return [`test/built-ins/${pathSegments.join("/")}`];
  }

  // Partial match: find built-ins that contain the query
  const partialMatches = builtIns.filter((b) =>
    b.toLowerCase().includes(segments[0].toLowerCase()),
  );

  return partialMatches.map((b) => `test/built-ins/${b}`);
}

/**
 * Search test262 for tests related to a query.
 *
 * Strategy:
 * 1. Map the query to test262 directory paths
 * 2. List files in matching directories
 * 3. Optionally fetch frontmatter for top results
 *
 * @param query - Feature name, built-in, or method path (e.g., "ArrayBuffer.prototype.transfer")
 * @param limit - Maximum number of results
 * @param fetchDetails - If true, fetch frontmatter for each test (slower but more informative)
 */
export async function searchTest262(
  query: string,
  limit: number = 20,
  fetchDetails: boolean = true,
): Promise<{
  files: TestDetail[];
  feature?: string;
  totalFound: number;
}> {
  const builtIns = await getBuiltInDirectories();
  const paths = queryToDirectoryPaths(query, builtIns);

  if (paths.length === 0) {
    // Fall back: check if query matches a feature flag in features.txt
    const features = await getFeaturesList();
    const queryLower = query.toLowerCase();
    const matchingFeatures = features
      .split("\n")
      .filter(
        (line) =>
          !line.startsWith("#") &&
          line.trim().length > 0 &&
          line.toLowerCase().includes(queryLower),
      );

    if (matchingFeatures.length > 0) {
      return {
        files: [],
        feature: matchingFeatures[0].trim(),
        totalFound: 0,
      };
    }

    return { files: [], totalFound: 0 };
  }

  const allFiles: TestEntry[] = [];

  for (const path of paths) {
    try {
      const files = await listTestFiles(path, 2);
      allFiles.push(...files);
    } catch {
      // Directory might not exist, skip
    }
  }

  const totalFound = allFiles.length;
  const limited = allFiles.slice(0, limit);

  // Fetch details for limited results
  let detailed: TestDetail[];
  if (fetchDetails && limited.length > 0) {
    // Fetch details for up to 10 files to keep response time reasonable
    const toFetch = limited.slice(0, 10);
    const detailPromises = toFetch.map(async (f) => {
      try {
        return await fetchTestDetail(f.path);
      } catch {
        return { ...f, path: f.path, name: f.name };
      }
    });
    const fetched = await Promise.all(detailPromises);
    // Append remaining files without details
    detailed = [
      ...fetched,
      ...limited.slice(10).map((f) => ({ ...f })),
    ];
  } else {
    detailed = limited.map((f) => ({ ...f }));
  }

  return { files: detailed, totalFound };
}
