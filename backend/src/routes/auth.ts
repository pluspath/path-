import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { Resend } from "resend";
import { supabase, supabaseAdmin } from "../supabase";
import { env } from "../env";
import { authLimiter } from "../lib/rate-limit";

const authRouter = new Hono();
authRouter.use("*", authLimiter);

// In-memory OTP store: email → { otp, expiry, username, fullName, password }
const otpStore = new Map<string, { otp: string; expiry: number; username: string; fullName: string; password: string }>();

function generateOTP(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

async function sendOTPEmail(email: string, otp: string, fullName: string): Promise<void> {
  const resendKey = env.RESEND_API_KEY;
  if (!resendKey) throw new Error("RESEND_API_KEY not configured");

  const resend = new Resend(resendKey);
  const { error } = await resend.emails.send({
    from: "noreply@pathplus.store",
    to: email,
    subject: "Your verification code",
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 32px;">
        <h2 style="color: #0A1F44; margin-bottom: 8px;">Hi ${fullName},</h2>
        <p style="color: #475569; margin-bottom: 24px;">Use this code to verify your account:</p>
        <div style="background: #F1F5F9; border-radius: 12px; padding: 24px; text-align: center; margin-bottom: 24px;">
          <span style="font-size: 40px; font-weight: 700; letter-spacing: 8px; color: #0A1F44;">${otp}</span>
        </div>
        <p style="color: #94A3B8; font-size: 13px;">This code expires in 10 minutes. If you didn't request this, ignore this email.</p>
      </div>
    `,
  });

  if (error) throw new Error(error.message);
}

authRouter.post(
  "/signup",
  zValidator("json", z.object({
    email: z.string().email(),
    password: z.string().min(6),
    username: z.string().min(3),
    fullName: z.string().min(1),
  })),
  async (c) => {
    const { email, password, username, fullName } = c.req.valid("json");

    // Create user in Supabase with email already confirmed (bypasses SMTP)
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
      const isAlreadyExists = msg.includes("already registered") || msg.includes("already been registered") || msg.includes("duplicate");
      const isDatabaseError = msg.includes("database error");

      if (!isAlreadyExists && !isDatabaseError) {
        return c.json({ error: { message: createError.message } }, 400);
      }

      // For "database error" (trigger failure) or "already exists", look up the user by email
      if (!userId) {
        const { data: listData } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 });
        const found = (listData?.users ?? []).find(u => u.email?.toLowerCase() === email.toLowerCase());
        if (found) {
          userId = found.id;
        } else if (isDatabaseError) {
          return c.json({ error: { message: "Account creation failed due to a database error. Please try again." } }, 500);
        }
      }
    }

    // Upsert profile directly via supabaseAdmin (skip Prisma/SQLite entirely)
    if (!userId) {
      return c.json({ error: { message: "Account creation failed. Please try again." } }, 500);
    }

    const { error: profileError } = await supabaseAdmin
      .from("profiles")
      .upsert(
        { id: userId, username: username.toLowerCase().trim(), full_name: fullName },
        { onConflict: "id" }
      );
    if (profileError) {
      console.error("[auth/signup] Failed to upsert profile:", profileError.message, profileError);
      return c.json({ error: { message: "Failed to create profile. Please try again." } }, 500);
    }

    const otp = generateOTP();
    const expiry = Date.now() + 10 * 60 * 1000; // 10 minutes
    otpStore.set(email.toLowerCase(), { otp, expiry, username, fullName, password });

    try {
      await sendOTPEmail(email, otp, fullName);
    } catch (err: any) {
      console.error("[auth/signup] Failed to send OTP email:", err.message);
      return c.json({ error: { message: "Failed to send verification email. Please try again." } }, 500);
    }

    return c.json({ data: { success: true, message: "Verification code sent to your email." } });
  }
);

authRouter.post(
  "/verify-otp",
  zValidator("json", z.object({
    email: z.string().email(),
    otp: z.string().length(6),
  })),
  async (c) => {
    const { email, otp } = c.req.valid("json");
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

    // Generate a magic link token via admin API — bypasses passwords entirely
    const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
      type: "magiclink",
      email,
    });
    if (linkError || !linkData?.properties?.hashed_token) {
      console.error("[auth/verify-otp] generateLink error:", linkError?.message);
      return c.json({ error: { message: linkError?.message ?? "Failed to create session." } }, 500);
    }

    // Exchange the hashed token for a real session
    const { data: sessionData, error: sessionError } = await supabase.auth.verifyOtp({
      token_hash: linkData.properties.hashed_token,
      type: "magiclink",
    });
    if (sessionError || !sessionData.session) {
      console.error("[auth/verify-otp] verifyOtp error:", sessionError?.message);
      return c.json({ error: { message: sessionError?.message ?? "Failed to establish session." } }, 500);
    }

    return c.json({ data: {
      success: true,
      session: {
        access_token: sessionData.session.access_token,
        refresh_token: sessionData.session.refresh_token,
      },
    } });
  }
);

authRouter.post(
  "/resend-otp",
  zValidator("json", z.object({
    email: z.string().email(),
  })),
  async (c) => {
    const { email } = c.req.valid("json");
    const key = email.toLowerCase();
    const existing = otpStore.get(key);

    if (!existing) {
      return c.json({ error: { message: "No signup in progress for this email. Please sign up first." } }, 400);
    }

    const otp = generateOTP();
    const expiry = Date.now() + 10 * 60 * 1000;
    otpStore.set(key, {
      otp,
      expiry,
      username: existing.username,
      fullName: existing.fullName,
      password: existing.password,
    });

    try {
      await sendOTPEmail(email, otp, existing.fullName);
    } catch (err: any) {
      console.error("[auth/resend-otp] Failed to send OTP email:", err.message);
      return c.json({ error: { message: "Failed to send verification email. Please try again." } }, 500);
    }

    return c.json({ data: { success: true, message: "New verification code sent." } });
  }
);

export { authRouter };
