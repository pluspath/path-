import { z } from "zod";
import { existsSync, readFileSync } from "fs";
import { resolve } from "path";

/**
 * Bun loads .env without overriding variables already set in the process
 * environment. Vibecode / VPS host env can keep a deleted Supabase project URL.
 * Prefer SUPABASE_* (and BACKEND_URL) from the workspace .env when present.
 */
function applyEnvFileOverrides() {
  const envPath = resolve(process.cwd(), ".env");
  if (!existsSync(envPath)) return;

  const overrideKeys = new Set([
    "SUPABASE_URL",
    "SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "BACKEND_URL",
    "ADMIN_JWT_SECRET",
    "ADMIN_JWT_EXPIRES_IN",
    "ADMIN_DEFAULT_PASSWORD",
    "RESEND_API_KEY",
  ]);

  const text = readFileSync(envPath, "utf8");
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const eq = line.indexOf("=");
    if (eq <= 0) continue;

    const key = line.slice(0, eq).trim();
    if (!overrideKeys.has(key)) continue;

    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (value) {
      process.env[key] = value;
    }
  }

  console.log(`[config] Applied Supabase overrides from ${envPath}`);
}

applyEnvFileOverrides();

const envSchema = z.object({
  PORT: z.string().optional().default("3000"),
  NODE_ENV: z.string().optional(),
  SUPABASE_URL: z.string().url("SUPABASE_URL must be a valid URL"),
  SUPABASE_ANON_KEY: z.string().min(1, "SUPABASE_ANON_KEY is required"),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  BACKEND_URL: z.string().default("http://localhost:3000"),
  GOOGLE_PLACES_API_KEY: z.string().min(1, "GOOGLE_PLACES_API_KEY is required"),
  OPENAI_API_KEY: z.string().optional(),
  BETTER_AUTH_SECRET: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),
  ADMIN_JWT_SECRET: z.string().min(32).optional(),
  ADMIN_JWT_EXPIRES_IN: z.string().optional().default("8h"),
  ADMIN_DEFAULT_PASSWORD: z.string().optional(),
  ADMIN_CORS_ORIGIN: z.string().optional(),
});

function supabaseProjectRef(url: string): string {
  try {
    const host = new URL(url).hostname;
    return host.split(".")[0] ?? host;
  } catch {
    return "invalid";
  }
}

function validateEnv() {
  try {
    const parsed = envSchema.parse(process.env);
    console.log("Environment variables validated successfully");
    console.log(`[config] Supabase URL: ${parsed.SUPABASE_URL}`);
    console.log(`[config] Supabase project: ${supabaseProjectRef(parsed.SUPABASE_URL)}`);
    console.log(`[config] Backend URL: ${parsed.BACKEND_URL}`);
    if (!parsed.SUPABASE_SERVICE_ROLE_KEY) {
      console.warn("[config] SUPABASE_SERVICE_ROLE_KEY not set — admin auth/storage may fail");
    }
    if (!parsed.ADMIN_JWT_SECRET) {
      console.warn(
        "[config] ADMIN_JWT_SECRET not set — admin JWT login will fail until configured (min 32 chars)"
      );
    }
    return parsed;
  } catch (error) {
    if (error instanceof z.ZodError) {
      console.error("Environment variable validation failed:");
      error.issues.forEach((err: any) => {
        console.error(`  - ${err.path.join(".")}: ${err.message}`);
      });
      process.exit(1);
    }
    throw error;
  }
}

export const env = validateEnv();
export type Env = z.infer<typeof envSchema>;
export { supabaseProjectRef };
