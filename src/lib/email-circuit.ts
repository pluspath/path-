/**
 * Process-local circuit for Resend quota exhaustion.
 * Prevents hammering the provider after daily/monthly quota is hit.
 */

export type EmailCircuitReason = "daily_quota" | "monthly_quota" | "provider_down";

type CircuitState = {
  openUntilMs: number;
  reason: EmailCircuitReason;
};

let state: CircuitState | null = null;

function msUntilNextUtcMidnight(now = Date.now()): number {
  const d = new Date(now);
  const next = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1, 0, 0, 5);
  return Math.max(5_000, next - now);
}

export function noteEmailQuotaExceeded(kind: "daily" | "monthly" = "daily"): void {
  const openUntilMs =
    kind === "daily" ? Date.now() + msUntilNextUtcMidnight() : Date.now() + 60 * 60 * 1000;
  state = {
    openUntilMs,
    reason: kind === "daily" ? "daily_quota" : "monthly_quota",
  };
  console.warn(
    `[email-circuit] open reason=${state.reason} until=${new Date(openUntilMs).toISOString()}`
  );
}

export function noteEmailProviderFailure(holdMs = 60_000): void {
  const openUntilMs = Date.now() + holdMs;
  // Do not shorten an existing longer quota hold.
  if (state && state.openUntilMs > openUntilMs) return;
  state = { openUntilMs, reason: "provider_down" };
}

export function clearEmailCircuit(): void {
  state = null;
}

export function isEmailCircuitOpen(): boolean {
  if (!state) return false;
  if (Date.now() >= state.openUntilMs) {
    state = null;
    return false;
  }
  return true;
}

export function emailCircuitRetryAfterSec(): number {
  if (!state) return 0;
  return Math.max(1, Math.ceil((state.openUntilMs - Date.now()) / 1000));
}

export function emailCircuitReason(): EmailCircuitReason | null {
  return isEmailCircuitOpen() ? state?.reason ?? null : null;
}
