import { Resend } from "resend";
import { getEmailConfig, type EmailConfig } from "./external-config";
import {
  emailCircuitReason,
  emailCircuitRetryAfterSec,
  isEmailCircuitOpen,
  noteEmailProviderFailure,
  noteEmailQuotaExceeded,
} from "./email-circuit";
import { toSafeUserMessage } from "./safe-errors";

/**
 * Central email sender. Callers never touch Resend keys or SMTP secrets.
 * Configuration comes from Admin DB (preferred) or environment fallback.
 */

export type SendEmailInput = {
  to: string | string[];
  subject: string;
  html: string;
  replyTo?: string;
};

export type SendEmailResult =
  | { ok: true; emailId?: string }
  | { ok: false; message: string; code?: "EMAIL_QUOTA_EXCEEDED" | "VERIFICATION_EMAIL_FAILED"; retryAfterSec?: number };

function sanitizeProviderError(message: string): string {
  // Strip anything that looks like a key or long token
  return message
    .replace(/re_[A-Za-z0-9_-]+/g, "[redacted]")
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/sk_[A-Za-z0-9_-]+/g, "[redacted]")
    .slice(0, 240);
}

export async function resolveEmailConfig(): Promise<EmailConfig> {
  return getEmailConfig();
}

function isQuotaError(name?: string, message?: string): "daily" | "monthly" | null {
  const blob = `${name ?? ""} ${message ?? ""}`.toLowerCase();
  if (/monthly_quota|monthly email quota|monthly sending quota/.test(blob)) return "monthly";
  if (/daily_quota|daily email quota|daily sending quota|reached_daily_quota/.test(blob)) return "daily";
  return null;
}

function mapEmailSendError(raw: string): string {
  const quota = isQuotaError(undefined, raw);
  if (quota) {
    return "Unable to send the verification email. Please try again later.";
  }
  return toSafeUserMessage(raw, "Unable to send the verification email. Please try again later.");
}

function logResendFailure(context: string, error: { message?: string; name?: string }): void {
  const name = error.name ?? "unknown";
  const message = sanitizeProviderError(error.message ?? "unknown");
  console.error(`[email] ${context}: name=${name} message=${message}`);
}

