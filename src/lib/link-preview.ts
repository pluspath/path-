/**
 * SSRF-safe Open Graph / HTML meta preview fetcher.
 * In-memory TTL cache (v1). A `link_previews` table can persist later.
 */

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export type LinkPreviewResult = {
  url: string;
  title: string | null;
  description: string | null;
  image: string | null;
  siteName: string | null;
  hostname: string | null;
};

type CacheEntry = { expiresAt: number; value: LinkPreviewResult | null };

const CACHE = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 1000 * 60 * 60 * 6; // 6h
const MAX_CACHE_ENTRIES = 500;
const FETCH_TIMEOUT_MS = 8_000;
const MAX_BYTES = 1_000_000;
const MAX_REDIRECTS = 3;

function pruneCache() {
  if (CACHE.size <= MAX_CACHE_ENTRIES) return;
  const now = Date.now();
  for (const [k, v] of CACHE) {
    if (v.expiresAt <= now) CACHE.delete(k);
  }
  while (CACHE.size > MAX_CACHE_ENTRIES) {
    const first = CACHE.keys().next().value;
    if (first === undefined) break;
    CACHE.delete(first);
  }
}

function sanitizeText(raw: string | null | undefined, max = 300): string | null {
  if (!raw) return null;
  const cleaned = raw
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return null;
  return cleaned.length > max ? cleaned.slice(0, max - 1) + "…" : cleaned;
}

function isPrivateOrBlockedIp(ip: string): boolean {
  const v = ip.toLowerCase().replace(/^\[|\]$/g, "");
  if (v === "::1" || v === "0:0:0:0:0:0:0:1") return true;
  if (v.startsWith("fe80:") || v.startsWith("fc") || v.startsWith("fd")) return true;
  if (v.includes(".")) {
    // IPv4-mapped IPv6 :ffff:x.x.x.x
    const mapped = v.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateOrBlockedIp(mapped[1]!);
  }
  const parts = v.split(".").map((n) => Number(n));
  if (parts.length === 4 && parts.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)) {
    const [a, b] = parts as [number, number, number, number];
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 0) return true;
    if (a === 169 && b === 254) return true; // link-local + cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    if (a >= 224) return true; // multicast / reserved
    return false;
  }
  // Other IPv6: block loopback/unique-local/link-local already handled; allow global unicast.
  return false;
}

function blockedHostname(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/\.$/, "");
  if (!h) return true;
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local")) return true;
  if (h === "metadata.google.internal") return true;
  return false;
}

async function assertSafeUrl(rawUrl: string): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error("Invalid URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Only http/https allowed");
  }
  if (parsed.username || parsed.password) {
    throw new Error("Credentials not allowed");
  }
  const host = parsed.hostname;
  if (blockedHostname(host)) throw new Error("Blocked host");

  const literal = isIP(host);
  if (literal) {
    if (isPrivateOrBlockedIp(host)) throw new Error("Blocked IP");
    return parsed;
  }

  const records = await lookup(host, { all: true, verbatim: true });
  if (!records.length) throw new Error("DNS failed");
  for (const r of records) {
    if (isPrivateOrBlockedIp(r.address)) throw new Error("Blocked resolved IP");
  }
  return parsed;
}

async function assertSafeImageUrl(raw: string | null, pageUrl: URL): Promise<string | null> {
  if (!raw) return null;
  let absolute: string;
  try {
    absolute = new URL(raw, pageUrl).toString();
  } catch {
    return null;
  }
  try {
    const safe = await assertSafeUrl(absolute);
    return safe.toString();
  } catch {
    return null;
  }
}

function metaContent(html: string, property: string): string | null {
  const prop = property.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(
      `<meta[^>]+(?:property|name)=["']${prop}["'][^>]+content=["']([^"']*)["'][^>]*>`,
      "i"
    ),
    new RegExp(
      `<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${prop}["'][^>]*>`,
      "i"
    ),
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m?.[1]) return m[1];
  }
  return null;
}

function htmlTitle(html: string): string | null {
  const m = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  return m?.[1] ?? null;
}

async function readLimitedText(res: Response): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) {
    const text = await res.text();
    return text.slice(0, MAX_BYTES);
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > MAX_BYTES) {
      chunks.push(value.slice(0, Math.max(0, value.byteLength - (total - MAX_BYTES))));
      try {
        await reader.cancel();
      } catch {
        /* ignore */
      }
      break;
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(chunks.reduce((n, c) => n + c.byteLength, 0));
  let offset = 0;
  for (const c of chunks) {
    merged.set(c, offset);
    offset += c.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(merged);
}

async function fetchHtmlFollow(url: URL): Promise<{ finalUrl: URL; html: string } | null> {
  let current = url;
  for (let i = 0; i <= MAX_REDIRECTS; i++) {
    await assertSafeUrl(current.toString());
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(current.toString(), {
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
        headers: {
          "User-Agent": "PathPlusLinkPreview/1.0 (+https://pathplus.store)",
          Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1",
        },
      });
    } finally {
      clearTimeout(timer);
    }

    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const loc = res.headers.get("location");
      if (!loc) return null;
      const next = new URL(loc, current);
      await assertSafeUrl(next.toString());
      current = next;
      continue;
    }

    if (!res.ok) return null;
    const ctypeType = (res.headers.get("content-type") ?? "").toLowerCase();
    if (!ctypeType.includes("text/html") && !ctypeType.includes("application/xhtml")) {
      return null;
    }
    const html = await readLimitedText(res);
    return { finalUrl: current, html };
  }
  return null;
}

export async function fetchLinkPreview(rawUrl: string): Promise<LinkPreviewResult | null> {
  let canonical: string;
  try {
    const first = await assertSafeUrl(rawUrl);
    canonical = first.toString();
  } catch {
    return null;
  }

  const cached = CACHE.get(canonical);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  let value: LinkPreviewResult | null = null;
  try {
    const page = await fetchHtmlFollow(new URL(canonical));
    if (page) {
      const { finalUrl, html } = page;
      const title =
        sanitizeText(metaContent(html, "og:title") ?? htmlTitle(html), 200) ??
        sanitizeText(metaContent(html, "twitter:title"), 200);
      const description =
        sanitizeText(metaContent(html, "og:description") ?? metaContent(html, "description"), 300) ??
        sanitizeText(metaContent(html, "twitter:description"), 300);
      const siteName = sanitizeText(metaContent(html, "og:site_name"), 120);
      const rawImage =
        metaContent(html, "og:image") ??
        metaContent(html, "twitter:image") ??
        metaContent(html, "twitter:image:src");
      const image = await assertSafeImageUrl(rawImage, finalUrl);
      value = {
        url: finalUrl.toString(),
        title,
        description,
        image,
        siteName,
        hostname: finalUrl.hostname.replace(/^www\./i, ""),
      };
      // Drop empty previews so clients don't render a blank card.
      if (!value.title && !value.description && !value.image && !value.siteName) {
        value = null;
      }
    }
  } catch (e) {
    console.warn("[link-preview] fetch failed:", e instanceof Error ? e.message : e);
    value = null;
  }

  CACHE.set(canonical, { expiresAt: Date.now() + CACHE_TTL_MS, value });
  pruneCache();
  return value;
}
