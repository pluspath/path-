/** Extract #hashtags from post content (lowercase, alphanumeric + underscore). */
export function extractHashtags(content: string | null | undefined): string[] {
  if (!content) return [];
  const matches = content.match(/#([a-zA-Z0-9_]{2,40})/g) ?? [];
  const tags = matches.map((m) => m.slice(1).toLowerCase());
  return [...new Set(tags)];
}

/** Extract @usernames from post content. */
export function extractMentions(content: string | null | undefined): string[] {
  if (!content) return [];
  const matches = content.match(/@([a-zA-Z0-9_]{2,30})/g) ?? [];
  const names = matches.map((m) => m.slice(1).toLowerCase());
  return [...new Set(names)];
}
