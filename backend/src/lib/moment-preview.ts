/** First half of the Moment's first line, for notification previews. */
export function halfLineSnippet(content: string | null | undefined): string | undefined {
  if (!content) return undefined;
  const line = content
    .split(/\r?\n/)
    .map((part) => part.trim())
    .find((part) => part.length > 0);
  if (!line) return undefined;
  const half = Math.max(1, Math.ceil(line.length / 2));
  const cut = line.slice(0, half).trimEnd();
  if (!cut) return undefined;
  return cut.length < line.length ? `${cut}…` : cut;
}

export function isVideoMediaUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  return /\.(mp4|mov|m4v|avi|mkv|webm)(\?|#|$)/i.test(url) || url.includes("/videos/");
}