function quotaFailureResult(kind: "daily" | "monthly"): SendEmailResult {
  noteEmailQuotaExceeded(kind);
  return {
    ok: false,
    code: "EMAIL_QUOTA_EXCEEDED",
    message: "Unable to send the verification email. Please try again later.",
    retryAfterSec: emailCircuitRetryAfterSec(),
  };
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Resend may accept a send then asynchronously mark it failed (quota).
 * Poll briefly so registration does not claim success when delivery already failed.
 */
async function confirmAcceptedSend(
  resend: Resend,
  emailId: string
): Promise<{ ok: true } | { ok: false; quota?: "daily" | "monthly"; reason?: string }> {
  for (let i = 0; i < 3; i++) {
    await sleep(700);
    try {
      const { data, error } = await resend.emails.get(emailId);
      if (error) continue;
      const lastEvent = String((data as { last_event?: string } | null)?.last_event ?? "");
      if (!lastEvent || lastEvent === "queued" || lastEvent === "scheduled") continue;
      if (lastEvent === "failed" || lastEvent === "suppressed" || lastEvent === "bounced") {
        const reason = `last_event=${lastEvent}`;
        // Quota failures commonly appear as accepted-then-failed with null message_id.
        const messageId = (data as { message_id?: string | null } | null)?.message_id;
        if (!messageId) {
          return { ok: false, quota: "daily", reason };
        }
        return { ok: false, reason };
      }
      // delivered / sent / delivery_delayed / opened / clicked → treat as accepted
      return { ok: true };
    } catch {
      // ignore transient get failures
    }
  }
  // No failure observed in the short window — proceed.
  return { ok: true };
}

export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  if (isEmailCircuitOpen()) {
    const reason = emailCircuitReason();
    console.warn(`[email] send blocked by circuit reason=${reason ?? "unknown"}`);
    return {
      ok: false,
      code: reason === "daily_quota" || reason === "monthly_quota" ? "EMAIL_QUOTA_EXCEEDED" : "VERIFICATION_EMAIL_FAILED",
      message: "Unable to send the verification email. Please try again later.",
      retryAfterSec: emailCircuitRetryAfterSec(),
    };
  }

  const config = await getEmailConfig();
  if (!config.enabled) {
    return { ok: false, code: "VERIFICATION_EMAIL_FAILED", message: "Email service is disabled." };
  }
  if (!config.apiKey) {
    console.error("[email] send blocked: RESEND_API_KEY not configured (source: none)");
    return {
      ok: false,
      code: "VERIFICATION_EMAIL_FAILED",
      message: "Unable to send the verification email. Please try again later.",
    };
  }
  if (config.provider !== "resend") {
    return {
      ok: false,
      code: "VERIFICATION_EMAIL_FAILED",
      message: "Unable to send the verification email. Please try again later.",
    };
  }

  try {
    const resend = new Resend(config.apiKey);
    const { data, error } = await resend.emails.send({
      from: config.fromEmail,
      to: input.to,
      subject: input.subject,
      html: input.html,
      replyTo: input.replyTo || config.replyTo || undefined,
    });
    if (error) {
      logResendFailure("send failed", error);
      console.error(`[email] from=${config.fromEmail.replace(/@.+/, "@***")} keySource=${config.apiKeySource}`);
      const quota = isQuotaError(error.name, error.message);
      if (quota) return quotaFailureResult(quota);
      noteEmailProviderFailure(30_000);
      return {
        ok: false,
        code: "VERIFICATION_EMAIL_FAILED",
        message: mapEmailSendError(error.message ?? "send failed"),
      };
    }

    const emailId = data?.id ? String(data.id) : undefined;
    if (emailId) {
      const confirm = await confirmAcceptedSend(resend, emailId);
      if (!confirm.ok) {
        console.error(`[email] accepted then failed id=${emailId.slice(0, 10)}… reason=${confirm.reason ?? "unknown"}`);
        if (confirm.quota) return quotaFailureResult(confirm.quota);
        noteEmailProviderFailure(30_000);
        return {
          ok: false,
          code: "VERIFICATION_EMAIL_FAILED",
          message: "Unable to send the verification email. Please try again later.",
        };
      }
    }

    return { ok: true, emailId };
  } catch (e) {
    const raw = e instanceof Error ? e.message : "unknown";
    console.error("[email] send exception:", sanitizeProviderError(raw));
    const quota = isQuotaError(undefined, raw);
    if (quota) return quotaFailureResult(quota);
    noteEmailProviderFailure(30_000);
    return {
      ok: false,
      code: "VERIFICATION_EMAIL_FAILED",
      message: mapEmailSendError(raw),
    };
  }
}

/**
 * Verify Resend API key without sending mail.
 * Uses domains.list — that endpoint requires a Full access key.
 * Sending-only keys return restricted_api_key (401); that is OK for Path+
 * (signup/reset only call emails.send).
 */
export async function testEmailProviderConnection(): Promise<{
  ok: boolean;
  message: string;
}> {
  const config = await getEmailConfig();
  if (!config.enabled) {
    return { ok: false, message: "Email service is disabled." };
  }
  if (!config.apiKey) {
    return { ok: false, message: "Configuration incomplete — API key is missing." };
  }

  try {
    const resend = new Resend(config.apiKey);
    const { data, error } = await resend.domains.list();
    if (error) {
      const msg = sanitizeProviderError(error.message);
      const name = typeof (error as { name?: string }).name === "string"
        ? (error as { name: string }).name
        : "";
      // Sending-only keys cannot list domains — email sending still works.
      if (
        name === "restricted_api_key" ||
        /restricted_api_key|restricted to only send/i.test(msg)
      ) {
        return {
          ok: true,
          message:
            "Send-only API key OK (domains list blocked; email sending is allowed).",
        };
      }
      if (/unauthorized|invalid.?api.?key|forbidden|missing.?api.?key/i.test(msg)) {
        return { ok: false, message: "Authentication failed. Check the API key." };
      }
      return { ok: false, message: "Provider rejected the connection." };
    }
    const count = Array.isArray((data as { data?: unknown[] })?.data)
      ? (data as { data: unknown[] }).data.length
      : Array.isArray(data)
        ? data.length
        : 0;
    return {
      ok: true,
      message:
        count > 0
          ? `Connection successful (${count} domain(s) visible).`
          : "Connection successful.",
    };
  } catch (e) {
    const raw = e instanceof Error ? e.message : "unknown";
    console.error("[email] test failed:", sanitizeProviderError(raw));
    if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|network/i.test(raw)) {
      return { ok: false, message: "Could not reach the email provider." };
    }
    return { ok: false, message: "The external service configuration is invalid." };
  }
}

