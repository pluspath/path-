import { supabaseAdmin } from "../supabase";
import { env } from "../env";

export type ProfileGender = "Male" | "Female";

export function normalizeGender(gender: unknown): ProfileGender | null {
  if (gender === "Male" || gender === "Female") return gender;
  if (typeof gender === "string") {
    const g = gender.trim().toLowerCase();
    if (g === "male") return "Male";
    if (g === "female") return "Female";
  }
  return null;
}

function backendPublicBase(): string {
  return String(env.BACKEND_URL || "https://api.pathplus.store").replace(/\/+$/, "");
}

/**
 * True when the URL is a Path+ / legacy generated default (not a user upload).
 *
 * Covered:
 * - empty / null
 * - DiceBear (any style — legacy cartoon faces OR any old defaults)
 * - Fixed cropped files from an earlier migration (`/static/default-avatars/01.jpg`)
 * - Seed-generated stylized defaults (`/static/default-avatars/gen/<seed>.png`)
 */
export function isKnownDefaultAvatarUrl(url: string | null | undefined): boolean {
  if (!url || typeof url !== "string") return true;
  const trimmed = url.trim();
  if (!trimmed) return true;
  if (/dicebear\.com/i.test(trimmed)) return true;
  if (/\/static\/default-avatars\//i.test(trimmed)) return true;
  if (/\/default-avatars\//i.test(trimmed)) return true;
  return false;
}

/** True when the user uploaded a real profile photo — never overwrite these. */
export function isCustomAvatar(url: string | null | undefined): boolean {
  if (!url || typeof url !== "string") return false;
  const trimmed = url.trim();
  if (!trimmed) return false;
  return !isKnownDefaultAvatarUrl(trimmed);
}

export function isDefaultAvatar(url: string | null | undefined): boolean {
  return !isCustomAvatar(url);
}

/** DiceBear SVG → PNG for any leftover legacy URLs in caches. */
export function ensureRasterAvatarUrl(url: string): string {
  const trimmed = url.trim();
  if (!/dicebear\.com/i.test(trimmed)) return trimmed;
  return trimmed.replace(/\/svg(\?|$)/i, "/png$1");
}

/**
 * Seed-generated stylized default (creative / varied), same pattern as DiceBear:
 * stable user id → stable illustration URL.
 */
export function defaultAvatarForGender(
  userId: string,
  _gender?: string | null
): string {
  const id = encodeURIComponent(String(userId || "user"));
  // v=3 busts the year-long image cache from earlier face-style defaults.
  return `${backendPublicBase()}/static/default-avatars/gen/${id}.png?v=3`;
}

export function resolveAvatarUrl(
  userId: string,
  avatarUrl?: string | null,
  gender?: string | null
): string {
  if (isCustomAvatar(avatarUrl)) return ensureRasterAvatarUrl(String(avatarUrl).trim());
  return defaultAvatarForGender(userId, gender);
}

export async function ensureGenderDefaultAvatar(
  userId: string,
  gender: string | null | undefined,
  currentAvatarUrl?: string | null
): Promise<string | null> {
  if (!userId) return currentAvatarUrl ?? null;
  if (isCustomAvatar(currentAvatarUrl)) return String(currentAvatarUrl).trim();

  const g = normalizeGender(gender);
  const next = defaultAvatarForGender(userId, g);
  if (currentAvatarUrl === next) return next;

  const payload: Record<string, unknown> = { avatar_url: next };
  if (g) payload.gender = g;

  const { error } = await supabaseAdmin.from("profiles").update(payload).eq("id", userId);
  if (error) {
    console.error("[avatar] ensureGenderDefaultAvatar failed:", error.message);
    return currentAvatarUrl ?? null;
  }
  return next;
}

const PROFILE_PAGE = 500;

/** Every profile row, past PostgREST's default 1,000-row cap. */
async function listAllProfiles(): Promise<
  Array<{ id: string; gender: string | null; avatar_url: string | null }>
> {
  const all: Array<{ id: string; gender: string | null; avatar_url: string | null }> = [];
  for (let from = 0; ; from += PROFILE_PAGE) {
    const { data, error } = await supabaseAdmin
      .from("profiles")
      .select("id, gender, avatar_url")
      .order("id", { ascending: true })
      .range(from, from + PROFILE_PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    all.push(...rows);
    if (rows.length < PROFILE_PAGE) break;
  }
  return all;
}

/**
 * Give every existing account that has no uploaded photo a stable default
 * avatar. NEVER touches custom uploads. Pages through the whole profiles table.
 */
export async function backfillGenderAvatars(): Promise<{
  updated: number;
  skippedCustom: number;
}> {
  try {
    const profiles = await listAllProfiles();

    let updated = 0;
    let skippedCustom = 0;

    for (const p of profiles) {
      if (!p?.id) continue;
      if (isCustomAvatar(p.avatar_url)) {
        skippedCustom += 1;
        continue;
      }

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

    console.log(
      `[avatar] backfill: updated ${updated} default avatar(s); skipped ${skippedCustom} custom upload(s); scanned ${profiles.length}`
    );
    return { updated, skippedCustom };
  } catch (e) {
    console.error("[avatar] backfillGenderAvatars error:", e);
    return { updated: 0, skippedCustom: 0 };
  }
}
