// Multi-image storage helpers.
//
// The posts.image_url and messages.image_url columns are plain `text` columns
// that historically held a SINGLE image URL. To support multiple images (up to
// a small max) WITHOUT a schema migration, we overload that same column:
//   - 0 images        → null
//   - exactly 1 image → the plain URL string (exactly as before — backward compatible)
//   - 2+ images       → a JSON array string, e.g. '["https://a","https://b"]'
//
// decodeImages() reverses this: existing single-URL rows decode to a 1-element
// array, JSON-array rows decode to the full list. This keeps every existing
// single-image post/message working unchanged.

const MAX_IMAGES = 6;

/**
 * Turn the raw image_url column value into an array of URLs.
 * Handles legacy plain-string values and new JSON-array values.
 */
export function decodeImages(value: string | null | undefined): string[] {
  if (!value) return [];
  const s = String(value).trim();
  if (s.startsWith("[")) {
    try {
      const arr = JSON.parse(s);
      if (Array.isArray(arr)) {
        return arr.filter((u): u is string => typeof u === "string" && u.length > 0).slice(0, MAX_IMAGES);
      }
    } catch {
      // Not valid JSON — fall through and treat the whole thing as one URL.
    }
    return [s];
  }
  return [s];
}

/**
 * Build the value to store in the image_url column from an optional images[]
 * array and/or a legacy single `image` field. Caps at MAX_IMAGES.
 * Returns a plain URL for a single image (backward compatible) or a JSON array
 * string for multiple, or null for none.
 */
export function encodeImages(images?: unknown, single?: unknown): string | null {
  const list: string[] = [];
  if (Array.isArray(images)) {
    for (const u of images) if (typeof u === "string" && u.length > 0) list.push(u);
  }
  if (list.length === 0 && typeof single === "string" && single.length > 0) {
    list.push(single);
  }
  const capped = list.slice(0, MAX_IMAGES);
  if (capped.length === 0) return null;
  if (capped.length === 1) return capped[0] ?? null;
  return JSON.stringify(capped);
}
