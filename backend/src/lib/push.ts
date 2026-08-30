// Centralized push notification service for Path+.
// Architecture: Backend → Expo Push Service → APNs/FCM → device
// Uses ExponentPushToken[...] tokens from expo-notifications (NOT raw APNs tokens).
// Failures are logged; main app actions never depend on push delivery.
import { env } from "../env";
import { isPushEnabled } from "./external-config";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const EXPO_PUSH_RECEIPTS_URL = "https://exp.host/--/api/v2/push/getReceipts";

/**
 * Expo receipt/ticket errors that mean THIS DEVICE TOKEN is dead.
 * Do NOT include credential/config errors (InvalidCredentials, InvalidProviderToken,
 * MismatchSenderId) — those are EAS/APNs setup problems; wiping tokens hides the
 * real issue and permanently breaks push until the user reopens the app.
 * Previous working Path+ never deactivated tokens on send failure.
 */
const DEAD_TOKEN_ERRORS = new Set(["DeviceNotRegistered"]);

export type PushDeliveryResult = {
  ok: boolean;
  tokenSuffix: string;
  ticketId?: string;
  ticketStatus?: string;
  ticketError?: string;
  receiptStatus?: string;
  receiptError?: string;
  message: string;
};

function isExpoPushToken(token: string | null | undefined): token is string {
  return typeof token === "string" && token.startsWith("ExponentPushToken");
}

function tokenSuffix(token: string): string {
  return token.length > 12 ? `…${token.slice(-8)}` : "…";
}

function pushHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Accept-Encoding": "gzip, deflate",
    "Content-Type": "application/json",
  };
  const accessToken = env.EXPO_ACCESS_TOKEN?.trim();
  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }
  return headers;
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

    await client.from("profiles").update({ push_token: null }).eq("push_token", pushToken);
    console.log(`[push] Deactivated invalid token ${tokenSuffix(pushToken)}`);
  } catch (e) {
    console.error("[push] deactivate token error:", e);
  }
}

async function maybeDeactivateDeadToken(
  client: any | undefined,
  pushToken: string,
  errCode: string
): Promise<void> {
  if (client && DEAD_TOKEN_ERRORS.has(errCode)) {
    await deactivatePushToken(client, pushToken);
    return;
  }
  if (errCode === "InvalidCredentials" || errCode === "InvalidProviderToken") {
    console.error(
      "[push] CRITICAL: Expo/APNs credentials invalid on EAS project — " +
        "upload the APNs Auth Key (.p8) for com.mazyd.pathplus in Expo credentials. " +
        "Device tokens were NOT deactivated."
    );
  }
}

async function fetchPushReceipts(ticketIds: string[]): Promise<Record<string, any>> {
  if (ticketIds.length === 0) return {};
  try {
    const res = await fetch(EXPO_PUSH_RECEIPTS_URL, {
      method: "POST",
      headers: pushHeaders(),
      body: JSON.stringify({ ids: ticketIds }),
    });
    const json: any = await res.json().catch(() => null);
    return json?.data ?? {};
  } catch (e) {
    console.error("[push] fetch receipts failed:", e);
    return {};
  }
}

async function waitForReceipt(ticketId: string, attempts = 5, delayMs = 1500): Promise<any> {
  for (let i = 0; i < attempts; i++) {
    await new Promise((r) => setTimeout(r, delayMs));
    const receipts = await fetchPushReceipts([ticketId]);
    if (receipts[ticketId]) return receipts[ticketId];
  }
  return null;
}

function scheduleReceiptCheck(
  ticketId: string,
  pushToken: string,
  client?: any
): void {
  void (async () => {
    const receipt = await waitForReceipt(ticketId, 4, 2000);
    if (!receipt) return;

    if (receipt.status === "error") {
      const errCode = receipt.details?.error ?? receipt.message ?? "unknown";
      console.error(`[push] Receipt error for ${tokenSuffix(pushToken)}:`, errCode, receipt.details);
      await maybeDeactivateDeadToken(client, pushToken, errCode);
    } else {
      console.log(`[push] Receipt OK for ${tokenSuffix(pushToken)} (ticket ${ticketId.slice(0, 8)}…)`);
    }
  })();
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

  // UNIQUE(push_token): remove any other row holding this token so upsert cannot fail.
  await client
    .from("user_devices")
    .delete()
    .eq("push_token", pushToken)
    .or(`user_id.neq.${userId},device_id.neq.${deviceId}`);

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
    console.warn("[push] user_devices upsert failed (using profiles.push_token):", error.message);
  } else {
    console.log(
      `[push] Token saved user=${userId.slice(0, 8)}… platform=${platform} device=${deviceId.slice(0, 8)}…`
    );
  }

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

/** All active Expo push tokens for a user (multi-device + legacy profiles.push_token). */
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

  // Always merge legacy profiles.push_token (previous working Path+ stored only here).
  // Do not skip it when user_devices has stale active rows.
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

  return [...tokens];
}

export type PushDeviceSummary = {
  pushEnabledGlobally: boolean;
  pushEnabledForUser: boolean;
  activeDeviceCount: number;
  legacyProfileToken: boolean;
  platforms: string[];
};

