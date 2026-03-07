/**
 * Fetches and parses individual spec sections from the ECMA-262 multipage spec.
 *
 * Given a section ID and the page file it lives in, this module:
 * 1. Fetches the page HTML
 * 2. Extracts the specific section (the <emu-clause> or <section> with that ID)
 * 3. Converts the HTML to simplified markdown
 */

import { cachedFetch } from "./cache.js";

const MULTIPAGE_BASE = "https://tc39.es/ecma262/multipage/";
const PAGE_TTL = 86400; // 24 hours

/**
 * Fetch a spec page and extract a specific section by ID.
 * Returns simplified markdown text of that section.
 */
export async function getSpecSection(
  pageFile: string,
  sectionId: string,
): Promise<string> {
  const url = `${MULTIPAGE_BASE}${pageFile}`;
  const html = await cachedFetch(url, PAGE_TTL);

  const section = extractSection(html, sectionId);
  if (!section) {
    // Try a broader extraction - the section might be a subsection
    // without its own emu-clause wrapper
    const fallback = extractByIdAttr(html, sectionId);
    if (fallback) {
      return htmlToMarkdown(fallback);
    }
    return `Section "${sectionId}" not found in ${pageFile}.`;
  }

  return htmlToMarkdown(section);
}

/**
 * Extract a section from spec HTML by its ID.
 *
 * Spec sections are wrapped in elements with id attributes:
 *   <emu-clause id="sec-array-objects">...</emu-clause>
 *   <section id="sec-array-objects">...</section>
 *
 * We find the opening tag with the matching ID and then find the
 * corresponding closing tag, accounting for nesting.
 */
function extractSection(html: string, sectionId: string): string | null {
  // Find the element with this ID - could be emu-clause, section, etc.
  const patterns = [
    new RegExp(
      `<(emu-clause|emu-annex|section)\\s[^>]*id="${escapeRegex(sectionId)}"[^>]*>`,
      "i",
    ),
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(html);
    if (!match) continue;

    const tagName = match[1];
    const startIdx = match.index;

    // Find the matching closing tag, accounting for nesting
    let depth = 1;
    let pos = startIdx + match[0].length;
    const openPattern = new RegExp(`<${tagName}[\\s>]`, "gi");
    const closePattern = new RegExp(`</${tagName}>`, "gi");

    while (depth > 0 && pos < html.length) {
      openPattern.lastIndex = pos;
      closePattern.lastIndex = pos;

      const nextOpen = openPattern.exec(html);
      const nextClose = closePattern.exec(html);

      if (!nextClose) break;

      if (nextOpen && nextOpen.index < nextClose.index) {
        depth++;
        pos = nextOpen.index + nextOpen[0].length;
      } else {
        depth--;
        if (depth === 0) {
          return html.slice(startIdx, nextClose.index + nextClose[0].length);
        }
        pos = nextClose.index + nextClose[0].length;
      }
    }
  }

  return null;
}

/**
 * Fallback: extract content starting from an element with the given ID.
 * Grabs a reasonable chunk of content after the ID anchor.
 */
function extractByIdAttr(html: string, sectionId: string): string | null {
  const idPattern = new RegExp(
    `id="${escapeRegex(sectionId)}"`,
    "i",
  );
  const match = idPattern.exec(html);
  if (!match) return null;

  // Find the start of the containing element
  let startIdx = match.index;
  while (startIdx > 0 && html[startIdx] !== "<") startIdx--;

  // Grab a reasonable chunk (up to 10KB)
  const chunk = html.slice(startIdx, startIdx + 10000);

  // Try to find a natural boundary
  const endPatterns = [/<\/emu-clause>/i, /<\/section>/i, /<emu-clause\s/i];
  let endIdx = chunk.length;
  for (const ep of endPatterns) {
    const m = ep.exec(chunk.slice(500)); // skip at least 500 chars
    if (m && 500 + m.index < endIdx) {
      endIdx = 500 + m.index;
    }
  }

  return chunk.slice(0, endIdx);
}

/**
 * Convert spec HTML to simplified markdown.
 *
 * Handles the key ecmarkup elements:
 * - <h1>/<h2>/etc → # headings
 * - <emu-alg> → numbered algorithm steps
 * - <emu-clause> → section boundaries
 * - <var> → _italic_
 * - <emu-val> → `code`
 * - <emu-xref> → plain text references
 * - <emu-note> → blockquote notes
 * - <emu-grammar> → code blocks
 * - <p> → paragraphs
 * - <ol>/<li> → numbered lists (for algorithm steps)
 * - <ul>/<li> → bullet lists
 * - <td>/<th> → table rows
 */
