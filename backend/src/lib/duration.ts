// Sleep duration helpers.
//
// The `posts.sleep_duration` column is an INTEGER (minutes). The mobile app,
// however, works entirely in human strings like "8h 30m" (it computes that on
// Wake Up and renders it as "· slept 8h 30m"). Writing the string straight into
// the integer column failed ("invalid input syntax for type integer"), which is
// why Wake Up never created an Awake moment.
//
// So we translate at the backend boundary: parse the incoming string to minutes
// on insert, and format minutes back to the same "Xh Ym" string on the way out.
// The mobile contract is unchanged.

// "8h 30m" / "45m" / "2h" / 510 / "510" → integer minutes (or null).
export function parseDurationToMinutes(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? Math.round(value) : null;
  const s = String(value).trim();
  const h = s.match(/(\d+)\s*h/i);
  const m = s.match(/(\d+)\s*m/i);
  if (h || m) {
    return (h ? parseInt(h[1] ?? "0", 10) : 0) * 60 + (m ? parseInt(m[1] ?? "0", 10) : 0);
  }
  // Bare number (already minutes).
  const n = parseInt(s, 10);
  return Number.isNaN(n) ? null : n;
}

// Integer minutes → "Xh Ym" for the client. Tolerates legacy/text values.
export function formatDuration(value: unknown): string | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  const n = typeof value === "number" ? value : parseInt(String(value), 10);
  if (Number.isNaN(n)) return String(value); // unexpected text → pass through
  const h = Math.floor(n / 60);
  const m = n % 60;
  return `${h}h ${m}m`;
}
