import { supabaseAdmin } from "../supabase";
import { env } from "../env";

/** How many stylized default photos are served from /static/default-avatars/. */
export const DEFAULT_AVATAR_COUNT = 8;

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

function stableIndex(seed: string, count: number): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h) % count;
}

function backendPublicBase(): string {
  return String(env.BACKEND_URL || "https://api.pathplus.store").replace(/\/+$/, "");
}

/**
 * True when the URL is one of Path+'s shared default avatar assets
 * (DiceBear legacy OR the new stylized /static/default-avatars/* set).
 */
export function isKnownDefaultAvatarUrl(url: string | null | undefined): boolean {
  if (!url || typeof url !== "string") return true;
  const trimmed = url.trim();
  if (!trimmed) return true;
  if (/dicebear\.com/i.test(trimmed)) return true;
  if (/\/static\/default-avatars\/\d{2}\.(jpe?g|png|webp)/i.test(trimmed)) return true;
  if (/\/default-avatars\/\d{2}\.(jpe?g|png|webp)/i.test(trimmed)) return true;
  return false;
}

/**
 * True when the user uploaded (or otherwise set) a real profile photo.
 * Anything that is NOT a known app default is treated as custom — never overwrite.
 */
export function isCustomAvatar(url: string | null | undefined): boolean {
  if (!url || typeof url !== "string") return false;
  const trimmed = url.trim();
  if (!trimmed) return false;
  return !isKnownDefaultAvatarUrl(trimmed);
}

export function isDefaultAvatar(url: string | null | undefined): boolean {
  return !isCustomAvatar(url);
}

/** DiceBear SVG → PNG (legacy URLs that may still appear in caches). */
export function ensureRasterAvatarUrl(url: string): string {
  const trimmed = url.trim();
  if (!/dicebear\.com/i.test(trimmed)) return trimmed;
  return trimmed.replace(/\/svg(\?|$)/i, "/png$1");
}

/**
 * Stable stylized default photo for a user (01.jpg … 08.jpg).
 * Gender is accepted for call-site compatibility but does not change the pick —
 * assignment is deterministic from user id only.
 */
export function defaultAvatarForGender(
  userId: string,
  _gender?: string | null
): string {
  const id = String(userId || "user");
  const index = stableIndex(id, DEFAULT_AVATAR_COUNT) + 1; // 1..N
  const file = `${String(index).padStart(2, "0")}.jpg`;
  return `${backendPublicBase()}/static/default-avatars/${file}`;
}

/**
 * Prefer a custom upload; otherwise return the assigned stylized default.
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
 * If the profile still has a default/empty avatar, persist the stylized
 * default. Never overwrites a manually uploaded photo.
 */
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

/**
 * Boot-time backfill: replace empty / DiceBear / outdated default avatar URLs
 * with the new stylized set. NEVER touches custom uploads.
 */
export async function backfillGenderAvatars(): Promise<{
  updated: number;
  skippedCustom: number;
}> {
  try {
    const { data: profiles, error } = await supabaseAdmin
      .from("profiles")
      .select("id, gender, avatar_url");

    if (error || !profiles) {
      console.error("[avatar] backfill: failed to load profiles:", error?.message);
      return { updated: 0, skippedCustom: 0 };
    }

    let updated = 0;
    let skippedCustom = 0;

    for (const p of profiles) {
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
      `[avatar] backfill: updated ${updated} default avatar(s); skipped ${skippedCustom} custom upload(s)`
    );
    return { updated, skippedCustom };
  } catch (e) {
    console.error("[avatar] backfillGenderAvatars error:", e);
    return { updated: 0, skippedCustom: 0 };
  }
}
