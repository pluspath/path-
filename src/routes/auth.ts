import { Hono } from "hono";
import type { StatusCode } from "hono/utils/http-status";
import { z } from "zod";
import { supabase, supabaseAdmin } from "../supabase";
import { ensureJoinedPost } from "../lib/joined";
import { isAdult, normalizeBirthday } from "../lib/profileMeta";
import {
  startRegistration,
  resendRegistrationOtp,
  verifyRegistrationOtp,
  consumePendingRegistration,
  decryptPendingPassword,
  purgeExpiredPendingRegistrations,
} from "../lib/pending-registration";
import {
  requestPasswordResetOtp,
  verifyPasswordResetOtp,
  confirmPasswordReset,
  purgeExpiredPasswordResetOtps,
} from "../lib/password-reset-otp";
import { defaultAvatarForGender, normalizeGender } from "../lib/avatar";
import { isSupabaseCircuitOpen, supabaseCircuitRetryAfterSec } from "../lib/supabase-circuit";
import {
  authMessage,
  newRequestId,
  resolveAuthLocale,
  type AuthErrorCode,
  type AuthLocale,
} from "../lib/auth-messages";

const authRouter = new Hono();

function httpStatus(code?: number): StatusCode {
  return (code ?? 400) as StatusCode;
}

type IssueLike = { path: PropertyKey[]; message: string };

function firstZodIssue(
  error: { issues: IssueLike[] },
  locale: AuthLocale
): { message: string; code: AuthErrorCode } {
  const issue = error.issues[0];
  if (!issue) return { message: authMessage("UNEXPECTED_ERROR", locale), code: "UNEXPECTED_ERROR" };
  const path = issue.path.map(String).join(".");
  if (path === "email") return { message: authMessage("INVALID_EMAIL", locale), code: "INVALID_EMAIL" };
  if (path === "password") return { message: authMessage("WEAK_PASSWORD", locale), code: "WEAK_PASSWORD" };
  if (path === "username") return { message: authMessage("USERNAME_INVALID", locale), code: "USERNAME_INVALID" };
  if (path === "fullName") return { message: authMessage("MISSING_FIELDS", locale), code: "MISSING_FIELDS" };
  if (path === "gender") return { message: "Gender must be Male or Female when provided.", code: "INVALID_EMAIL" };
  if (path === "birthday") return { message: "Please enter a valid date of birth (YYYY-MM-DD).", code: "INVALID_EMAIL" };
  if (path === "otp") return { message: authMessage("INVALID_OTP", locale), code: "INVALID_OTP" };
  return { message: issue.message || authMessage("UNEXPECTED_ERROR", locale), code: "UNEXPECTED_ERROR" };
}

function localizeRegistrationFailure(
  result: { message: string; code?: string },
  locale: AuthLocale
): { message: string; code: string } {
  const code = (result.code ?? "UNEXPECTED_ERROR") as AuthErrorCode;
  const known: AuthErrorCode[] = [
    "EMAIL_ALREADY_REGISTERED",
    "INVALID_EMAIL",
    "WEAK_PASSWORD",
    "USERNAME_TAKEN",
    "USERNAME_INVALID",
    "REGISTRATION_UNAVAILABLE",
    "VERIFICATION_EMAIL_FAILED",
    "EMAIL_QUOTA_EXCEEDED",
    "OTP_RATE_LIMIT",
    "INVALID_OTP",
    "OTP_EXPIRED",
    "UNEXPECTED_ERROR",
  ];
  if (known.includes(code)) {
    return { message: authMessage(code, locale), code };
  }
  return { message: result.message, code };
}

/** Gender and date of birth are OPTIONAL (Apple Guideline 5.1.1(v)). */
const signupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  username: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9_]{3,30}$/, "Username must be 3–30 characters: letters, numbers, underscore."),
  fullName: z.string().min(1),
  gender: z.enum(["Male", "Female"]).optional().nullable(),
  birthday: z
    .union([
      z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid birthday"),
      z.literal(""),
      z.null(),
    ])
    .optional(),
});

