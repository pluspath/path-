import { createHash, randomInt } from "crypto";
import { env } from "../env";

export const OTP_TTL_MS = 10 * 60 * 1000;
export const MAX_OTP_ATTEMPTS = 5;
export const RESEND_RATE_LIMIT_MS = 60 * 1000;
export const PENDING_REGISTRATION_TTL_MS = 24 * 60 * 60 * 1000;

export function generateOtp(): string {
  return randomInt(100000, 1000000).toString();
}

function getPepper(): string {
  return (
    process.env.OTP_PEPPER?.trim() ||
    env.BETTER_AUTH_SECRET?.trim() ||
    env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    "pathplus-otp-pepper"
  );
}

export function hashOtp(otp: string): string {
  return createHash("sha256").update(`${otp}:${getPepper()}`).digest("hex");
}

export function verifyOtpHash(otp: string, hash: string): boolean {
  return hashOtp(otp) === hash;
}

export function otpExpiresAt(fromMs: number = Date.now()): string {
  return new Date(fromMs + OTP_TTL_MS).toISOString();
}

export function pendingRegistrationExpiresAt(fromMs: number = Date.now()): string {
  return new Date(fromMs + PENDING_REGISTRATION_TTL_MS).toISOString();
}
