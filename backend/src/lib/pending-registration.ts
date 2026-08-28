import { supabaseAdmin } from "../supabase";
import { findAuthUserByEmail } from "./auth-users";
import {
  generateOtp,
  hashOtp,
  verifyOtpHash,
  otpExpiresAt,
  pendingRegistrationExpiresAt,
  MAX_OTP_ATTEMPTS,
  RESEND_RATE_LIMIT_MS,
} from "./otp";
import { sendSignupOtpEmail } from "./email-service";
import { encryptSecret, decryptSecret } from "./secure-storage";

export type PendingRegistrationRow = {
  id: string;
  email: string;
  password_encrypted: string;
  username: string;
  full_name: string;
  gender: string | null;
  birthday: string | null;
  otp_hash: string;
  otp_expires_at: string;
  attempts: number;
  last_sent_at: string;
  created_at: string;
  expires_at: string;
};

export type StartRegistrationInput = {
  email: string;
  password: string;
  username: string;
  fullName: string;
  gender?: string | null;
  birthday?: string | null;
};

async function getPendingByEmail(email: string): Promise<PendingRegistrationRow | null> {
  const key = email.toLowerCase().trim();
  const { data, error } = await supabaseAdmin
    .from("pending_registrations")
    .select("*")
    .eq("email", key)
    .maybeSingle();

  if (error) {
    console.error("[pending-registration] fetch failed:", error.message);
    return null;
  }
  return data as PendingRegistrationRow | null;
}

async function getPendingByUsername(username: string): Promise<PendingRegistrationRow | null> {
  const key = username.toLowerCase().trim();
  const { data, error } = await supabaseAdmin
    .from("pending_registrations")
    .select("*")
    .ilike("username", key)
    .maybeSingle();

  if (error) {
    console.error("[pending-registration] username lookup failed:", error.message);
    return null;
  }
  return data as PendingRegistrationRow | null;
}

export async function isUsernameReserved(username: string): Promise<boolean> {
  const key = username.toLowerCase().trim();
  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("id")
    .eq("username", key)
    .maybeSingle();
  if (profile) return true;

  const pending = await getPendingByUsername(key);
  return pending !== null;
}

/** Remove expired pending registrations (best-effort cleanup). */
export async function purgeExpiredPendingRegistrations(): Promise<number> {
  const now = new Date().toISOString();
  const { data, error } = await supabaseAdmin
    .from("pending_registrations")
    .delete()
    .lt("expires_at", now)
    .select("id");

  if (error) {
    console.warn("[pending-registration] purge failed:", error.message);
    return 0;
  }
  return data?.length ?? 0;
}

/**
 * Validate and store pending registration, then send verification email.
 * Does NOT create a Supabase user.
 */
export async function startRegistration(
  input: StartRegistrationInput
): Promise<{ ok: true } | { ok: false; message: string; status?: number }> {
  const email = input.email.toLowerCase().trim();
  const username = input.username.toLowerCase().trim();
  const now = Date.now();

  await purgeExpiredPendingRegistrations();

  const existingLookup = await findAuthUserByEmail(email);
  if (!existingLookup.ok) {
    console.error("[pending-registration] auth lookup failed:", existingLookup.reason);
    return { ok: false, message: "Unable to start registration. Please try again.", status: 503 };
  }
  if (existingLookup.user) {
    return {
      ok: false,
      message: "An account with this email already exists. Please sign in instead.",
      status: 400,
    };
  }

  const { data: profileWithUsername } = await supabaseAdmin
    .from("profiles")
    .select("id")
    .eq("username", username)
    .maybeSingle();
  if (profileWithUsername) {
    return { ok: false, message: "That username is already taken.", status: 400 };
  }

  const pendingWithUsername = await getPendingByUsername(username);
  if (pendingWithUsername && pendingWithUsername.email !== email) {
    return { ok: false, message: "That username is already taken.", status: 400 };
  }

  const existingPending = await getPendingByEmail(email);
  if (existingPending && now - new Date(existingPending.last_sent_at).getTime() < RESEND_RATE_LIMIT_MS) {
    return {
      ok: false,
      message: "Please wait a minute before requesting another code.",
      status: 429,
    };
  }

  const passwordEncrypted = encryptSecret(input.password);
  const otp = generateOtp();
  const otpHash = hashOtp(otp);

  const row = {
    email,
    password_encrypted: passwordEncrypted,
    username,
    full_name: input.fullName.trim(),
    gender: input.gender ?? null,
    birthday: input.birthday ?? null,
    otp_hash: otpHash,
    otp_expires_at: otpExpiresAt(now),
    attempts: 0,
    last_sent_at: new Date(now).toISOString(),
    expires_at: pendingRegistrationExpiresAt(now),
  };

  const { error: upsertError } = await supabaseAdmin
    .from("pending_registrations")
    .upsert(row, { onConflict: "email" });

  if (upsertError) {
    console.error("[pending-registration] upsert failed:", upsertError.message);
    return { ok: false, message: "Unable to start registration. Please try again.", status: 500 };
  }

  try {
    await sendSignupOtpEmail(email, otp, input.fullName.trim());
  } catch (err) {
    await supabaseAdmin.from("pending_registrations").delete().eq("email", email);
    console.error(
      "[pending-registration] email send failed:",
      err instanceof Error ? err.message : "unknown"
    );
    return {
      ok: false,
      message: "Failed to send verification email. Please try again.",
      status: 500,
    };
  }

  return { ok: true };
}