authRouter.post("/signup", async (c) => {
  const requestId = newRequestId();
  const locale = resolveAuthLocale(c.req.header("accept-language"));
  c.header("X-Request-Id", requestId);
  try {
  const raw = await c.req.json().catch(() => null);
  const parsed = signupSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = firstZodIssue(parsed.error, locale);
    return c.json({ error: { message: issue.message, code: issue.code, requestId } }, 400);
  }

  const { email, password, username, fullName } = parsed.data;
  const gender =
    parsed.data.gender === "Male" || parsed.data.gender === "Female"
      ? parsed.data.gender
      : null;
  const birthday = normalizeBirthday(parsed.data.birthday);

  if (parsed.data.birthday && !birthday) {
    return c.json(
      { error: { message: "Please enter a valid date of birth (YYYY-MM-DD).", code: "INVALID_EMAIL", requestId } },
      400
    );
  }

  if (birthday && !isAdult(birthday)) {
    return c.json(
      { error: { message: authMessage("UNDERAGE", locale), code: "UNDERAGE", requestId } },
      400
    );
  }

  const result = await startRegistration({
    email,
    password,
    username,
    fullName,
    gender,
    birthday,
  });

  if (!result.ok) {
    const localized = localizeRegistrationFailure(result, locale);
    if (result.retryAfterSec) c.header("Retry-After", String(result.retryAfterSec));
    console.error(
      `[auth/signup] requestId=${requestId} code=${localized.code} status=${result.status ?? 400}`
    );
    return c.json(
      { error: { message: localized.message, code: localized.code, requestId } },
      httpStatus(result.status)
    );
  }

  return c.json({
    data: {
      success: true,
      message: authMessage("VERIFICATION_REQUIRED", locale),
      requestId,
    },
  });
  } catch (err) {
    console.error("[auth/signup]", requestId, err instanceof Error ? err.message : err);
    return c.json(
      {
        error: {
          message: authMessage("REGISTRATION_UNAVAILABLE", locale),
          code: "REGISTRATION_UNAVAILABLE",
          requestId,
        },
      },
      500
    );
  }
});

authRouter.post("/verify-otp", async (c) => {
  const requestId = newRequestId();
  const locale = resolveAuthLocale(c.req.header("accept-language"));
  c.header("X-Request-Id", requestId);
  try {
  const raw = await c.req.json().catch(() => null);
  const parsed = z
    .object({
      email: z.string().email(),
      otp: z.string().length(6),
    })
    .safeParse(raw);
  if (!parsed.success) {
    const issue = firstZodIssue(parsed.error, locale);
    return c.json({ error: { message: issue.message, code: issue.code, requestId } }, 400);
  }

  const { email, otp } = parsed.data;
  const verifyResult = await verifyRegistrationOtp(email, otp);
  if (!verifyResult.ok) {
    return c.json({ error: { message: verifyResult.message } }, httpStatus(verifyResult.status));
  }

  const pending = verifyResult.pending;
  let plainPassword: string;
  try {
    plainPassword = decryptPendingPassword(pending);
  } catch {
    await consumePendingRegistration(email);
    return c.json({ error: { message: "Registration data is invalid. Please sign up again." } }, 400);
  }

  const { data: userData, error: createError } = await supabaseAdmin.auth.admin.createUser({
    email: pending.email,
    password: plainPassword,
    email_confirm: true,
    user_metadata: { full_name: pending.full_name, username: pending.username },
  });

  let createdUserId: string | null = null;
  if (createError || !userData?.user) {
    const msg = createError?.message?.toLowerCase() ?? "";
    const alreadyExists =
      msg.includes("already registered") || msg.includes("already exists");
    if (!alreadyExists) {
      console.error("[auth/verify-otp] createUser error:", createError?.message);
      return c.json({ error: { message: "Unable to create account. Please try again." } }, 500);
    }
    // A previous attempt created the user but the phone never received the
    // session. Sign in with the same password instead of failing the retry.
    console.warn("[auth/verify-otp] user already exists, completing sign-in");
  } else {
    createdUserId = userData.user.id;
  }

  // Sign in with the password we stored at signup. This also recovers a retry
  // when the first attempt created the user but the phone never got the response.
  const { data: sessionData, error: sessionError } = await supabase.auth.signInWithPassword({
    email: pending.email,
    password: plainPassword,
  });
  if (sessionError || !sessionData.session || !sessionData.user) {
    console.error("[auth/verify-otp] signIn error:", sessionError?.message);
    if (!createdUserId) {
      return c.json(
        { error: { message: "An account with this email already exists. Please sign in instead." } },
        400
      );
    }
    return c.json({ error: { message: "Account created but sign-in failed. Please sign in manually." } }, 500);
  }

  const userId = sessionData.user.id;
  const profileRow: Record<string, unknown> = {
    id: userId,
    username: pending.username,
    full_name: pending.full_name,
  };
  const gender = normalizeGender(pending.gender);
  if (gender) profileRow.gender = gender;
  // Distinct scenic default until the user uploads their own photo.
  profileRow.avatar_url = defaultAvatarForGender(userId, gender);
  if (pending.birthday) profileRow.birthday = pending.birthday;

  const { error: profileError } = await supabaseAdmin
    .from("profiles")
    .upsert(profileRow, { onConflict: "id" });
  if (profileError) {
    console.error("[auth/verify-otp] profile upsert failed:", profileError.message);
    if (createdUserId) {
      await supabaseAdmin.auth.admin.deleteUser(userId);
    }
    return c.json({ error: { message: "Unable to create profile. Please try again." } }, 500);
  }

  await ensureJoinedPost(userId, new Date().toISOString());
  await consumePendingRegistration(email);

  return c.json({
    data: {
      success: true,
      session: {
        access_token: sessionData.session.access_token,
        refresh_token: sessionData.session.refresh_token,
      },
    },
  });
  } catch (err) {
    console.error("[auth/verify-otp]", err instanceof Error ? err.message : err);
    return c.json(
      { error: { message: "Unable to verify the code. Please try again." } },
      500
    );
  }
});

