/** First half of the Moment's first line, for notification previews. */
export function halfLineSnippet(content: string | null | undefined): string | undefined {
  return momentTextPreview(content, { halfLine: true });
}

/**
 * Clean Moment caption preview for notifications.
 * Skips JSON / UUID junk that used to leak as blue "sensitive" text.
 */
export function momentTextPreview(
  content: string | null | undefined,
  opts?: { halfLine?: boolean; maxLen?: number }
): string | undefined {
  if (!content) return undefined;
  const line = content
    .split(/\r?\n/)
    .map((part) => part.trim())
    .find((part) => part.length > 0);
  if (!line) return undefined;
  // Friendship payloads / accidental JSON must never appear in the notice copy.
  if (line.startsWith("[") || line.startsWith("{")) return undefined;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(line)) {
    return undefined;
  }
  const maxLen = opts?.maxLen ?? 100;
  let cut = line;
  if (opts?.halfLine) {
    const half = Math.max(1, Math.ceil(line.length / 2));
    cut = line.slice(0, half).trimEnd();
  } else if (line.length > maxLen) {
    cut = `${line.slice(0, maxLen).trimEnd()}…`;
  }
  if (!cut) return undefined;
  if (opts?.halfLine && cut.length < line.length) return `${cut}…`;
  return cut;
}

export function isVideoMediaUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  return /\.(mp4|mov|m4v|avi|mkv|webm)(\?|#|$)/i.test(url) || url.includes("/videos/");
}
