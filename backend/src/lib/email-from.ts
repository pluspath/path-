import { env } from "../env";

/** Verified Resend sender. Override with RESEND_FROM_EMAIL in production. */
export function resendFromAddress(): string {
  const configured = env.RESEND_FROM_EMAIL?.trim();
  if (configured) return configured;
  return "Path+ <noreply@pathplus.store>";
}

/**
 * Public marketing / app site URL for emails and docs.
 * Must never fall back to localhost in production.
 */
export function publicAppUrl(): string {
  const configured = env.PUBLIC_APP_URL?.trim().replace(/\/+$/, "");
  if (configured) return configured;
  const backend = env.BACKEND_URL?.trim().replace(/\/+$/, "") ?? "";
  if (backend && !/localhost|127\.0\.0\.1/i.test(backend)) {
    // Prefer marketing site when API host is known production API.
    if (/api\.pathplus\.store$/i.test(new URL(backend).hostname)) {
      return "https://site.pathplus.store";
    }
  }
  return "https://site.pathplus.store";
}
