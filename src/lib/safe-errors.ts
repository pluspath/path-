/**
 * Map provider/internal errors to safe user-facing messages.
 * Never expose API keys, Supabase internals, or provider diagnostics to clients.
 */
export function toSafeUserMessage(
  raw: string | undefined | null,
  fallback: string
): string {
  const msg = (raw ?? "").trim();
  if (!msg) return fallback;

  const lower = msg.toLowerCase();

  // Resend / generic provider auth failures
  if (
    /api key is invalid|invalid api key|missing api key|unauthorized|forbidden|authentication failed|invalid_api_key|missing_api_key/.test(
      lower
    )
  ) {
    return fallback;
  }

  // Supabase misconfiguration
  if (/invalid api key|jwt|service role|apikey|invalid claim/.test(lower)) {
    return fallback;
  }

  // Known user-facing password-reset messages — pass through unchanged
  if (
    lower === "email address not found" ||
    lower.includes("invalid verification code") ||
    lower.includes("verification code has expired") ||
    lower.includes("please verify your code first") ||
    lower.includes("password must be at least") ||
    lower.includes("passwords do not match") ||
    lower.includes("please wait a minute") ||
    lower.includes("too many attempts") ||
    lower.includes("please enter a valid email")
  ) {
    return msg;
  }

  // Default: do not leak internal/provider strings
  return fallback;
}

export const RESET_EMAIL_SEND_ERROR =
  "Unable to send reset code. Please try again later.";
export const RESET_PASSWORD_UPDATE_ERROR =
  "Unable to reset password. Please try again later.";
export const RESET_LOOKUP_ERROR =
  "Unable to process your request. Please try again later.";
