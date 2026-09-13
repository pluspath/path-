import { supabaseAdmin } from "../supabase";

/** Short male hair styles only — never long hair. */
const MALE_TOPS = [
  "shortFlat",
  "shortRound",
  "shortWaved",
  "shortCurly",
  "sides",
  "theCaesar",
  "theCaesarAndSidePart",
] as const;

/** Clearly feminine / long hair styles. */
const FEMALE_TOPS = [
  "bob",
  "bun",
  "curly",
  "curvy",
  "bigHair",
  "longButNotTooLong",
  "miaWallace",
  "straight01",
  "straight02",
  "straightAndStrand",
  "frida",
  "froBand",
] as const;

const MALE_FACIAL_HAIR = ["beardLight", "beardMedium", "moustacheFancy"] as const;

export type ProfileGender = "Male" | "Female";

export function normalizeGender(gender: unknown): ProfileGender | null {
  if (gender === "Male" || gender === "Female") return gender;
  // Tolerate lowercase from older clients / DB rows.
  if (typeof gender === "string") {
    const g = gender.trim().toLowerCase();
    if (g === "male") return "Male";
    if (g === "female") return "Female";
  }
  return null;
}

function pickStable<T extends string>(seed: string, options: readonly T[]): T {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return options[Math.abs(h) % options.length];
}

/**
 * expo-image (esp. iOS) often renders DiceBear SVG endpoints as blank.
 * Prefer PNG for every DiceBear HTTP avatar URL.
 */
export function ensureRasterAvatarUrl(url: string): string {
  const trimmed = url.trim();
  if (!/dicebear\.com/i.test(trimmed)) return trimmed;
  return trimmed.replace(/\/svg(\?|$)/i, "/png$1");
}

/** True when the user uploaded (or otherwise set) a real profile photo. */
export function isCustomAvatar(url: string | null | undefined): boolean {
  if (!url || typeof url !== "string") return false;
  const trimmed = url.trim();
  if (!trimmed) return false;
  if (trimmed.includes("dicebear.com")) return false;
  return true;
}

export function isDefaultAvatar(url: string | null | undefined): boolean {
  return !isCustomAvatar(url);
}

/**
 * Gender-aware DiceBear default as PNG.
 * Uses ONE explicit `top` value (not a comma list) — DiceBear can ignore
 * invalid multi-value strings and fall back to long-hair styles.
 */
export function defaultAvatarForGender(
  userId: string,
  gender?: string | null
): string {
  const id = String(userId || "user");
  const g = normalizeGender(gender);
  const seed = encodeURIComponent(g ? `${id}-${g}` : id);

  if (g === "Male") {
    const top = pickStable(id, MALE_TOPS);
    const facialHair = pickStable(`${id}-fh`, MALE_FACIAL_HAIR);
    return `https://api.dicebear.com/7.x/avataaars/png?seed=${seed}&size=128&top=${top}&facialHairProbability=55&facialHair=${facialHair}`;
  }
  if (g === "Female") {
    const top = pickStable(id, FEMALE_TOPS);
    return `https://api.dicebear.com/7.x/avataaars/png?seed=${seed}&size=128&top=${top}&facialHairProbability=0`;
  }
  return `https://api.dicebear.com/7.x/avataaars/png?seed=${seed}&size=128`;
}

/**
 * Prefer a custom upload; otherwise return the gender-based default.
 * Always returns a raster-friendly URL (DiceBear PNG, not SVG).
 */
export function resolveAvatarUrl(
  userId: string,
  avatarUrl?: string | null,
  gender?: string | null
): string {
  if (isCustomAvatar(avatarUrl)) return ensureRasterAvatarUrl(String(avatarUrl).trim());
  return defaultAvatarForGender(userId, gender);
}

/**
 * If the profile still has a default/empty avatar, persist the gender-based
 * default. Never overwrites a manually uploaded photo.
 */
export async function ensureGenderDefaultAvatar(
  userId: string,
  gender: string | null | undefined,
  currentAvatarUrl?: string | null
): Promise<string | null> {
  const g = normalizeGender(gender);
  if (!userId || !g) return currentAvatarUrl ?? null;
  if (isCustomAvatar(currentAvatarUrl)) return String(currentAvatarUrl).trim();

  const next = defaultAvatarForGender(userId, g);
  if (currentAvatarUrl === next) return next;

  const { error } = await supabaseAdmin
    .from("profiles")
    .update({ avatar_url: next, gender: g })
    .eq("id", userId);

  if (error) {
    console.error("[avatar] ensureGenderDefaultAvatar failed:", error.message);
    return currentAvatarUrl ?? null;
  }
  return next;
}

/**
 * Boot-time backfill: apply gendered defaults to every profile that has a
 * gender set and has not uploaded a custom avatar. Idempotent.
 */
export async function backfillGenderAvatars(): Promise<{ updated: number }> {
  try {
    const { data: profiles, error } = await supabaseAdmin
      .from("profiles")
      .select("id, gender, avatar_url");

    if (error || !profiles) {
      console.error("[avatar] backfill: failed to load profiles:", error?.message);
      return { updated: 0 };
    }

    let updated = 0;
    for (const p of profiles) {
      const g = normalizeGender(p.gender);
      if (!g) continue;
      if (isCustomAvatar(p.avatar_url)) continue;
      const next = defaultAvatarForGender(p.id, g);
      if (p.avatar_url === next && p.gender === g) continue;

      const { error: updErr } = await supabaseAdmin
        .from("profiles")
        .update({ avatar_url: next, gender: g })
        .eq("id", p.id);

      if (updErr) {
        console.error(`[avatar] backfill update failed for ${p.id}:`, updErr.message);
        continue;
      }
      updated += 1;
    }

    if (updated > 0) {
      console.log(`[avatar] backfill: updated ${updated} gender default avatar(s)`);
    }
    return { updated };
  } catch (e) {
    console.error("[avatar] backfillGenderAvatars error:", e);
    return { updated: 0 };
  }
}