authRouter.post("/resend-otp", async (c) => {
  const requestId = newRequestId();
  const locale = resolveAuthLocale(c.req.header("accept-language"));
  c.header("X-Request-Id", requestId);
  const raw = await c.req.json().catch(() => null);
  const parsed = z.object({ email: z.string().email() }).safeParse(raw);
  if (!parsed.success) {
    const issue = firstZodIssue(parsed.error, locale);
    return c.json({ error: { message: issue.message, code: issue.code, requestId } }, 400);
  }

  const result = await resendRegistrationOtp(parsed.data.email);
  if (!result.ok) {
    const localized = localizeRegistrationFailure(result, locale);
    if (result.retryAfterSec) c.header("Retry-After", String(result.retryAfterSec));
    return c.json(
      { error: { message: localized.message, code: localized.code, requestId } },
      httpStatus(result.status)
    );
  }

  return c.json({ data: { success: true, message: "New verification code sent.", requestId } });
});

authRouter.post("/forgot-password", async (c) => {
  if (isSupabaseCircuitOpen()) {
    c.header("Retry-After", String(supabaseCircuitRetryAfterSec()));
    return c.json(
      {
        error: {
          message:
            "Database is temporarily overloaded. Please wait a moment and try again.",
        },
      },
      503
    );
  }

  const raw = await c.req.json().catch(() => null);
  const parsed = z.object({ email: z.string().email() }).safeParse(raw);
  if (!parsed.success) {
    return c.json({ error: { message: "Please enter a valid email address." } }, 400);
  }

  const result = await requestPasswordResetOtp(parsed.data.email);
  if (!result.ok) return c.json({ error: { message: result.message } }, httpStatus(result.status));
  return c.json({ data: { success: true, message: "Reset code sent to your email." } });
});

authRouter.post("/verify-reset-otp", async (c) => {
  const raw = await c.req.json().catch(() => null);
  const parsed = z
    .object({ email: z.string().email(), otp: z.string().length(6) })
    .safeParse(raw);
  if (!parsed.success) {
    const locale = resolveAuthLocale(c.req.header("accept-language"));
    const issue = firstZodIssue(parsed.error, locale);
    return c.json({ error: { message: issue.message, code: issue.code } }, 400);
  }

  const result = await verifyPasswordResetOtp(parsed.data.email, parsed.data.otp);
  if (!result.ok) return c.json({ error: { message: result.message } }, httpStatus(result.status));
  return c.json({ data: { success: true, verified: true } });
});

authRouter.post("/reset-password", async (c) => {
  const raw = await c.req.json().catch(() => null);
  const parsed = z
    .object({
      email: z.string().email(),
      password: z.string().min(6),
    })
    .safeParse(raw);
  if (!parsed.success) {
    const locale = resolveAuthLocale(c.req.header("accept-language"));
    const issue = firstZodIssue(parsed.error, locale);
    return c.json({ error: { message: issue.message, code: issue.code } }, 400);
  }

  const result = await confirmPasswordReset(parsed.data.email, parsed.data.password);
  if (!result.ok) return c.json({ error: { message: result.message } }, httpStatus(result.status));
  return c.json({ data: { success: true, message: "Password updated successfully." } });
});

authRouter.post("/resend-reset-otp", async (c) => {
  const raw = await c.req.json().catch(() => null);
  const parsed = z.object({ email: z.string().email() }).safeParse(raw);
  if (!parsed.success) {
    return c.json({ error: { message: "Please enter a valid email address." } }, 400);
  }

  const result = await requestPasswordResetOtp(parsed.data.email);
  if (!result.ok) return c.json({ error: { message: result.message } }, httpStatus(result.status));
  return c.json({ data: { success: true, message: "A new reset code was sent." } });
});

export { authRouter, purgeExpiredPendingRegistrations, purgeExpiredPasswordResetOtps };
