/**
 * Send a test email through Resend (validates API key + from address).
 * Usage: TEST_EMAIL=you@example.com bun run scripts/test-resend-send.ts
 */
import { getEmailConfig } from "../src/lib/external-config";
import { sendEmail } from "../src/lib/email-service";

const to = process.env.TEST_EMAIL?.trim();
if (!to) {
  console.error("Set TEST_EMAIL to the recipient address, e.g.:");
  console.error("  TEST_EMAIL=you@example.com bun run scripts/test-resend-send.ts");
  process.exit(1);
}

const cfg = await getEmailConfig();
console.log("Email service enabled:", cfg.enabled);
console.log("API key source:", cfg.apiKeySource);
console.log("From:", cfg.fromEmail.replace(/@.+/, "@***"));
console.log("To:", to.replace(/@.+/, "@***"));
console.log("");

if (!cfg.apiKey) {
  console.error("FAIL: RESEND_API_KEY is not configured.");
  process.exit(1);
}

const result = await sendEmail({
  to,
  subject: "Path+ email test",
  html: "<p>If you received this, Resend is configured correctly.</p>",
});

if (result.ok) {
  console.log("SUCCESS: Test email sent.");
} else {
  console.error("FAIL:", result.message);
  console.error("");
  console.error("Common fixes:");
  console.error("  1. Create a new API key at https://resend.com/api-keys");
  console.error("  2. Verify pathplus.store at https://resend.com/domains");
  console.error("  3. Set RESEND_FROM_EMAIL=onboarding@resend.dev (test) or a verified domain address in backend/.env");
  console.error("  4. Restart the backend after updating .env");
  process.exit(1);
}
