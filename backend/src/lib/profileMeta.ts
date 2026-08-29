// Shared helpers for deriving public-facing profile metadata (age, zodiac)
// from a stored birthday (YYYY-MM-DD). The raw birthday is never exposed to
// other users; only the computed age / zodiac are, and only when the owner has
// toggled them on.

// English zodiac names, as required by the product spec.
const ZODIAC = [
  "Capricorn", "Aquarius", "Pisces", "Aries", "Taurus", "Gemini",
  "Cancer", "Leo", "Virgo", "Libra", "Scorpio", "Sagittarius",
];

// Inclusive last day of each sign's window, indexed by month (1-12). A day
// <= the cutoff belongs to that month's "first" sign; otherwise the next sign.
const CUTOFF = [0, 19, 18, 20, 19, 20, 20, 22, 22, 21, 22, 21, 21];

export function computeZodiac(birthday: string | null | undefined): string | null {
  if (!birthday) return null;
  const d = new Date(birthday + "T12:00:00");
  if (isNaN(d.getTime())) return null;
  const month = d.getMonth() + 1; // 1-12
  const day = d.getDate();
  const cutoff = CUTOFF[month] ?? 0;
  const idx = day <= cutoff ? month - 1 : month % 12;
  return ZODIAC[idx] ?? null;
}

export function computeAge(birthday: string | null | undefined): number | null {
  if (!birthday) return null;
  const d = new Date(birthday + "T12:00:00");
  if (isNaN(d.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
  return age >= 0 && age < 130 ? age : null;
}

// True when the person is at least 18 years old on `birthday`.
export function isAdult(birthday: string | null | undefined): boolean {
  const age = computeAge(birthday);
  return age !== null && age >= 18;
}

/** Parse YYYY-MM-DD without timezone shift; returns null if invalid or future. */
export function parseCalendarDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(y, m - 1, d, 12, 0, 0, 0);
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) return null;
  const today = new Date();
  const todayNoon = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 12, 0, 0, 0);
  if (date > todayNoon) return null;
  return date;
}

/** Validate and normalize a birthday string; returns YYYY-MM-DD or null. */
export function normalizeBirthday(value: string | null | undefined): string | null {
  if (!value || typeof value !== "string") return null;
  const trimmed = value.trim();
  return parseCalendarDate(trimmed) ? trimmed : null;
}
