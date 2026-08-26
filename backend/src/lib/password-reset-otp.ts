import { Resend } from "resend";
import { supabaseAdmin } from "../supabase";
import { env } from "../env";
import { publicAppUrl, resendFromAddress } from "./email-from";

const OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes
const MAX_ATTEMPTS = 5;
const RATE_LIMIT_MS = 60 * 1000; // 1 resend per minute per email

interface ResetOtpEntry {
  otpHash: string;
  expiry: number;
  attempts: number;
  lastSentAt: number;
  verified: boolean;
}

// email → entry (in-memory; same pattern as signup OTP)
const resetOtpStore = new Map<string, ResetOtpEntry>();

function hashOtp(otp: string): string {
  // Simple hash — sufficient for short-lived OTP alongside rate limits
  let h = 0;
  for (let i = 0; i < otp.length; i++) h = (h * 31 + otp.charCodeAt(i)) >>> 0;
  return String(h);
}

function generateOTP(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

/**
 * Password reset uses a 6-digit OTP (no recovery URL).
 * This avoids Supabase Site URL / localhost links in reset emails.
 */
async function sendResetEmail(email: string, otp: string): Promise<void> {
  const resendKey = env.RESEND_API_KEY;
  if (!resendKey) throw new Error("RESEND_API_KEY not configured");

  const site = publicAppUrl();
  if (/localhost|127\.0\.0\.1/i.test(site)) {
    console.warn(
      "[password-reset] PUBLIC_APP_URL resolves to localhost — set PUBLIC_APP_URL for production"
    );
  }

  const resend = new Resend(resendKey);
  const { error } = await resend.emails.send({
    from: resendFromAddress(),
    to: email,
    subject: "Your Path+ password reset code",
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 32px;">
        <h2 style="color: #0A1F44; margin-bottom: 8px;">Reset your password</h2>
        <p style="color: #475569; margin-bottom: 24px;">Use this code in the Path+ app to reset your password. No link is required.</p>
        <div style="background: #F1F5F9; border-radius: 12px; padding: 24px; text-align: center; margin-bottom: 24px;">
          <span style="font-size: 40px; font-weight: 700; letter-spacing: 8px; color: #0A1F44;">${otp}</span>
        </div>
        <p style="color: #94A3B8; font-size: 13px;">This code expires in 10 minutes and can only be used once. If you didn't request this, ignore this email.</p>
        <p style="color: #94A3B8; font-size: 12px; margin-top: 16px;">Path+ · <a href="${site}" style="color:#0A1F44;">${site.replace(/^https?:\/\//, "")}</a></p>
      </div>
    `,
  });
  if (error) throw new Error(error.message);
}

/** Request a password-reset OTP. Returns generic success even if email unknown (no enumeration). */
export async function requestPasswordResetOtp(email: string): Promise<{ ok: true } | { ok: false; message: string }> {
  const key = email.toLowerCase().trim();
  if (!key.includes("@")) return { ok: false, message: "Please enter a valid email address." };

  const existing = resetOtpStore.get(key);
  if (existing && Date.now() - existing.lastSentAt < RATE_LIMIT_MS) {
    return { ok: false, message: "Please wait a minute before requesting another code." };
  }

  // Confirm account exists (admin API — do not reveal to client).
  const { data: listData } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const user = (listData?.users ?? []).find((u) => u.email?.toLowerCase() === key);
  if (!user) {
    // Generic delay to reduce timing attacks
    await new Promise((r) => setTimeout(r, 400));
    return { ok: true };
  }

  const otp = generateOTP();
  const expiry = Date.now() + OTP_TTL_MS;
  resetOtpStore.set(key, {
    otpHash: hashOtp(otp),
    expiry,
    attempts: 0,
    lastSentAt: Date.now(),
    verified: false,
  });

  try {
    await sendResetEmail(key, otp);
  } catch (err) {
    resetOtpStore.delete(key);
    console.error(
      "[password-reset] send failed:",
      err instanceof Error ? err.message : "unknown"
    );
    return { ok: false, message: "Failed to send reset email. Please try again." };
  }

  return { ok: true };
}

/** Verify OTP (single-use). Marks entry verified for the subsequent password update step. */
export function verifyPasswordResetOtp(
  email: string,
  otp: string
): { ok: true } | { ok: false; message: string } {
  const key = email.toLowerCase().trim();
  const stored = resetOtpStore.get(key);

  if (!stored) {
    return { ok: false, message: "No reset code found. Please request a new one." };
  }
  if (Date.now() > stored.expiry) {
    resetOtpStore.delete(key);
    return { ok: false, message: "Code expired. Please request a new one." };
  }
  if (stored.attempts >= MAX_ATTEMPTS) {
    resetOtpStore.delete(key);
    return { ok: false, message: "Too many attempts. Please request a new code." };
  }

  if (stored.otpHash !== hashOtp(otp)) {
    stored.attempts++;
    return { ok: false, message: "Invalid code. Please try again." };
  }

  stored.verified = true;
  return { ok: true };
}

/** Set new password after OTP verification. Consumes the OTP entry. */
export async function confirmPasswordReset(
  email: string,
  newPassword: string
): Promise<{ ok: true } | { ok: false; message: string }> {
  const key = email.toLowerCase().trim();
  const stored = resetOtpStore.get(key);

  if (!stored?.verified) {
    return { ok: false, message: "Please verify your code first." };
  }
  if (Date.now() > stored.expiry) {
    resetOtpStore.delete(key);
    return { ok: false, message: "Code expired. Please start over." };
  }
  if (newPassword.length < 6) {
    return { ok: false, message: "Password must be at least 6 characters." };
  }

  const { data: listData } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const user = (listData?.users ?? []).find((u) => u.email?.toLowerCase() === key);
  if (!user) {
    resetOtpStore.delete(key);
    return { ok: false, message: "Account not found." };
  }

  const { error } = await supabaseAdmin.auth.admin.updateUserById(user.id, {
    password: newPassword,
  });

  resetOtpStore.delete(key);

  if (error) {
    console.error("[password-reset] updateUserById failed:", error.message);
    return { ok: false, message: "Failed to update password. Please try again." };
  }

  return { ok: true };
}
