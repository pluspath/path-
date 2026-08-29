/**
 * Push notification diagnostic — checks Admin push toggle, token registry, and Expo Push API.
 * Usage: bun run diagnose:push [userId]
 * Does not print full push tokens or secrets.
 */
import { supabaseAdmin } from "../src/supabase";
import { getPushStatusForUser, getPushTokensForUser, sendPushNotificationDetailed } from "../src/lib/push";
import { isPushEnabled } from "../src/lib/external-config";

async function main() {
  const userId = process.argv[2]?.trim();

  console.log("\n=== Path+ Push Diagnostic ===\n");
  console.log("Architecture: Backend → Expo Push Service → APNs/FCM");
  console.log("Token type:   ExponentPushToken[...] (NOT raw APNs device token)");
  console.log("Bundle ID:    com.mazyd.pathplus");
  console.log("EAS Project:  a6adef19-c35b-4fc7-b4b9-6bc4af060d39\n");

  const pushEnabled = await isPushEnabled();
  console.log(`1. Push enabled (Admin): ${pushEnabled ? "YES" : "NO — all sends skipped"}`);

  if (!userId) {
    console.log("\n2. No userId provided — skipping per-user checks.");
    console.log("   Usage: bun run diagnose:push <user-uuid>");
    console.log("\n   To find users with tokens:");
    const { data: devices, error } = await supabaseAdmin
      .from("user_devices")
      .select("user_id, platform, is_active, updated_at")
      .eq("is_active", true)
      .limit(10);
    if (error) {
      console.log(`   user_devices query failed: ${error.message}`);
    } else if (!devices?.length) {
      console.log("   No active devices in user_devices table.");
      const { data: profiles } = await supabaseAdmin
        .from("profiles")
        .select("id, push_token")
        .not("push_token", "is", null)
        .limit(5);
      console.log(`   Legacy profiles.push_token rows: ${profiles?.length ?? 0}`);
      for (const p of profiles ?? []) {
        console.log(`     user ${p.id.slice(0, 8)}… has legacy token`);
      }
    } else {
      for (const d of devices) {
        console.log(
          `     user ${d.user_id.slice(0, 8)}… platform=${d.platform} updated=${d.updated_at}`
        );
      }
    }
    process.exit(pushEnabled ? 0 : 1);
  }

  const status = await getPushStatusForUser(supabaseAdmin, userId);
  console.log(`2. User push enabled:     ${status.pushEnabledForUser ? "YES" : "NO"}`);
  console.log(`3. Active devices:        ${status.activeDeviceCount}`);
  console.log(`4. Platforms:            ${status.platforms.join(", ") || "none"}`);
  console.log(`5. Legacy profile token: ${status.legacyProfileToken ? "YES" : "NO"}`);

  const tokens = await getPushTokensForUser(supabaseAdmin, userId);
  console.log(`6. Expo tokens found:     ${tokens.length}`);

  if (tokens.length === 0) {
    console.log("\nFAIL: No push tokens. User must open app on physical device, grant permission, sign in.");
    process.exit(1);
  }

  if (!pushEnabled) {
    console.log("\nFAIL: Push disabled globally.");
    process.exit(1);
  }

  console.log("\n7. Sending test notification (with receipt check)…");
  const result = await sendPushNotificationDetailed(
    tokens[0],
    "Path+ Test Notification",
    "Push notifications are working correctly.",
    { type: "test" },
    supabaseAdmin,
    { waitForReceipt: true }
  );

  console.log(`   Ticket:  ${result.ticketStatus ?? "n/a"}`);
  if (result.ticketError) console.log(`   Ticket error: ${result.ticketError}`);
  console.log(`   Receipt: ${result.receiptStatus ?? "pending/unavailable"}`);
  if (result.receiptError) console.log(`   Receipt error: ${result.receiptError}`);
  console.log(`   Result:  ${result.message}`);

  if (result.receiptError === "InvalidCredentials") {
    console.log(
      "\n   → InvalidCredentials means APNs credentials are NOT configured in EAS for this project."
    );
    console.log("     Run: eas credentials -p ios");
    console.log("     Upload your APNs Auth Key (.p8) with correct Key ID + Team ID.");
  }

  process.exit(result.ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
