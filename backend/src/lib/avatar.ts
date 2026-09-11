import { supabaseAdmin } from "../supabase";

/** DiceBear Avataaars hair styles that read as typically male. */
const MALE_TOP =
  "shortFlat,shortRound,shortWaved,shortCurly,sides,theCaesar,theCaesarAndSidePart,dreads01,dreads02,shaggy,shaggyMullet";

/** DiceBear Avataaars hair styles that read as typically female. */
const FEMALE_TOP =
  "bob,bun,curly,curvy,bigHair,longButNotTooLong,miaWallace,straight01,straight02,straightAndStrand,dreads,frida,froBand";

export type ProfileGender = "Male" | "Female";

export function normalizeGender(gender: unknown): ProfileGender | null {
  if (gender === "Male" || gender === "Female") return gender;
  return null;
}

/** True when the user uploaded (or otherwise set) a real profile photo. */
export function isCustomAvatar(url: string | null | undefined): boolean {
  if (!url || typeof url !== "string") return false;
  const trimmed = url.trim();
  if (!trimmed) return false;
  // Auto-generated placeholders (legacy neutral + gendered defaults).
  if (trimmed.includes("dicebear.com")) return false;
  return true;
}

export function isDefaultAvatar(url: string | null | undefined): boolean {
  return !isCustomAvatar(url);
}

/** Gender-aware DiceBear default. Neutral when gender is unknown. */
export function defaultAvatarForGender(
  userId: string,
  gender?: string | null
): string {
  const seed = encodeURIComponent(String(userId || "user"));
  const g = normalizeGender(gender);
  if (g === "Male") {
    return `https://api.dicebear.com/7.x/avataaars/svg?seed=${seed}&top=${MALE_TOP}&facialHairProbability=35`;
  }
  if (g === "Female") {
    return `https://api.dicebear.com/7.x/avataaars/svg?seed=${seed}&top=${FEMALE_TOP}&facialHairProbability=0`;
  }
  return `https://api.dicebear.com/7.x/avataaars/svg?seed=${seed}`;
}

/**
 * Prefer a custom upload; otherwise return the gender-based default.
 * Safe for API formatters that previously fell back to a neutral DiceBear URL.
 */
export function resolveAvatarUrl(
  userId: string,
  avatarUrl?: string | null,
  gender?: string | null
): string {
  if (isCustomAvatar(avatarUrl)) return String(avatarUrl).trim();
  return defaultAvatarForGender(userId, gender);
}

/**
 * If the profile still has a default/empty avatar, persist the gender-based
 * default. Never overwrites a manually uploaded photo. Does not create an
 * avatar_change moment (callers must not treat this as a user edit).
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
    .update({ avatar_url: next })
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
      .select("id, gender, avatar_url")
      .in("gender", ["Male", "Female"]);

    if (error || !profiles) {
      console.error("[avatar] backfill: failed to load profiles:", error?.message);
      return { updated: 0 };
    }

    let updated = 0;
    for (const p of profiles) {
      if (isCustomAvatar(p.avatar_url)) continue;
      const next = defaultAvatarForGender(p.id, p.gender);
      if (p.avatar_url === next) continue;

      const { error: updErr } = await supabaseAdmin
        .from("profiles")
        .update({ avatar_url: next })
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
