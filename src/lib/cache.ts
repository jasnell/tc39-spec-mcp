/**
 * Cache wrapper around the Cloudflare Cache API.
 * Falls back to an in-memory Map when the Cache API is unavailable (local dev).
 */

const memoryCache = new Map<string, { value: string; expires: number }>();

function cacheAvailable(): boolean {
  return typeof caches !== "undefined" && caches.default !== undefined;
}

export async function cacheGet(key: string): Promise<string | null> {
  if (cacheAvailable()) {
    const cache = caches.default;
    const url = `https://tc39-spec-mcp.internal/${encodeURIComponent(key)}`;
    const response = await cache.match(new Request(url));
    if (response) {
      return response.text();
    }
    return null;
  }

  // Fallback: in-memory cache for local dev
  const entry = memoryCache.get(key);
  if (entry && entry.expires > Date.now()) {
    return entry.value;
  }
  memoryCache.delete(key);
  return null;
}

export async function cachePut(
  key: string,
  value: string,
  ttlSeconds: number,
): Promise<void> {
  if (cacheAvailable()) {
    const cache = caches.default;
    const url = `https://tc39-spec-mcp.internal/${encodeURIComponent(key)}`;
    const response = new Response(value, {
      headers: {
        "Cache-Control": `public, max-age=${ttlSeconds}`,
        "Content-Type": "text/plain; charset=utf-8",
      },
    });
    await cache.put(new Request(url), response);
    return;
  }

  // Fallback: in-memory cache for local dev
  memoryCache.set(key, {
    value,
    expires: Date.now() + ttlSeconds * 1000,
  });
}

/** Fetch a URL with caching. Returns the response body text. */
export async function cachedFetch(
  url: string,
  ttlSeconds: number,
): Promise<string> {
  const cached = await cacheGet(url);
  if (cached !== null) {
    return cached;
  }

  const response = await fetch(url, {
    headers: {
      "User-Agent": "tc39-spec-mcp/1.0",
    },
  });

  if (!response.ok) {
    throw new Error(`Fetch failed: ${response.status} ${response.statusText} for ${url}`);
  }

  const text = await response.text();
  await cachePut(url, text, ttlSeconds);
  return text;
}
