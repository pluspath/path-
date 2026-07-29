import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { randomInt } from "crypto";
import { existsSync, readFileSync } from "fs";
import { resolve } from "path";
import { Resend } from "resend";
import { supabase, supabaseAdmin } from "../supabase";
import { env } from "../env";
import { authLimiter } from "../lib/rate-limit";

function readResendKeyFromEnvFile(): string {
  for (const file of [".env", ".env.local", ".env.production"]) {
    const path = resolve(process.cwd(), file);
    if (!existsSync(path)) continue;
    for (const raw of readFileSync(path, "utf8").split(/\r?\n/)) {
      const line = raw.trim();
      if (!line.startsWith("RESEND_API_KEY=")) continue;
      let value = line.slice("RESEND_API_KEY=".length).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (value) return value;
    }
  }
  return "";
}

function getResendApiKey(): string {
  const fromEnv = env.RESEND_API_KEY?.trim() || process.env.RESEND_API_KEY?.trim() || "";
  if (fromEnv) return fromEnv;
  const fromFile = readResendKeyFromEnvFile();
  if (fromFile) {
    process.env.RESEND_API_KEY = fromFile;
  }
  return fromFile;
}

const authRouter = new Hono();
authRouter.use("*", authLimiter);

// In-memory OTP store — never store passwords here
const otpStore = new Map<
  string,
  {
    otp: string;
    expiry: number;
    username: string;
    fullName: string;
    attempts: number;
    userId: string;
  }
>();

// Password-reset OTP store (separate from signup)
const resetOtpStore = new Map<
  string,
  { otp: string; expiry: number; userId: string; attempts: number; verified?: boolean }
>();

function generateOTP(): string {
  return randomInt(100000, 1000000).toString();
}

