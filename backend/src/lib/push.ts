// Centralized push notification service for Path+.
// Uses Expo Push API (routes to APNs on iOS when EAS credentials are configured).
// Failures are logged and never throw — main app actions must not depend on push delivery.
import { isPushEnabled } from "./external-config";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

/** Expo ticket errors that mean the token should be deactivated. */
const INVALID_TOKEN_ERRORS = new Set([
  "DeviceNotRegistered",
  "InvalidCredentials",
  "MismatchSenderId",
]);

function isExpoPushToken(token: string | null | undefined): token is string {
  return typeof token === "string" && token.startsWith("ExponentPushToken");
}

/** Coerce payload values to strings (Expo requirement for reliable deep links). */
export function stringifyPushData(data?: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  if (!data) return out;
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined || value === null) continue;
    out[key] = typeof value === "string" ? value : String(value);
  }
  return out;
}

async function deactivatePushToken(client: any, pushToken: string): Promise<void> {
  if (!pushToken) return;
  try {
    await client
      .from("user_devices")
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq("push_token", pushToken);

    // Legacy single-token column — clear if it still points at this token.
    await client.from("profiles").update({ push_token: null }).eq("push_token", pushToken);
  } catch (e) {
    console.error("[push] deactivate token error:", e);
  }
}

/**
 * Register or refresh a device push token for the authenticated user.
 * Supports multiple devices per user; dedupes by (user_id, device_id) and push_token.
 */
export async function upsertUserDevice(
  client: any,
  userId: string,
  opts: { pushToken: string; platform: string; deviceId: string }
): Promise<void> {
  const { pushToken, platform, deviceId } = opts;
  if (!isExpoPushToken(pushToken) || !deviceId) return;

  const now = new Date().toISOString();

  // If this push token belonged to another user/device, deactivate it first.
  await client
    .from("user_devices")
    .update({ is_active: false, updated_at: now })
    .eq("push_token", pushToken)
    .neq("user_id", userId);

  const { error } = await client.from("user_devices").upsert(
    {
      user_id: userId,
      push_token: pushToken,
      platform: platform || "unknown",
      device_id: deviceId,
      is_active: true,
      updated_at: now,
    },
    { onConflict: "user_id,device_id" }
  );

  if (error) {
    // Table may not exist yet on older deployments — keep legacy profile column working.
    console.warn("[push] user_devices upsert failed (using profiles.push_token):", error.message);
  }

  // Keep profiles.push_token in sync as a fallback for older code paths.
  await client
    .from("profiles")
    .update({ push_token: pushToken, push_notifications_enabled: true })
    .eq("id", userId);
}

/** Deactivate one device or all devices for a user (logout / opt-out). */
export async function deactivateUserDevices(
  client: any,
  userId: string,
  deviceId?: string | null
): Promise<void> {
  const now = new Date().toISOString();
  try {
    let query = client
      .from("user_devices")
      .update({ is_active: false, updated_at: now })
      .eq("user_id", userId);
    if (deviceId) query = query.eq("device_id", deviceId);
    await query;
  } catch (e) {
    console.warn("[push] deactivateUserDevices:", e);
  }

  if (!deviceId) {
    await client
      .from("profiles")
      .update({ push_token: null, push_notifications_enabled: false })
      .eq("id", userId);
  }
}

/** Returns true when the user has push notifications enabled. */
async function isUserPushEnabled(client: any, userId: string): Promise<boolean> {
  try {
    const { data } = await client
      .from("profiles")
      .select("push_notifications_enabled")
      .eq("id", userId)
      .maybeSingle();
    return data?.push_notifications_enabled !== false;
  } catch {
    return true;
  }
}

/** All active Expo push tokens for a user (multi-device + legacy fallback). */
export async function getPushTokensForUser(client: any, userId: string): Promise<string[]> {
  if (!(await isUserPushEnabled(client, userId))) return [];

  const tokens = new Set<string>();

  try {
    const { data: devices } = await client
      .from("user_devices")
      .select("push_token")
      .eq("user_id", userId)
      .eq("is_active", true);
    for (const row of devices ?? []) {
      if (isExpoPushToken(row.push_token)) tokens.add(row.push_token);
    }
  } catch {
    /* user_devices table may not exist yet */
  }

  if (tokens.size === 0) {
    try {
      const { data } = await client
        .from("profiles")
        .select("push_token")
        .eq("id", userId)
        .maybeSingle();
      if (isExpoPushToken(data?.push_token)) tokens.add(data.push_token);
    } catch {
      /* ignore */
    }
  }

  return [...tokens];
}

/** Backward-compatible helper — returns the first active token or null. */
export async function getPushToken(client: any, userId: string): Promise<string | null> {
  const tokens = await getPushTokensForUser(client, userId);
  return tokens[0] ?? null;
}

/** Send a push notification to a single Expo push token. Never throws. */
export async function sendPushNotification(
  pushToken: string | null | undefined,
  title: string,
  body: string,
  data?: Record<string, unknown>,
  client?: any
): Promise<void> {
  if (!isExpoPushToken(pushToken)) return;
  if (!(await isPushEnabled())) return;

  const stringData = stringifyPushData(data);

  try {
    const res = await fetch(EXPO_PUSH_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Accept-Encoding": "gzip, deflate",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        to: pushToken,
        title,
        body,
        data: stringData,
        sound: "default",
        priority: "high",
        channelId: "default",
      }),
    });

    const json: any = await res.json().catch(() => null);
    const ticket = Array.isArray(json?.data) ? json.data[0] : json?.data;

    if (ticket?.status === "error") {
      const errCode = ticket.details?.error ?? ticket.message;
      console.error("[push] Expo ticket error:", errCode, ticket.details);
      if (client && INVALID_TOKEN_ERRORS.has(errCode)) {
        await deactivatePushToken(client, pushToken);
      }
    }
  } catch (e) {
    console.error("[push] Failed to send notification:", e);
  }
}

/** Send a push to every active device belonging to a user. Never throws. */
export async function sendPushToUser(
  client: any,
  userId: string,
  title: string,
  body: string,
  data?: Record<string, unknown>
): Promise<void> {
  try {
    const tokens = await getPushTokensForUser(client, userId);
    if (tokens.length === 0) return;
    await Promise.all(
      tokens.map((token) => sendPushNotification(token, title, body, data, client))
    );
  } catch (e) {
    console.error("[push] sendPushToUser error:", e);
  }
}