/** Diagnostic summary for a user's push registration (no full tokens exposed). */
export async function getPushStatusForUser(
  client: any,
  userId: string
): Promise<PushDeviceSummary> {
  const pushEnabledGlobally = await isPushEnabled();
  const pushEnabledForUser = await isUserPushEnabled(client, userId);

  const platforms: string[] = [];
  let activeDeviceCount = 0;

  try {
    const { data: devices } = await client
      .from("user_devices")
      .select("platform")
      .eq("user_id", userId)
      .eq("is_active", true);
    for (const row of devices ?? []) {
      activeDeviceCount++;
      if (row.platform) platforms.push(row.platform);
    }
  } catch {
    /* ignore */
  }

  let legacyProfileToken = false;
  try {
    const { data } = await client
      .from("profiles")
      .select("push_token")
      .eq("id", userId)
      .maybeSingle();
    legacyProfileToken = isExpoPushToken(data?.push_token);
  } catch {
    /* ignore */
  }

  if (activeDeviceCount === 0 && legacyProfileToken) {
    activeDeviceCount = 1;
  }

  return {
    pushEnabledGlobally,
    pushEnabledForUser,
    activeDeviceCount,
    legacyProfileToken,
    platforms,
  };
}

/** Backward-compatible helper — returns the first active token or null. */
export async function getPushToken(client: any, userId: string): Promise<string | null> {
  const tokens = await getPushTokensForUser(client, userId);
  return tokens[0] ?? null;
}

/** Send a push notification and optionally wait for the Expo receipt. Never throws. */
export async function sendPushNotificationDetailed(
  pushToken: string | null | undefined,
  title: string,
  body: string,
  data?: Record<string, unknown>,
  client?: any,
  opts?: { waitForReceipt?: boolean }
): Promise<PushDeliveryResult> {
  const suffix = pushToken ? tokenSuffix(pushToken) : "none";

  if (!isExpoPushToken(pushToken)) {
    return { ok: false, tokenSuffix: suffix, message: "Invalid or missing Expo push token" };
  }

  if (!(await isPushEnabled())) {
    console.warn("[push] Push disabled in Admin settings — notification skipped");
    return { ok: false, tokenSuffix: suffix, message: "Push notifications disabled in Admin settings" };
  }

  const stringData = stringifyPushData(data);

  try {
    const res = await fetch(EXPO_PUSH_URL, {
      method: "POST",
      headers: pushHeaders(),
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

    if (!res.ok) {
      const msg = json?.errors?.[0]?.message ?? `HTTP ${res.status}`;
      console.error(`[push] Expo HTTP error for ${suffix}:`, msg);
      return { ok: false, tokenSuffix: suffix, message: msg };
    }

    if (ticket?.status === "error") {
      const errCode = ticket.details?.error ?? ticket.message ?? "unknown";
      console.error(`[push] Expo ticket error for ${suffix}:`, errCode, ticket.details);
      await maybeDeactivateDeadToken(client, pushToken, errCode);
      return {
        ok: false,
        tokenSuffix: suffix,
        ticketStatus: "error",
        ticketError: errCode,
        message: `Expo ticket error: ${errCode}`,
      };
    }

    const ticketId = ticket?.id as string | undefined;
    console.log(`[push] Ticket OK for ${suffix}${ticketId ? ` id=${ticketId.slice(0, 8)}…` : ""}`);

    if (!ticketId) {
      return { ok: true, tokenSuffix: suffix, ticketStatus: "ok", message: "Push ticket accepted (no id)" };
    }

    if (opts?.waitForReceipt) {
      const receipt = await waitForReceipt(ticketId);
      if (!receipt) {
        return {
          ok: true,
          tokenSuffix: suffix,
          ticketId,
          ticketStatus: "ok",
          message: "Push ticket accepted; receipt not yet available",
        };
      }
      if (receipt.status === "error") {
        const errCode = receipt.details?.error ?? receipt.message ?? "unknown";
        console.error(`[push] Receipt error for ${suffix}:`, errCode, receipt.details);
        await maybeDeactivateDeadToken(client, pushToken, errCode);
        return {
          ok: false,
          tokenSuffix: suffix,
          ticketId,
          ticketStatus: "ok",
          receiptStatus: "error",
          receiptError: errCode,
          message: `Expo receipt error: ${errCode}`,
        };
      }
      return {
        ok: true,
        tokenSuffix: suffix,
        ticketId,
        ticketStatus: "ok",
        receiptStatus: "ok",
        message: "Push delivered (receipt OK)",
      };
    }

    scheduleReceiptCheck(ticketId, pushToken, client);
    return {
      ok: true,
      tokenSuffix: suffix,
      ticketId,
      ticketStatus: "ok",
      message: "Push ticket accepted",
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    console.error(`[push] Failed to send to ${suffix}:`, msg);
    return { ok: false, tokenSuffix: suffix, message: msg };
  }
}

/** Send a push notification to a single Expo push token. Never throws. */
export async function sendPushNotification(
  pushToken: string | null | undefined,
  title: string,
  body: string,
  data?: Record<string, unknown>,
  client?: any
): Promise<void> {
  await sendPushNotificationDetailed(pushToken, title, body, data, client);
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
    if (tokens.length === 0) {
      console.log(`[push] No active tokens for user ${userId.slice(0, 8)}… — skipped`);
      return;
    }
    console.log(
      `[push] Sending "${title}" to user ${userId.slice(0, 8)}… (${tokens.length} device(s))`
    );
    await Promise.all(
      tokens.map((token) => sendPushNotification(token, title, body, data, client))
    );
  } catch (e) {
    console.error("[push] sendPushToUser error:", e);
  }
}
