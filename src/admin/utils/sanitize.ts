/** Strip HTML tags and control characters from free-text admin input. */
export function sanitizeText(input: string, maxLen = 10_000): string {
  return input
    .replace(/<[^>]*>/g, "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .trim()
    .slice(0, maxLen);
}

export function sanitizeObjectStrings<T extends Record<string, unknown>>(obj: T): T {
  const out: Record<string, unknown> = { ...obj };
  for (const [key, value] of Object.entries(out)) {
    if (typeof value === "string") {
      out[key] = sanitizeText(value);
    }
  }
  return out as T;
}
