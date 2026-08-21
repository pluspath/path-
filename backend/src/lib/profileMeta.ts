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