async function findUserByEmail(email: string) {
  const normalized = email.toLowerCase();
  let page = 1;
  const perPage = 200;
  while (page <= 25) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage });
    if (error) {
      console.error("[auth] listUsers error:", error.message);
      return null;
    }
    const users = data?.users ?? [];
    const found = users.find((u) => u.email?.toLowerCase() === normalized);
    if (found) return found;
    if (users.length < perPage) break;
    page += 1;
  }
  return null;
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
  const resendKey = getResendApiKey();
  if (!resendKey) {
    // Allow signup without Resend during local setup — OTP is returned to the client.
    console.warn(
      `[auth] RESEND_API_KEY not configured — using local OTP for ${email}: ${otp}`
    );
    return false;
  }

  const safeName = escapeHtml(fullName);
  const resend = new Resend(resendKey);
  const fromAddress =
    process.env.RESEND_FROM_EMAIL?.trim() ||
    env.RESEND_FROM_EMAIL?.trim() ||
    "Path+ <noreply@pathplus.store>";

  const html = `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 32px;">
        <h2 style="color: #0A1F44; margin-bottom: 8px;">Hi ${safeName},</h2>
        <p style="color: #475569; margin-bottom: 24px;">Use this code to verify your account:</p>
        <div style="background: #F1F5F9; border-radius: 12px; padding: 24px; text-align: center; margin-bottom: 24px;">
          <span style="font-size: 40px; font-weight: 700; letter-spacing: 8px; color: #0A1F44;">${otp}</span>
        </div>
        <p style="color: #94A3B8; font-size: 13px;">This code expires in 10 minutes. If you didn't request this, ignore this email.</p>
      </div>
    `;

  let { error } = await resend.emails.send({
    from: fromAddress,
    to: email,
    subject: "Your verification code",
    html,
  });

  // If custom domain isn't verified yet, try Resend's test sender (only works for the Resend account email).
  if (
    error &&
    /not verified|domain/i.test(error.message) &&
    !fromAddress.includes("resend.dev")
  ) {
    console.warn(
      `[auth] ${error.message} — retrying with onboarding@resend.dev`
    );
    ({ error } = await resend.emails.send({
      from: "Path+ <onboarding@resend.dev>",
      to: email,
      subject: "Your verification code",
      html,
    }));
  }

  if (error) throw new Error(error.message);
  console.log(`[auth] OTP email sent to ${email} via Resend`);
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
        const found = await findUserByEmail(email);
        if (found) {
          // Do not re-issue OTP for already-confirmed accounts (enumeration + takeover risk)
          if (found.email_confirmed_at) {
            return c.json(
              { error: { message: "An account with this email already exists. Please sign in." } },
              400
            );
          }
          userId = found.id;
          // Keep password in sync with what the user just entered
          const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(userId, {
            password,
            user_metadata: { full_name: fullName, username },
            email_confirm: false,
          });
          if (updateError) {
            console.error("[auth/signup] Failed to update unconfirmed user:", updateError.message);
            return c.json(
              { error: { message: "Account creation failed. Please try again." } },
              500
            );
          }
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
      userId,
    });

    let emailed = true;
    try {
      emailed = await sendOTPEmail(email, otp, fullName);
    } catch (err: any) {
      console.error("[auth/signup] Failed to send OTP email:", err.message);
      const detail = String(err?.message ?? "");
      const domainIssue = /not verified|domain/i.test(detail);
      const testingOnly = /only send testing emails|own email/i.test(detail);
      return c.json(
        {
          error: {
            message: domainIssue
              ? "Email domain pathplus.store is not verified in Resend. Add and verify it at resend.com/domains, then try again."
              : testingOnly
                ? "Resend can only email your account address until pathplus.store is verified. Verify the domain at resend.com/domains."
                : "Failed to send verification email. Please try again.",
          },
        },
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

    const userId = stored.userId;
    otpStore.delete(key);

    // Confirm email so password login works after verification
    const { error: confirmError } = await supabaseAdmin.auth.admin.updateUserById(userId, {
      email_confirm: true,
    });
    if (confirmError) {
      console.error("[auth/verify-otp] Failed to confirm email:", confirmError.message);
      return c.json(
        { error: { message: "Failed to verify account. Please try again." } },
        500
      );
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
      userId: existing.userId,
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

authRouter.post(
  "/forgot-password",
  zValidator(
    "json",
    z.object({
      email: z.string().email(),
    })
  ),
  async (c) => {
    const { email } = c.req.valid("json");
    const key = email.toLowerCase();
    const user = await findUserByEmail(email);

    // Always return success to avoid email enumeration
    if (!user) {
      return c.json({
        data: { success: true, message: "If an account exists, a reset code was sent." },
      });
    }

    const otp = generateOTP();
    const expiry = Date.now() + 10 * 60 * 1000;
    resetOtpStore.set(key, {
      otp,
      expiry,
      userId: user.id,
      attempts: 0,
      verified: false,
    });

    const fullName =
      (typeof user.user_metadata?.full_name === "string" && user.user_metadata.full_name) ||
      "there";

    let emailed = true;
    try {
      emailed = await sendOTPEmail(email, otp, fullName);
    } catch (err: any) {
      console.error("[auth/forgot-password] Failed to send OTP email:", err.message);
      return c.json(
        { error: { message: "Failed to send reset email. Please try again." } },
        500
      );
    }

    return c.json({
      data: {
        success: true,
        message: emailed
          ? "If an account exists, a reset code was sent."
          : "Email service not configured. Use the code shown in the app.",
        ...(!emailed ? { devOtp: otp } : {}),
      },
    });
  }
);

authRouter.post(
  "/verify-reset-otp",
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
    const stored = resetOtpStore.get(key);

    if (!stored) {
      return c.json(
        { error: { message: "No reset code found. Please request a new one." } },
        400
      );
    }
    if (Date.now() > stored.expiry) {
      resetOtpStore.delete(key);
      return c.json(
        { error: { message: "Reset code expired. Please request a new one." } },
        400
      );
    }
    if (stored.otp !== otp) {
      stored.attempts += 1;
      if (stored.attempts >= 5) {
        resetOtpStore.delete(key);
        return c.json(
          { error: { message: "Too many invalid attempts. Please request a new code." } },
          400
        );
      }
      resetOtpStore.set(key, stored);
      return c.json({ error: { message: "Invalid code. Please try again." } }, 400);
    }

    resetOtpStore.set(key, { ...stored, verified: true, attempts: 0 });
    return c.json({ data: { success: true } });
  }
);

authRouter.post(
  "/reset-password",
  zValidator(
    "json",
    z.object({
      email: z.string().email(),
      otp: z.string().length(6),
      password: z.string().min(6).max(128),
    })
  ),
  async (c) => {
    const { email, otp, password } = c.req.valid("json");
    const key = email.toLowerCase();
    const stored = resetOtpStore.get(key);

    if (!stored || !stored.verified || stored.otp !== otp) {
      return c.json(
        { error: { message: "Invalid or expired reset session. Please start again." } },
        400
      );
    }
    if (Date.now() > stored.expiry) {
      resetOtpStore.delete(key);
      return c.json(
        { error: { message: "Reset code expired. Please request a new one." } },
        400
      );
    }

    const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(stored.userId, {
      password,
      email_confirm: true,
    });
    if (updateError) {
      console.error("[auth/reset-password] updateUserById error:", updateError.message);
      return c.json(
        { error: { message: updateError.message || "Failed to update password." } },
        500
      );
    }

    resetOtpStore.delete(key);
    return c.json({ data: { success: true, message: "Password updated successfully." } });
  }
);

export { authRouter };
