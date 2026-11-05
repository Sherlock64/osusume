/**
 * The same kind of limiter Better Auth runs on /api/auth (see `rateLimit` in auth/auth.ts),
 * for password checks on routes outside it. Like Better Auth's memory store, the counts
 * live in this process: they reset on restart and each api instance counts separately.
 */
export interface RateLimitRule {
  windowSeconds: number;
  max: number;
}

/** Matches Better Auth's rule for its own password endpoints. */
export const PASSWORD_CHECK_LIMIT: RateLimitRule = { windowSeconds: 10, max: 3 };

const windows = new Map<string, { startedAt: number; count: number }>();

/** Counts an attempt. Returns null if allowed, or the seconds to wait if not. */
export function consumeAttempt(key: string, rule: RateLimitRule, now = Date.now()): number | null {
  const windowMs = rule.windowSeconds * 1000;
  for (const [existing, entry] of windows) {
    if (now - entry.startedAt >= windowMs) windows.delete(existing);
  }
  const entry = windows.get(key);
  if (!entry) {
    windows.set(key, { startedAt: now, count: 1 });
    return null;
  }
  if (entry.count >= rule.max) return Math.ceil((entry.startedAt + windowMs - now) / 1000);
  entry.count += 1;
  return null;
}
