import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { randomInt } from "crypto";
import { Resend } from "resend";
import { supabase, supabaseAdmin } from "../supabase";
import { env } from "../env";
import { authLimiter } from "../lib/rate-limit";

const authRouter = new Hono();
authRouter.use("*", authLimiter);

// In-memory OTP store — never store passwords here
const otpStore = new Map<
  string,
  { otp: string; expiry: number; username: string; fullName: string; attempts: number }
>();

function generateOTP(): string {
  return randomInt(100000, 1000000).toString();
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Returns true when email was sent via Resend; false when using local/dev fallback. */
async function sendOTPEmail(email: string, otp: string, fullName: string): Promise<boolean> {
  const resendKey = env.RESEND_API_KEY?.trim();
  if (!resendKey) {
    // Allow signup without Resend during local setup — OTP is returned to the client.
    console.warn(
      `[auth] RESEND_API_KEY not configured — using local OTP for ${email}: ${otp}`
    );
    return false;
  }

  const safeName = escapeHtml(fullName);
  const resend = new Resend(resendKey);
  const { error } = await resend.emails.send({
    from: "noreply@pathplus.store",
    to: email,
    subject: "Your verification code",
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 32px;">
        <h2 style="color: #0A1F44; margin-bottom: 8px;">Hi ${safeName},</h2>
        <p style="color: #475569; margin-bottom: 24px;">Use this code to verify your account:</p>
        <div style="background: #F1F5F9; border-radius: 12px; padding: 24px; text-align: center; margin-bottom: 24px;">
          <span style="font-size: 40px; font-weight: 700; letter-spacing: 8px; color: #0A1F44;">${otp}</span>
        </div>
        <p style="color: #94A3B8; font-size: 13px;">This code expires in 10 minutes. If you didn't request this, ignore this email.</p>
      </div>
    `,
  });

  if (error) throw new Error(error.message);
  return true;
}

authRouter.post(
  "/signup",
  zValidator(
    "json",
    z.object({
      email: z.string().email(),
      password: z.string().min(6).max(128),
      username: z.string().min(3).max(32),
      fullName: z.string().min(1).max(100),
    })
  ),
  async (c) => {
    const { email, password, username, fullName } = c.req.valid("json");

    // Keep email unconfirmed until OTP succeeds — prevents password login bypass
    const { data: userData, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: false,
      user_metadata: { full_name: fullName, username },
    });

    let userId = userData?.user?.id ?? null;

    if (createError) {
      console.error("[auth/signup] createUser error:", createError.message);
      const msg = createError.message.toLowerCase();
      const isAlreadyExists =
        msg.includes("already registered") ||
        msg.includes("already been registered") ||
        msg.includes("duplicate");
      const isDatabaseError = msg.includes("database error");

      if (!isAlreadyExists && !isDatabaseError) {
        return c.json({ error: { message: createError.message } }, 400);
      }

      if (!userId) {
        const { data: listData } = await supabaseAdmin.auth.admin.listUsers({
          page: 1,
          perPage: 1000,
        });
        const found = (listData?.users ?? []).find(
          (u) => u.email?.toLowerCase() === email.toLowerCase()
        );
        if (found) {
          // Do not re-issue OTP for already-confirmed accounts (enumeration + takeover risk)
          if (found.email_confirmed_at) {
            return c.json(
              { error: { message: "An account with this email already exists. Please sign in." } },
              400
            );
          }
          userId = found.id;
        } else if (isDatabaseError) {
          return c.json(
            {
              error: {
                message: "Account creation failed due to a database error. Please try again.",
              },
            },
            500
          );
        }
      }
    }

    if (!userId) {
      return c.json({ error: { message: "Account creation failed. Please try again." } }, 500);
    }

    const { error: profileError } = await supabaseAdmin.from("profiles").upsert(
      { id: userId, username: username.toLowerCase().trim(), full_name: fullName },
      { onConflict: "id" }
    );
    if (profileError) {
      console.error("[auth/signup] Failed to upsert profile:", profileError.message, profileError);
      return c.json({ error: { message: "Failed to create profile. Please try again." } }, 500);
    }

    const otp = generateOTP();
    const expiry = Date.now() + 10 * 60 * 1000;
    otpStore.set(email.toLowerCase(), {
      otp,
      expiry,
      username,
      fullName,
      attempts: 0,
    });

    let emailed = true;
    try {
      emailed = await sendOTPEmail(email, otp, fullName);
    } catch (err: any) {
      console.error("[auth/signup] Failed to send OTP email:", err.message);
      return c.json(
        { error: { message: "Failed to send verification email. Please try again." } },
        500
      );
    }

    return c.json({
      data: {
        success: true,
        message: emailed
          ? "Verification code sent to your email."
          : "Email service not configured. Use the code shown in the app.",
        // Only returned when Resend is not configured (local setup).
        ...(!emailed ? { devOtp: otp } : {}),
      },
    });
  }
);

authRouter.post(
  "/verify-otp",
  zValidator(
    "json",
    z.object({
      email: z.string().email(),
      otp: z.string().length(6),
    })
  ),
  async (c) => {
    const { email, otp } = c.req.valid("json");
    const key = email.toLowerCase();
    const stored = otpStore.get(key);

    if (!stored) {
      return c.json(
        { error: { message: "No verification code found. Please sign up again." } },
        400
      );
    }
    if (Date.now() > stored.expiry) {
      otpStore.delete(key);
      return c.json(
        { error: { message: "Verification code expired. Please request a new one." } },
        400
      );
    }
    if (stored.otp !== otp) {
      stored.attempts += 1;
      if (stored.attempts >= 5) {
        otpStore.delete(key);
        return c.json(
          { error: { message: "Too many invalid attempts. Please sign up again." } },
          400
        );
      }
      otpStore.set(key, stored);
      return c.json({ error: { message: "Invalid code. Please try again." } }, 400);
    }

    otpStore.delete(key);

    // Confirm email so password login works after verification
    const { data: listData } = await supabaseAdmin.auth.admin.listUsers({
      page: 1,
      perPage: 1000,
    });
    const found = (listData?.users ?? []).find(
      (u) => u.email?.toLowerCase() === email.toLowerCase()
    );
    if (found) {
      await supabaseAdmin.auth.admin.updateUserById(found.id, { email_confirm: true });
    }

    const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
      type: "magiclink",
      email,
    });
    if (linkError || !linkData?.properties?.hashed_token) {
      console.error("[auth/verify-otp] generateLink error:", linkError?.message);
      return c.json(
        { error: { message: linkError?.message ?? "Failed to create session." } },
        500
      );
    }

    const { data: sessionData, error: sessionError } = await supabase.auth.verifyOtp({
      token_hash: linkData.properties.hashed_token,
      type: "magiclink",
    });
    if (sessionError || !sessionData.session) {
      console.error("[auth/verify-otp] verifyOtp error:", sessionError?.message);
      return c.json(
        { error: { message: sessionError?.message ?? "Failed to establish session." } },
        500
      );
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
  }
);

authRouter.post(
  "/resend-otp",
  zValidator(
    "json",
    z.object({
      email: z.string().email(),
    })
  ),
  async (c) => {
    const { email } = c.req.valid("json");
    const key = email.toLowerCase();
    const existing = otpStore.get(key);

    if (!existing) {
      return c.json(
        {
          error: {
            message: "No signup in progress for this email. Please sign up first.",
          },
        },
        400
      );
    }

    const otp = generateOTP();
    const expiry = Date.now() + 10 * 60 * 1000;
    otpStore.set(key, {
      otp,
      expiry,
      username: existing.username,
      fullName: existing.fullName,
      attempts: 0,
    });

    let emailed = true;
    try {
      emailed = await sendOTPEmail(email, otp, existing.fullName);
    } catch (err: any) {
      console.error("[auth/resend-otp] Failed to send OTP email:", err.message);
      return c.json(
        { error: { message: "Failed to send verification email. Please try again." } },
        500
      );
    }

    return c.json({
      data: {
        success: true,
        message: emailed
          ? "New verification code sent."
          : "Email service not configured. Use the code shown in the app.",
        ...(!emailed ? { devOtp: otp } : {}),
      },
    });
  }
);

export { authRouter };
