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

const authRouter = new Hono();

function httpStatus(code?: number): StatusCode {
  return (code ?? 400) as StatusCode;
}

type IssueLike = { path: PropertyKey[]; message: string };

function firstZodMessage(error: { issues: IssueLike[] }): string {
  const issue = error.issues[0];
  if (!issue) return "Invalid request";
  const path = issue.path.map(String).join(".");
  if (path === "email") return "Please enter a valid email address.";
  if (path === "password") return "Please enter a password (at least 6 characters).";
  if (path === "username") return "Please enter a username (at least 3 characters).";
  if (path === "fullName") return "Please enter your name.";
  if (path === "gender") return "Gender must be Male or Female when provided.";
  if (path === "birthday") return "Please enter a valid date of birth (YYYY-MM-DD).";
  if (path === "otp") return "Please enter the 6-digit verification code.";
  return issue.message || "Invalid request";
}

/** Gender and date of birth are OPTIONAL (Apple Guideline 5.1.1(v)). */
const signupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  username: z.string().min(3),
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
  const raw = await c.req.json().catch(() => null);
  const parsed = signupSchema.safeParse(raw);
  if (!parsed.success) {
    return c.json({ error: { message: firstZodMessage(parsed.error) } }, 400);
  }

  const { email, password, username, fullName } = parsed.data;
  const gender =
    parsed.data.gender === "Male" || parsed.data.gender === "Female"
      ? parsed.data.gender
      : null;
  const birthday = normalizeBirthday(parsed.data.birthday);

  if (parsed.data.birthday && !birthday) {
    return c.json({ error: { message: "Please enter a valid date of birth (YYYY-MM-DD)." } }, 400);
  }

  if (birthday && !isAdult(birthday)) {
    return c.json({ error: { message: "You must be 18 or older to use Path+" } }, 400);
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
    return c.json({ error: { message: result.message } }, httpStatus(result.status));
  }

  return c.json({ data: { success: true, message: "Verification code sent to your email." } });
});

authRouter.post("/verify-otp", async (c) => {
  const raw = await c.req.json().catch(() => null);
  const parsed = z
    .object({
      email: z.string().email(),
      otp: z.string().length(6),
    })
    .safeParse(raw);
  if (!parsed.success) {
    return c.json({ error: { message: firstZodMessage(parsed.error) } }, 400);
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

  if (createError || !userData.user) {
    console.error("[auth/verify-otp] createUser error:", createError?.message);
    const msg = createError?.message?.toLowerCase() ?? "";
    if (msg.includes("already registered") || msg.includes("already exists")) {
      await consumePendingRegistration(email);
      return c.json(
        { error: { message: "An account with this email already exists. Please sign in instead." } },
        400
      );
    }
    return c.json({ error: { message: "Unable to create account. Please try again." } }, 500);
  }

  const userId = userData.user.id;
  const profileRow: Record<string, unknown> = {
    id: userId,
    username: pending.username,
    full_name: pending.full_name,
  };
  if (pending.gender) profileRow.gender = pending.gender;
  if (pending.birthday) profileRow.birthday = pending.birthday;

  const { error: profileError } = await supabaseAdmin
    .from("profiles")
    .upsert(profileRow, { onConflict: "id" });
  if (profileError) {
    console.error("[auth/verify-otp] profile upsert failed:", profileError.message);
    await supabaseAdmin.auth.admin.deleteUser(userId);
    return c.json({ error: { message: "Unable to create profile. Please try again." } }, 500);
  }

  await ensureJoinedPost(userId, new Date().toISOString());
  await consumePendingRegistration(email);

  const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
    type: "magiclink",
    email: pending.email,
  });
  if (linkError || !linkData?.properties?.hashed_token) {
    console.error("[auth/verify-otp] generateLink error:", linkError?.message);
    return c.json({ error: { message: "Account created but sign-in failed. Please sign in manually." } }, 500);
  }

  const { data: sessionData, error: sessionError } = await supabase.auth.verifyOtp({
    token_hash: linkData.properties.hashed_token,
    type: "magiclink",
  });
  if (sessionError || !sessionData.session) {
    console.error("[auth/verify-otp] verifyOtp error:", sessionError?.message);
    return c.json({ error: { message: "Account created but sign-in failed. Please sign in manually." } }, 500);
  }

  return c.json({
    data: {
      success: true,
      session: {
        access_token: sessionData.session.access_token,
        refresh_token: sessionData.session.refresh_token,
      },
    },
  });
});

authRouter.post("/resend-otp", async (c) => {
  const raw = await c.req.json().catch(() => null);
  const parsed = z.object({ email: z.string().email() }).safeParse(raw);
  if (!parsed.success) {
    return c.json({ error: { message: firstZodMessage(parsed.error) } }, 400);
  }

  const result = await resendRegistrationOtp(parsed.data.email);
  if (!result.ok) {
    return c.json({ error: { message: result.message } }, httpStatus(result.status));
  }

  return c.json({ data: { success: true, message: "New verification code sent." } });
});

authRouter.post("/forgot-password", async (c) => {
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
    return c.json({ error: { message: firstZodMessage(parsed.error) } }, 400);
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
    return c.json({ error: { message: firstZodMessage(parsed.error) } }, 400);
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
