import { supabaseAdmin } from "../supabase";
import { findAuthUserByEmail } from "./auth-users";
import { sendPasswordResetOtpEmail } from "./email-service";
import {
  generateOtp,
  hashOtp,
  verifyOtpHash,
  otpExpiresAt,
  MAX_OTP_ATTEMPTS,
  RESEND_RATE_LIMIT_MS,
} from "./otp";

type ResetOtpRow = {
  email: string;
  user_id: string;
  otp_hash: string;
  otp_expires_at: string;
  attempts: number;
  last_sent_at: string;
  verified: boolean;
};

async function getResetRow(email: string): Promise<ResetOtpRow | null> {
  const key = email.toLowerCase().trim();
  const { data, error } = await supabaseAdmin
    .from("password_reset_otps")
    .select("*")
    .eq("email", key)
    .maybeSingle();

  if (error) {
    console.error("[password-reset] fetch failed:", error.message);
    return null;
  }
  return data as ResetOtpRow | null;
}

/** Request a password-reset OTP. Returns explicit not-found when email is unknown. */
export async function requestPasswordResetOtp(
  email: string
): Promise<{ ok: true } | { ok: false; message: string; status?: number }> {
  const key = email.toLowerCase().trim();
  if (!key.includes("@")) {
    return { ok: false, message: "Please enter a valid email address.", status: 400 };
  }

  const existing = await getResetRow(key);
  if (existing && Date.now() - new Date(existing.last_sent_at).getTime() < RESEND_RATE_LIMIT_MS) {
    return {
      ok: false,
      message: "Please wait a minute before requesting another code.",
      status: 429,
    };
  }

  const user = await findAuthUserByEmail(key);
  if (!user) {
    return { ok: false, message: "Email address not found", status: 404 };
  }

  const otp = generateOtp();
  const now = Date.now();
  const row = {
    email: key,
    user_id: user.id,
    otp_hash: hashOtp(otp),
    otp_expires_at: otpExpiresAt(now),
    attempts: 0,
    last_sent_at: new Date(now).toISOString(),
    verified: false,
  };

  const { error: upsertError } = await supabaseAdmin
    .from("password_reset_otps")
    .upsert(row, { onConflict: "email" });

  if (upsertError) {
    console.error("[password-reset] upsert failed:", upsertError.message);
    return { ok: false, message: "Failed to send reset email. Please try again.", status: 500 };
  }

  try {
    await sendPasswordResetOtpEmail(key, otp);
  } catch (err) {
    await supabaseAdmin.from("password_reset_otps").delete().eq("email", key);
    console.error(
      "[password-reset] send failed:",
      err instanceof Error ? err.message : "unknown"
    );
    return { ok: false, message: "Failed to send reset email. Please try again.", status: 500 };
  }

  return { ok: true };
}

/** Verify OTP (single-use). Marks entry verified for the subsequent password update step. */
export async function verifyPasswordResetOtp(
  email: string,
  otp: string
): Promise<{ ok: true } | { ok: false; message: string; status?: number }> {
  const key = email.toLowerCase().trim();
  const stored = await getResetRow(key);

  if (!stored) {
    return {
      ok: false,
      message: "No reset code found. Please request a new one.",
      status: 400,
    };
  }

  const now = Date.now();
  if (new Date(stored.otp_expires_at).getTime() < now) {
    await supabaseAdmin.from("password_reset_otps").delete().eq("email", key);
    return {
      ok: false,
      message: "This verification code has expired. Please request a new code.",
      status: 400,
    };
  }

  if (stored.attempts >= MAX_OTP_ATTEMPTS) {
    await supabaseAdmin.from("password_reset_otps").delete().eq("email", key);
    return {
      ok: false,
      message: "Too many attempts. Please request a new code.",
      status: 400,
    };
  }

  if (!verifyOtpHash(otp, stored.otp_hash)) {
    await supabaseAdmin
      .from("password_reset_otps")
      .update({ attempts: stored.attempts + 1 })
      .eq("email", key);
    return { ok: false, message: "Invalid verification code", status: 400 };
  }

  await supabaseAdmin
    .from("password_reset_otps")
    .update({ verified: true })
    .eq("email", key);

  return { ok: true };
}

/** Set new password after OTP verification. Consumes the OTP entry. */
export async function confirmPasswordReset(
  email: string,
  newPassword: string
): Promise<{ ok: true } | { ok: false; message: string; status?: number }> {
  const key = email.toLowerCase().trim();
  const stored = await getResetRow(key);

  if (!stored?.verified) {
    return { ok: false, message: "Please verify your code first.", status: 400 };
  }

  if (new Date(stored.otp_expires_at).getTime() < Date.now()) {
    await supabaseAdmin.from("password_reset_otps").delete().eq("email", key);
    return {
      ok: false,
      message: "This verification code has expired. Please request a new code.",
      status: 400,
    };
  }

  if (newPassword.length < 6) {
    return { ok: false, message: "Password must be at least 6 characters.", status: 400 };
  }

  const { error } = await supabaseAdmin.auth.admin.updateUserById(stored.user_id, {
    password: newPassword,
  });

  await supabaseAdmin.from("password_reset_otps").delete().eq("email", key);

  if (error) {
    console.error("[password-reset] updateUserById failed:", error.message);
    return { ok: false, message: "Failed to update password. Please try again.", status: 500 };
  }

  return { ok: true };
}

/** Remove expired password reset rows (best-effort cleanup). */
export async function purgeExpiredPasswordResetOtps(): Promise<number> {
  const now = new Date().toISOString();
  const { data, error } = await supabaseAdmin
    .from("password_reset_otps")
    .delete()
    .lt("otp_expires_at", now)
    .select("email");

  if (error) {
    console.warn("[password-reset] purge failed:", error.message);
    return 0;
  }
  return data?.length ?? 0;
}
