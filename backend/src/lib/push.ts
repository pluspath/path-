// Sends an Expo push notification to a specific Expo push token
// Uses Expo's free push notification service
export async function sendPushNotification(
  pushToken: string | null | undefined,
  title: string,
  body: string,
  data?: Record<string, any>
): Promise<void> {
  if (!pushToken || !pushToken.startsWith('ExponentPushToken')) return;

  try {
    await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        to: pushToken,
        title,
        body,
        data: data ?? {},
        sound: 'default',
        priority: 'high',
      }),
    });
  } catch (e) {
    // Non-critical: log but don't crash
    console.error('[push] Failed to send notification:', e);
  }
}

// Lookup push token for a user by their userId
// Uses supabaseAdmin to bypass RLS
export async function getPushToken(supabaseAdmin: any, userId: string): Promise<string | null> {
  try {
    const { data } = await supabaseAdmin
      .from('profiles')
      .select('push_token')
      .eq('id', userId)
      .single();
    return data?.push_token ?? null;
  } catch {
    return null;
  }
}
