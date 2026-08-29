import { Resend } from "resend";
import { getEmailConfig, type EmailConfig } from "./external-config";
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

function mapEmailSendError(raw: string): string {
  return toSafeUserMessage(raw, "Unable to send email. Please try again later.");
}

function logResendFailure(context: string, error: { message?: string; name?: string }): void {
  const name = error.name ?? "unknown";
  const message = sanitizeProviderError(error.message ?? "unknown");
  console.error(`[email] ${context}: name=${name} message=${message}`);
}

export async function sendEmail(
  input: SendEmailInput
): Promise<{ ok: true } | { ok: false; message: string }> {
  const config = await getEmailConfig();
  if (!config.enabled) {
    return { ok: false, message: "Email service is disabled." };
  }
  if (!config.apiKey) {
    console.error("[email] send blocked: RESEND_API_KEY not configured (source: none)");
    return { ok: false, message: "Unable to send email. Please try again later." };
  }
  if (config.provider !== "resend") {
    return { ok: false, message: "Unable to send email. Please try again later." };
  }

  try {
    const resend = new Resend(config.apiKey);
    const { error } = await resend.emails.send({
      from: config.fromEmail,
      to: input.to,
      subject: input.subject,
      html: input.html,
      replyTo: input.replyTo || config.replyTo || undefined,
    });
    if (error) {
      logResendFailure("send failed", error);
      console.error(`[email] from=${config.fromEmail.replace(/@.+/, "@***")} keySource=${config.apiKeySource}`);
      return { ok: false, message: mapEmailSendError(error.message) };
    }
    return { ok: true };
  } catch (e) {
    const raw = e instanceof Error ? e.message : "unknown";
    console.error("[email] send exception:", sanitizeProviderError(raw));
    return { ok: false, message: mapEmailSendError(raw) };
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

export async function sendSignupOtpEmail(
  email: string,
  otp: string,
  fullName: string
): Promise<void> {
  const config = await getEmailConfig();
  if (!config.templates.signupOtp.enabled) {
    throw new Error("Signup verification emails are disabled.");
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
  if (!result.ok) throw new Error(result.message);
}

export async function sendPasswordResetOtpEmail(email: string, otp: string): Promise<void> {
  const config = await getEmailConfig();
  if (!config.templates.passwordResetOtp.enabled) {
    throw new Error("Password reset emails are disabled.");
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
  if (!result.ok) throw new Error(result.message);
}

export async function sendAccountDeletionEmail(email: string, fullName: string): Promise<void> {
  const config = await getEmailConfig();
  if (!config.templates.accountDeletion.enabled) return;
  const name = fullName || "there";
  const result = await sendEmail({
    to: email,
    subject: config.templates.accountDeletion.subject,
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 32px;">
        <h2 style="color: #0A1F44; margin-bottom: 8px;">Hi ${escapeHtml(name)},</h2>
        <p style="color: #475569; line-height: 1.6; margin-bottom: 16px;">
          Your Path+ account has been suspended for <strong>30 days</strong> as requested.
          During this period your profile and data are kept but hidden from other users.
        </p>
        <p style="color: #475569; line-height: 1.6; margin-bottom: 16px;">
          If you sign in again within 30 days, your account will be <strong>reactivated automatically</strong>
          and deletion will be cancelled.
        </p>
        <p style="color: #475569; line-height: 1.6; margin-bottom: 24px;">
          If you do not sign in within 30 days, your account and associated data will be
          permanently deleted from our servers.
        </p>
        <p style="color: #94A3B8; font-size: 13px;">If you did not request this, contact privacy@pathplus.store immediately.</p>
      </div>
    `,
  });
  if (!result.ok) {
    console.error("[account-deletion] suspension email failed:", result.message);
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