function htmlToMarkdown(html: string): string {
  let text = html;

  // Remove <script> and <style> tags entirely
  text = text.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "");
  text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "");

  // Process headings - extract text and section number
  text = text.replace(
    /<h([1-6])[^>]*>\s*<span class="secnum">([\d.]+)<\/span>\s*([\s\S]*?)<\/h\1>/gi,
    (_m, level, num, title) => {
      const hashes = "#".repeat(parseInt(level));
      const cleanTitle = stripTags(title).trim();
      return `\n${hashes} ${num} ${cleanTitle}\n`;
    },
  );

  // Headings without secnum
  text = text.replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_m, level, content) => {
    const hashes = "#".repeat(parseInt(level));
    return `\n${hashes} ${stripTags(content).trim()}\n`;
  });

  // emu-note → blockquote
  text = text.replace(
    /<emu-note[^>]*>([\s\S]*?)<\/emu-note>/gi,
    (_m, content) => {
      const noteText = stripTags(content).trim();
      return (
        "\n> **Note**: " +
        noteText
          .split("\n")
          .map((l: string) => l.trim())
          .filter(Boolean)
          .join("\n> ") +
        "\n"
      );
    },
  );

  // emu-grammar → code block
  text = text.replace(
    /<emu-grammar[^>]*>([\s\S]*?)<\/emu-grammar>/gi,
    (_m, content) => {
      return "\n```\n" + stripTags(content).trim() + "\n```\n";
    },
  );

  // emu-alg contains <ol> with algorithm steps. Process the <ol> inside.
  // We'll handle <ol> generically below.

  // Convert <var> to _italic_
  text = text.replace(/<var>([^<]*)<\/var>/gi, "_$1_");

  // Convert <emu-val> to `code`
  text = text.replace(/<emu-val>([^<]*)<\/emu-val>/gi, "`$1`");

  // Convert <code> to `code`
  text = text.replace(/<code>([^<]*)<\/code>/gi, "`$1`");

  // Convert <sub> to subscript notation
  text = text.replace(/<sub>([^<]*)<\/sub>/gi, "_{$1}");

  // Convert <sup> to superscript notation
  text = text.replace(/<sup>([^<]*)<\/sup>/gi, "^{$1}");

  // Convert <strong>/<b> to **bold**
  text = text.replace(/<(?:strong|b)>([^<]*)<\/(?:strong|b)>/gi, "**$1**");

  // Convert <em>/<i> to _italic_
  text = text.replace(/<(?:em|i)>([^<]*)<\/(?:em|i)>/gi, "_$1_");

  // Convert <a> links - keep the text, add href in parens
  text = text.replace(
    /<a\s+href="([^"]*)"[^>]*>([^<]*)<\/a>/gi,
    (_m, href, linkText) => {
      if (href.startsWith("#")) {
        // Internal cross-ref, just keep text
        return linkText;
      }
      return `[${linkText}](${href})`;
    },
  );

  // Convert <emu-xref> - just extract text content
  text = text.replace(/<emu-xref[^>]*>([\s\S]*?)<\/emu-xref>/gi, (_m, content) => {
    return stripTags(content);
  });

  // Process ordered lists (algorithm steps)
  text = processLists(text);

  // Convert <p> to paragraphs
  text = text.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, (_m, content) => {
    return "\n" + stripTags(content).trim() + "\n";
  });

  // Convert <br> to newlines
  text = text.replace(/<br\s*\/?>/gi, "\n");

  // Convert <td>/<th> for basic table rendering
  text = text.replace(/<tr[^>]*>([\s\S]*?)<\/tr>/gi, (_m, row) => {
    const cells: string[] = [];
    const cellRegex = /<(?:td|th)[^>]*>([\s\S]*?)<\/(?:td|th)>/gi;
    let cellMatch;
    while ((cellMatch = cellRegex.exec(row)) !== null) {
      cells.push(stripTags(cellMatch[1]).trim());
    }
    return cells.length > 0 ? "| " + cells.join(" | ") + " |\n" : "";
  });

  // Remove all remaining HTML tags
  text = stripTags(text);

  // Decode HTML entities
  text = decodeEntities(text);

  // Clean up whitespace: collapse multiple blank lines to two
  text = text.replace(/\n{3,}/g, "\n\n");

  // Trim leading/trailing whitespace
  text = text.trim();

  return text;
}

/**
 * Process <ol> and <ul> lists, handling nesting.
 * Algorithm steps in the spec use <ol> with class "block".
 */
function processLists(html: string): string {
  // Process from innermost lists outward
  let text = html;
  let changed = true;
  let iterations = 0;

  while (changed && iterations < 20) {
    changed = false;
    iterations++;

    // Process innermost <ol> (ones that don't contain nested <ol>)
    text = text.replace(
      /<ol[^>]*>((?:(?!<ol[\s>])[\s\S])*?)<\/ol>/gi,
      (_m, content) => {
        changed = true;
        let num = 1;
        let result = "\n";
        const liRegex = /<li[^>]*>([\s\S]*?)(?=<li[\s>]|$)/gi;
        let liMatch;
        while ((liMatch = liRegex.exec(content)) !== null) {
          let itemText = liMatch[1]
            .replace(/<\/li>/gi, "")
            .trim();
          // Don't strip tags yet - inner content may have formatting
          result += `${num}. ${itemText}\n`;
          num++;
        }
        return result;
      },
    );

    // Process innermost <ul>
    text = text.replace(
      /<ul[^>]*>((?:(?!<ul[\s>])[\s\S])*?)<\/ul>/gi,
      (_m, content) => {
        changed = true;
        let result = "\n";
        const liRegex = /<li[^>]*>([\s\S]*?)(?=<li[\s>]|$)/gi;
        let liMatch;
        while ((liMatch = liRegex.exec(content)) !== null) {
          let itemText = liMatch[1]
            .replace(/<\/li>/gi, "")
            .trim();
          result += `- ${itemText}\n`;
        }
        return result;
      },
    );
  }

  return text;
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, "");
}

function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&times;/g, "x")
    .replace(/&le;/g, "<=")
    .replace(/&ge;/g, ">=")
    .replace(/&ne;/g, "!=")
    .replace(/&nbsp;/g, " ")
    .replace(/&#8209;/g, "-")
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, hex) =>
      String.fromCodePoint(parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (_m, dec) =>
      String.fromCodePoint(parseInt(dec, 10)),
    );
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
