/**
 * Optional location metadata attached to Moments and comments.
 * Public API responses expose display labels only — never raw coordinates
 * for comments. Existing Moment check-in lat/lng remain for backward compat.
 */

export type LocationPrecision = "precise" | "approximate";

export type IncomingLocation = {
  share: boolean;
  label?: string | null;
  city?: string | null;
  region?: string | null;
  country?: string | null;
  lat?: number | null;
  lng?: number | null;
  accuracyM?: number | null;
  precision?: LocationPrecision | null;
  capturedAt?: string | null;
};

export type PublicLocation = {
  locationLabel?: string;
  locationCity?: string;
  locationRegion?: string;
  locationCountry?: string;
  locationPrecision?: LocationPrecision;
  locationCapturedAt?: string;
  locationShared?: boolean;
};

function cleanText(value: unknown, max = 120): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().replace(/\s+/g, " ");
  if (!trimmed) return null;
  return trimmed.slice(0, max);
}

function cleanCoord(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (Math.abs(value) > 180) return null;
  return value;
}

function cleanAccuracy(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  return Math.min(value, 100_000);
}

function cleanPrecision(value: unknown): LocationPrecision | null {
  if (value === "precise" || value === "approximate") return value;
  return null;
}

function cleanIso(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  // Reject absurdly old / future stamps (more than 1 day off).
  const now = Date.now();
  if (Math.abs(d.getTime() - now) > 86_400_000) return new Date().toISOString();
  return d.toISOString();
}

/** Build a human display label from structured parts. */
export function buildLocationLabel(parts: {
  label?: string | null;
  city?: string | null;
  region?: string | null;
  country?: string | null;
}): string | null {
  const label = cleanText(parts.label, 160);
  if (label) return label;
  const city = cleanText(parts.city, 80);
  const country = cleanText(parts.country, 80);
  if (city && country) return `${city}, ${country}`;
  return city || country || cleanText(parts.region, 80);
}

/**
 * Parse optional client location payload.
 * If share is not explicitly true, returns null (no location attached).
 */
export function parseIncomingLocation(raw: unknown): IncomingLocation | null {
  if (!raw || typeof raw !== "object") return null;
  const body = raw as Record<string, unknown>;
  const share = body.share === true || body.locationShared === true;
  if (!share) return null;

  const label = cleanText(body.label ?? body.locationName ?? body.locationLabel, 160);
  const city = cleanText(body.city ?? body.locationCity, 80);
  const region = cleanText(body.region ?? body.locationRegion, 80);
  const country = cleanText(body.country ?? body.locationCountry, 80);
  const lat = cleanCoord(body.lat ?? body.locationLat);
  const lng = cleanCoord(body.lng ?? body.locationLng);
  const accuracyM = cleanAccuracy(body.accuracyM ?? body.locationAccuracyM);
  const precision = cleanPrecision(body.precision ?? body.locationPrecision);
  const capturedAt = cleanIso(body.capturedAt ?? body.locationCapturedAt) ?? new Date().toISOString();

  const display = buildLocationLabel({ label, city, region, country });
  // Require at least a displayable place or coordinates when sharing.
  if (!display && (lat == null || lng == null)) return null;

  return {
    share: true,
    label: display,
    city,
    region,
    country,
    lat,
    lng,
    accuracyM,
    precision: precision ?? (accuracyM != null && accuracyM > 500 ? "approximate" : "precise"),
    capturedAt,
  };
}

/** DB columns for posts (additive; keeps legacy `location` / lat / lng). */
export function postLocationColumns(loc: IncomingLocation | null): Record<string, unknown> {
  if (!loc) return {};
  return {
    location: loc.label ?? null,
    location_lat: loc.lat ?? null,
    location_lng: loc.lng ?? null,
    location_city: loc.city ?? null,
    location_region: loc.region ?? null,
    location_country: loc.country ?? null,
    location_accuracy_m: loc.accuracyM ?? null,
    location_precision: loc.precision ?? null,
    location_captured_at: loc.capturedAt ?? null,
    location_shared: true,
  };
}

/** DB columns for comments — independent of the parent Moment. */
export function commentLocationColumns(loc: IncomingLocation | null): Record<string, unknown> {
  if (!loc) {
    return {
      location_shared: false,
    };
  }
  return {
    location_label: loc.label ?? null,
    location_city: loc.city ?? null,
    location_region: loc.region ?? null,
    location_country: loc.country ?? null,
    location_lat: loc.lat ?? null,
    location_lng: loc.lng ?? null,
    location_accuracy_m: loc.accuracyM ?? null,
    location_precision: loc.precision ?? null,
    location_captured_at: loc.capturedAt ?? null,
    location_shared: true,
  };
}

/** Public-safe location fields (no coordinates). */
export function publicLocationFromRow(row: any): PublicLocation {
  if (!row) return {};
  const shared = row.location_shared === true || !!(row.location_label || row.location_city || row.location);
  if (!shared && !row.location_label && !row.location_city) return {};

  const label =
    buildLocationLabel({
      label: row.location_label ?? row.location,
      city: row.location_city,
      region: row.location_region,
      country: row.location_country,
    }) ?? undefined;

  return {
    ...(label ? { locationLabel: label } : {}),
    ...(row.location_city ? { locationCity: String(row.location_city) } : {}),
    ...(row.location_region ? { locationRegion: String(row.location_region) } : {}),
    ...(row.location_country ? { locationCountry: String(row.location_country) } : {}),
    ...(row.location_precision === "precise" || row.location_precision === "approximate"
      ? { locationPrecision: row.location_precision }
      : {}),
    ...(row.location_captured_at ? { locationCapturedAt: String(row.location_captured_at) } : {}),
    locationShared: shared,
  };
}
