import { Hono } from "hono";
import { z } from "zod";
import { Resend } from "resend";
import { supabase, supabaseAdmin } from "../supabase";
import { ensureJoinedPost } from "../lib/joined";
import { isAdult } from "../lib/profileMeta";
import { env } from "../env";
import { publicAppUrl, resendFromAddress } from "../lib/email-from";
import {
  requestPasswordResetOtp,
  verifyPasswordResetOtp,
  confirmPasswordReset,
} from "../lib/password-reset-otp";

const authRouter = new Hono();

// In-memory OTP store: email → { otp, expiry, username, fullName, password }
const otpStore = new Map<string, { otp: string; expiry: number; username: string; fullName: string; password: string }>();

function generateOTP(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
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

async function sendOTPEmail(email: string, otp: string, fullName: string): Promise<void> {
  const resendKey = env.RESEND_API_KEY;
  if (!resendKey) throw new Error("RESEND_API_KEY not configured");

  const site = publicAppUrl();
  const resend = new Resend(resendKey);
  const { error } = await resend.emails.send({
    from: resendFromAddress(),
    to: email,
    subject: "Your verification code",
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 32px;">
        <h2 style="color: #0A1F44; margin-bottom: 8px;">Hi ${fullName},</h2>
        <p style="color: #475569; margin-bottom: 24px;">Use this code to verify your Path+ account:</p>
        <div style="background: #F1F5F9; border-radius: 12px; padding: 24px; text-align: center; margin-bottom: 24px;">
          <span style="font-size: 40px; font-weight: 700; letter-spacing: 8px; color: #0A1F44;">${otp}</span>
        </div>
        <p style="color: #94A3B8; font-size: 13px;">This code expires in 10 minutes. Open the Path+ app and enter the code to finish signing up.</p>
        <p style="color: #94A3B8; font-size: 12px; margin-top: 16px;">Learn more at <a href="${site}" style="color:#0A1F44;">${site.replace(/^https?:\/\//, "")}</a></p>
      </div>
    `,
  });

  if (error) throw new Error(error.message);
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
  const birthday =
    typeof parsed.data.birthday === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(parsed.data.birthday)
      ? parsed.data.birthday
      : null;

  // Age gate only when a birthday is provided — DOB is not required to register.
  if (birthday && !isAdult(birthday)) {
    return c.json({ error: { message: "You must be 18 or older to use Path+" } }, 400);
  }

  const { data: userData, error: createError } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName, username },
  });

  let userId = userData?.user?.id ?? null;

  if (createError) {
    console.error("[auth/signup] createUser error:", createError.message);
    const msg = createError.message.toLowerCase();
    const isAlreadyExists =
      msg.includes("already registered") ||
      msg.includes("already been registered") ||
      msg.includes("duplicate") ||
      msg.includes("user already exists");
    const isDatabaseError = msg.includes("database error");

    if (isAlreadyExists && !isDatabaseError) {
      return c.json(
        { error: { message: "An account with this email already exists. Please sign in instead." } },
        400
      );
    }

    if (!isAlreadyExists && !isDatabaseError) {
      return c.json({ error: { message: "Unable to create account. Please try again." } }, 400);
    }

    if (!userId) {
      const { data: listData } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 });
      const found = (listData?.users ?? []).find((u) => u.email?.toLowerCase() === email.toLowerCase());
      if (found) {
        userId = found.id;
      } else if (isDatabaseError) {
        return c.json(
          { error: { message: "Account creation failed due to a database error. Please try again." } },
          500
        );
      }
    }
  }

  // Upsert profile — gender and birthday stored only when provided (otherwise NULL).
  if (userId) {
    const profileRow: Record<string, unknown> = {
      id: userId,
      username: username.toLowerCase().trim(),
      full_name: fullName,
    };
    if (gender) profileRow.gender = gender;
    if (birthday) profileRow.birthday = birthday;

    const { error: profileError } = await supabaseAdmin
      .from("profiles")
      .upsert(profileRow, { onConflict: "id" });
    if (profileError) {
      console.error("[auth/signup] Failed to upsert profile:", profileError.message, profileError);
    }

    await ensureJoinedPost(userId, new Date().toISOString());
  }

  const otp = generateOTP();
  const expiry = Date.now() + 10 * 60 * 1000;
  otpStore.set(email.toLowerCase(), { otp, expiry, username, fullName, password });

  try {
    await sendOTPEmail(email, otp, fullName);
  } catch (err: any) {
    console.error("[auth/signup] Failed to send OTP email:", err.message);
    return c.json({ error: { message: "Failed to send verification email. Please try again." } }, 500);
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
  const key = email.toLowerCase();
  const stored = otpStore.get(key);

  if (!stored) {
    return c.json({ error: { message: "No verification code found. Please sign up again." } }, 400);
  }
  if (Date.now() > stored.expiry) {
    otpStore.delete(key);
    return c.json({ error: { message: "Verification code expired. Please request a new one." } }, 400);
  }
  if (stored.otp !== otp) {
    return c.json({ error: { message: "Invalid code. Please try again." } }, 400);
  }

  otpStore.delete(key);

  // Server-side only — magic link URL is never emailed to the user.
  const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  if (linkError || !linkData?.properties?.hashed_token) {
    console.error("[auth/verify-otp] generateLink error:", linkError?.message);
    return c.json({ error: { message: "Failed to create session. Please try again." } }, 500);
  }

  const { data: sessionData, error: sessionError } = await supabase.auth.verifyOtp({
    token_hash: linkData.properties.hashed_token,
    type: "magiclink",
  });
  if (sessionError || !sessionData.session) {
    console.error("[auth/verify-otp] verifyOtp error:", sessionError?.message);
    return c.json({ error: { message: "Failed to establish session. Please try again." } }, 500);
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

  const { email } = parsed.data;
  const key = email.toLowerCase();
  const existing = otpStore.get(key);

  const fullName = existing?.fullName ?? "there";
  const username = existing?.username ?? "";
  const password = existing?.password ?? "";

  const otp = generateOTP();
  const expiry = Date.now() + 10 * 60 * 1000;
  otpStore.set(key, { otp, expiry, username, fullName, password });

  try {
    await sendOTPEmail(email, otp, fullName);
  } catch (err: any) {
    console.error("[auth/resend-otp] Failed to send OTP email:", err.message);
    return c.json({ error: { message: "Failed to send verification email. Please try again." } }, 500);
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
  if (!result.ok) return c.json({ error: { message: result.message } }, 400);
  return c.json({ data: { success: true, message: "If an account exists, a reset code was sent." } });
});

authRouter.post("/verify-reset-otp", async (c) => {
  const raw = await c.req.json().catch(() => null);
  const parsed = z
    .object({ email: z.string().email(), otp: z.string().length(6) })
    .safeParse(raw);
  if (!parsed.success) {
    return c.json({ error: { message: firstZodMessage(parsed.error) } }, 400);
  }

  const result = verifyPasswordResetOtp(parsed.data.email, parsed.data.otp);
  if (!result.ok) return c.json({ error: { message: result.message } }, 400);
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
  if (!result.ok) return c.json({ error: { message: result.message } }, 400);
  return c.json({ data: { success: true, message: "Password updated successfully." } });
});

authRouter.post("/resend-reset-otp", async (c) => {
  const raw = await c.req.json().catch(() => null);
  const parsed = z.object({ email: z.string().email() }).safeParse(raw);
  if (!parsed.success) {
    return c.json({ error: { message: "Please enter a valid email address." } }, 400);
  }

  const result = await requestPasswordResetOtp(parsed.data.email);
  if (!result.ok) return c.json({ error: { message: result.message } }, 400);
  return c.json({ data: { success: true, message: "A new reset code was sent." } });
});

export { authRouter };
