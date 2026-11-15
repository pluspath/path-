/**
 * Fail-fast circuit breaker for Supabase Disk I/O overload.
 * When recent requests abort/timeout, short-circuit nonessential work so
 * auth/login can recover instead of waiting 20–45s per call.
 *
 * Half-open: after OPEN_MS, allow traffic; require SUCCESS_THRESHOLD successes
 * to fully close. Unrelated errors while open no longer extend the window.
 */

let openUntil = 0;
let recentFailures = 0;
let recentSuccesses = 0;
let halfOpen = false;

/** Stay open long enough for Disk I/O budget to refill under reduced load. */
const OPEN_MS = 45_000;
const FAILURE_THRESHOLD = 3;
const SUCCESS_THRESHOLD = 2;

export function noteSupabaseFailure(err?: unknown): void {
  const message = err instanceof Error ? err.message : String(err ?? "");
  const isIoFailure =
    /abort|timeout|timed out|503|502|Disk I\/O|IO budget|fetch failed/i.test(message) ||
    err == null;
  if (!isIoFailure) {
    // Do not extend the open window for unrelated errors.
    return;
  }
  recentFailures += 1;
  recentSuccesses = 0;
  halfOpen = false;
  if (recentFailures >= FAILURE_THRESHOLD) {
    openUntil = Date.now() + OPEN_MS;
  }
}

export function noteSupabaseSuccess(): void {
  recentSuccesses += 1;
  recentFailures = Math.max(0, recentFailures - 1);
  if (recentSuccesses >= SUCCESS_THRESHOLD) {
    openUntil = 0;
    recentFailures = 0;
    recentSuccesses = 0;
    halfOpen = false;
  }
}

export function isSupabaseCircuitOpen(): boolean {
  const now = Date.now();
  if (openUntil <= 0) return false;
  if (now < openUntil) return true;
  // Half-open probe window: treat as closed so one request can try.
  if (!halfOpen) {
    halfOpen = true;
    openUntil = now + 5_000;
    return false;
  }
  // Still recovering — keep shedding until successes close the circuit.
  return recentSuccesses < SUCCESS_THRESHOLD;
}

export function supabaseCircuitRetryAfterSec(): number {
  return Math.max(1, Math.ceil((openUntil - Date.now()) / 1000));
}
