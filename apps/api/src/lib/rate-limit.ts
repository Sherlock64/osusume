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

/** Enough to invite a group of friends in one sitting. */
export const INVITE_REQUEST_LIMIT: RateLimitRule = { windowSeconds: 60 * 60, max: 10 };

/** Accepting an invite needs no login, so this keeps one client from flooding it. */
export const INVITE_ACCEPT_LIMIT: RateLimitRule = { windowSeconds: 60, max: 10 };

const windows = new Map<string, { expiresAt: number; count: number }>();

/** Counts an attempt. Returns null if allowed, or the seconds to wait if not. */
export function consumeAttempt(key: string, rule: RateLimitRule, now = Date.now()): number | null {
  // Each entry keeps its own end: rules of different lengths share this map.
  for (const [existing, entry] of windows) {
    if (now >= entry.expiresAt) windows.delete(existing);
  }
  const entry = windows.get(key);
  if (!entry) {
    windows.set(key, { expiresAt: now + rule.windowSeconds * 1000, count: 1 });
    return null;
  }
  if (entry.count >= rule.max) return Math.ceil((entry.expiresAt - now) / 1000);
  entry.count += 1;
  return null;
}

/** For tests whose setup goes through a limited route. */
export function clearAttempts(): void {
  windows.clear();
}
