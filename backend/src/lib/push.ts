// Sends an Expo push notification to a specific Expo push token
// Uses Expo's free push notification service (not FCM directly).
import { isPushEnabled } from "./external-config";

export async function sendPushNotification(
  pushToken: string | null | undefined,
  title: string,
  body: string,
  data?: Record<string, any>
): Promise<void> {
  if (!pushToken || !pushToken.startsWith("ExponentPushToken")) return;

  if (!(await isPushEnabled())) return;

  // Expo requires all `data` values to be strings. Non-strings are dropped or
  // break deep-link handling on tap (app opens but never navigates).
  const stringData: Record<string, string> = {};
  if (data) {
    for (const [key, value] of Object.entries(data)) {
      if (value === undefined || value === null) continue;
      stringData[key] = typeof value === "string" ? value : String(value);
    }
  }

  try {
    const res = await fetch("https://exp.host/--/api/v2/push/send", {
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
      console.error("[push] Expo ticket error:", ticket.message, ticket.details);
    }
  } catch (e) {
    console.error("[push] Failed to send notification:", e);
  }
}

// Lookup push token for a user by their userId.
// Respects push_notifications_enabled — returns null when the user opted out.
export async function getPushToken(client: any, userId: string): Promise<string | null> {
  try {
    const { data } = await client
      .from("profiles")
      .select("push_token, push_notifications_enabled")
      .eq("id", userId)
      .single();

    if (!data) return null;
    if (data.push_notifications_enabled === false) return null;
    const token = data.push_token ?? null;
    if (token && !String(token).startsWith("ExponentPushToken")) {
      console.warn("[push] Ignoring non-Expo token for user", userId);
      return null;
    }
    return token;
  } catch {
    return null;
  }
}