export class EmailSendError extends Error {
  code: "EMAIL_QUOTA_EXCEEDED" | "VERIFICATION_EMAIL_FAILED";
  retryAfterSec?: number;
  constructor(
    message: string,
    code: "EMAIL_QUOTA_EXCEEDED" | "VERIFICATION_EMAIL_FAILED" = "VERIFICATION_EMAIL_FAILED",
    retryAfterSec?: number
  ) {
    super(message);
    this.name = "EmailSendError";
    this.code = code;
    this.retryAfterSec = retryAfterSec;
  }
}

export async function sendSignupOtpEmail(
  email: string,
  otp: string,
  fullName: string
): Promise<void> {
  const config = await getEmailConfig();
  if (!config.templates.signupOtp.enabled) {
    throw new EmailSendError("Signup verification emails are disabled.");
  }
  const site = config.publicAppUrl;
  if (/localhost|127\.0\.0\.1/i.test(site)) {
    console.warn(
      "[email] publicAppUrl resolves to localhost — set a production URL for auth emails"
    );
  }
  const result = await sendEmail({
    to: email,
    subject: config.templates.signupOtp.subject,
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 32px;">
        <h2 style="color: #0A1F44; margin-bottom: 8px;">Hi ${escapeHtml(fullName)},</h2>
        <p style="color: #475569; margin-bottom: 24px;">Your Path+ verification code is:</p>
        <div style="background: #F1F5F9; border-radius: 12px; padding: 24px; text-align: center; margin-bottom: 24px;">
          <span style="font-size: 40px; font-weight: 700; letter-spacing: 8px; color: #0A1F44;">${escapeHtml(otp)}</span>
        </div>
        <p style="color: #94A3B8; font-size: 13px;">This code expires in 10 minutes. Open the Path+ app and enter the code to finish signing up.</p>
        <p style="color: #94A3B8; font-size: 12px; margin-top: 16px;">Learn more at <a href="${escapeAttr(site)}" style="color:#0A1F44;">${escapeHtml(site.replace(/^https?:\/\//, ""))}</a></p>
      </div>
    `,
  });
  if (!result.ok) {
    throw new EmailSendError(result.message, result.code ?? "VERIFICATION_EMAIL_FAILED", result.retryAfterSec);
  }
}

export async function sendPasswordResetOtpEmail(email: string, otp: string): Promise<void> {
  const config = await getEmailConfig();
  if (!config.templates.passwordResetOtp.enabled) {
    throw new EmailSendError("Password reset emails are disabled.");
  }
  const site = config.publicAppUrl;
  if (/localhost|127\.0\.0\.1/i.test(site)) {
    console.warn(
      "[password-reset] publicAppUrl resolves to localhost — set PUBLIC_APP_URL / Admin email publicAppUrl for production"
    );
  }
  const result = await sendEmail({
    to: email,
    subject: config.templates.passwordResetOtp.subject,
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 32px;">
        <h2 style="color: #0A1F44; margin-bottom: 8px;">Reset your password</h2>
        <p style="color: #475569; margin-bottom: 24px;">Use this code in the Path+ app to reset your password. No link is required.</p>
        <div style="background: #F1F5F9; border-radius: 12px; padding: 24px; text-align: center; margin-bottom: 24px;">
          <span style="font-size: 40px; font-weight: 700; letter-spacing: 8px; color: #0A1F44;">${escapeHtml(otp)}</span>
        </div>
        <p style="color: #94A3B8; font-size: 13px;">This code expires in 10 minutes and can only be used once. If you didn't request this, ignore this email.</p>
        <p style="color: #94A3B8; font-size: 12px; margin-top: 16px;">Path+ · <a href="${escapeAttr(site)}" style="color:#0A1F44;">${escapeHtml(site.replace(/^https?:\/\//, ""))}</a></p>
      </div>
    `,
  });
  if (!result.ok) {
    throw new EmailSendError(result.message, result.code ?? "VERIFICATION_EMAIL_FAILED", result.retryAfterSec);
  }
}

export async function sendAccountDeletionEmail(
  email: string,
  fullName: string,
  username?: string
): Promise<void> {
  const config = await getEmailConfig();
  if (!config.templates.accountDeletion.enabled) return;
  const name = fullName || "there";
  const handle = (username || "").trim();
  const result = await sendEmail({
    to: email,
    subject: config.templates.accountDeletion.subject,
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 32px;">
        <h2 style="color: #0A1F44; margin-bottom: 8px;">Hi ${escapeHtml(name)},</h2>
        <p style="color: #475569; line-height: 1.6; margin-bottom: 16px;">
          You requested deletion of your Path+ account. A <strong>30-day grace period</strong> has started.
        </p>
        <p style="color: #475569; line-height: 1.6; margin-bottom: 16px;">
          <strong>What happens now:</strong>
        </p>
        <ul style="color: #475569; line-height: 1.7; padding-left: 20px; margin-bottom: 16px;">
          <li>Your profile, posts, and moments are <strong>hidden from other users</strong>.</li>
          <li>Your username${handle ? ` (<strong>@${escapeHtml(handle)}</strong>)` : ""} stays reserved and <strong>cannot be claimed by anyone else</strong> during these 30 days.</li>
          <li>Sign in to Path+ within 30 days to <strong>cancel deletion and reactivate</strong> your account automatically.</li>
        </ul>
        <p style="color: #475569; line-height: 1.6; margin-bottom: 16px;">
          On day 29 we will email you a final reminder. If you do not sign in within 30 days,
          your account, content, username, and related data will be <strong>permanently deleted</strong>
          and the username will become available again.
        </p>
        <p style="color: #94A3B8; font-size: 13px;">If you did not request this, sign in to Path+ immediately or contact privacy@pathplus.store.</p>
      </div>
    `,
  });
  if (!result.ok) {
    console.error("[account-deletion] suspension email failed:", result.message);
  }
}

/** Day-29 reminder: permanent wipe of data + username is about to happen. */
export async function sendAccountDeletionReminderEmail(
  email: string,
  fullName: string,
  username?: string
): Promise<void> {
  const config = await getEmailConfig();
  if (!config.templates.accountDeletion.enabled) return;
  const name = fullName || "there";
  const handle = (username || "").trim();
  const result = await sendEmail({
    to: email,
    subject: "Reminder: your Path+ account will be permanently deleted tomorrow",
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 32px;">
        <h2 style="color: #0A1F44; margin-bottom: 8px;">Hi ${escapeHtml(name)},</h2>
        <p style="color: #475569; line-height: 1.6; margin-bottom: 16px;">
          This is a reminder that your Path+ account deletion grace period ends <strong>tomorrow</strong>.
        </p>
        <p style="color: #475569; line-height: 1.6; margin-bottom: 16px;">
          If you do not sign in before then, the following will be <strong>permanently removed</strong>:
        </p>
        <ul style="color: #475569; line-height: 1.7; padding-left: 20px; margin-bottom: 16px;">
          <li>Your profile and account</li>
          <li>Your posts, moments, and related content</li>
          <li>Your friendships and other account data</li>
          <li>Your username${handle ? ` (<strong>@${escapeHtml(handle)}</strong>)` : ""}, which will then become available for others to claim</li>
        </ul>
        <p style="color: #475569; line-height: 1.6; margin-bottom: 24px;">
          To keep your account, <strong>sign in to Path+ now</strong>. Signing in within the grace period
          cancels deletion and restores your account automatically.
        </p>
        <p style="color: #94A3B8; font-size: 13px;">If you need help, contact privacy@pathplus.store.</p>
      </div>
    `,
  });
  if (!result.ok) {
    console.error("[account-deletion] reminder email failed:", result.message);
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/'/g, "&#39;");
}