export async function resendRegistrationOtp(
  email: string
): Promise<{ ok: true } | { ok: false; message: string; status?: number }> {
  const key = email.toLowerCase().trim();
  const pending = await getPendingByEmail(key);

  if (!pending) {
    return {
      ok: false,
      message: "No pending registration found. Please sign up again.",
      status: 400,
    };
  }

  const now = Date.now();
  if (new Date(pending.expires_at).getTime() < now) {
    await supabaseAdmin.from("pending_registrations").delete().eq("email", key);
    return {
      ok: false,
      message: "Registration expired. Please sign up again.",
      status: 400,
    };
  }

  if (now - new Date(pending.last_sent_at).getTime() < RESEND_RATE_LIMIT_MS) {
    return {
      ok: false,
      message: "Please wait a minute before requesting another code.",
      status: 429,
    };
  }

  const otp = generateOtp();
  const otpHash = hashOtp(otp);

  const { error } = await supabaseAdmin
    .from("pending_registrations")
    .update({
      otp_hash: otpHash,
      otp_expires_at: otpExpiresAt(now),
      attempts: 0,
      last_sent_at: new Date(now).toISOString(),
    })
    .eq("email", key);

  if (error) {
    console.error("[pending-registration] resend update failed:", error.message);
    return { ok: false, message: "Failed to resend code. Please try again.", status: 500 };
  }

  try {
    await sendSignupOtpEmail(key, otp, pending.full_name);
  } catch (err) {
    console.error(
      "[pending-registration] resend email failed:",
      err instanceof Error ? err.message : "unknown"
    );
    return {
      ok: false,
      message: "Failed to send verification email. Please try again.",
      status: 500,
    };
  }

  return { ok: true };
}

export async function verifyRegistrationOtp(
  email: string,
  otp: string
): Promise<
  | { ok: true; pending: PendingRegistrationRow }
  | { ok: false; message: string; status?: number }
> {
  const key = email.toLowerCase().trim();
  const pending = await getPendingByEmail(key);

  if (!pending) {
    return {
      ok: false,
      message: "No verification code found. Please sign up again.",
      status: 400,
    };
  }

  const now = Date.now();
  if (new Date(pending.expires_at).getTime() < now) {
    await supabaseAdmin.from("pending_registrations").delete().eq("email", key);
    return {
      ok: false,
      message: "This verification code has expired. Please request a new code.",
      status: 400,
    };
  }

  if (new Date(pending.otp_expires_at).getTime() < now) {
    return {
      ok: false,
      message: "This verification code has expired. Please request a new code.",
      status: 400,
    };
  }

  if (pending.attempts >= MAX_OTP_ATTEMPTS) {
    await supabaseAdmin.from("pending_registrations").delete().eq("email", key);
    return {
      ok: false,
      message: "Too many attempts. Please request a new code.",
      status: 400,
    };
  }

  if (!verifyOtpHash(otp, pending.otp_hash)) {
    await supabaseAdmin
      .from("pending_registrations")
      .update({ attempts: pending.attempts + 1 })
      .eq("email", key);
    return { ok: false, message: "Invalid verification code", status: 400 };
  }

  return { ok: true, pending };
}

export async function consumePendingRegistration(email: string): Promise<void> {
  await supabaseAdmin.from("pending_registrations").delete().eq("email", email.toLowerCase().trim());
}

export function decryptPendingPassword(pending: PendingRegistrationRow): string {
  return decryptSecret(pending.password_encrypted);
}
