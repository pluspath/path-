import { supabaseAdmin } from "../supabase";
import { sendPasswordResetOtpEmail } from "./email-service";

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
  await sendPasswordResetOtpEmail(email, otp);
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
