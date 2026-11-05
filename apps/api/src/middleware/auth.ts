import { type ErrorResponse, type UserRole, userRoleSchema } from '@osusume/shared';
import { createMiddleware } from 'hono/factory';
import type { Auth } from '../auth/auth.ts';
import type { AppEnv } from '../lib/context.ts';
import { ApiError } from '../lib/errors.ts';
import {
  INVITE_REQUEST_LIMIT,
  PASSWORD_CHECK_LIMIT,
  type RateLimitRule,
  consumeAttempt,
} from '../lib/rate-limit.ts';

export interface CurrentUser {
  id: string;
  username: string;
  email: string;
  role: UserRole;
  isFirstAdmin: boolean;
}

interface SessionEnv extends AppEnv {
  Variables: AppEnv['Variables'] & { currentUser: CurrentUser };
}

async function loadCurrentUser(auth: Auth, headers: Headers): Promise<CurrentUser> {
  const result = await auth.api.getSession({
    headers,
    query: { disableRefresh: true },
  });
  if (!result) throw new ApiError(401, 'unauthenticated', 'Log in to continue.');
  if (result.user.disabledAt != null) {
    throw new ApiError(403, 'account_disabled', 'This account is disabled.');
  }
  return {
    id: result.user.id,
    username: result.user.displayUsername ?? result.user.name,
    email: result.user.email,
    role: userRoleSchema.parse(result.user.role),
    isFirstAdmin: result.user.isFirstAdmin === true,
  };
}

/** For a route that needs no session: whether the request happens to come from an admin. */
export async function callerIsAdmin(auth: Auth, headers: Headers): Promise<boolean> {
  try {
    return (await loadCurrentUser(auth, headers)).role === 'admin';
  } catch (error) {
    if (error instanceof ApiError) return false;
    throw error;
  }
}

/**
 * Requires a logged-in, enabled user and sets `currentUser`. Pass as a route's `middleware`.
 * Reads the session and user from the database on every request (Better Auth's cookie
 * cache is off), so a role change or a disable applies immediately. Refreshing the session
 * is left to Better Auth's get-session, which can also re-issue the cookie.
 */
export const requireSession = createMiddleware<SessionEnv>(async (c, next) => {
  c.set('currentUser', await loadCurrentUser(c.var.deps.auth, c.req.raw.headers));
  await next();
});

/** requireSession that also counts the request against the user's bucket, before reading the body. */
const requireSessionLimited = (bucket: string, rule: RateLimitRule) =>
  createMiddleware<SessionEnv>(async (c, next) => {
    const currentUser = await loadCurrentUser(c.var.deps.auth, c.req.raw.headers);
    const retryAfter = consumeAttempt(`${bucket}:${currentUser.id}`, rule);
    if (retryAfter !== null) {
      const body: ErrorResponse = {
        error: { code: 'rate_limited', message: 'Too many attempts. Please try again later.' },
      };
      return c.json(body, 429, { 'X-Retry-After': String(retryAfter) });
    }
    c.set('currentUser', currentUser);
    await next();
    return undefined;
  });

/**
 * requireSession for a route that checks the current password, limited per user across all
 * such routes so a stolen session cannot guess it. The login and change-password endpoints
 * have the equivalent from Better Auth. Per process: see lib/rate-limit.ts.
 */
export const requireSessionForPasswordCheck = requireSessionLimited(
  'password-check',
  PASSWORD_CHECK_LIMIT,
);

/**
 * requireSession for requesting an invite. The limit applies before the address is read, so
 * hitting it says nothing about any address. Per process: see lib/rate-limit.ts.
 */
export const requireSessionForInviteRequest = requireSessionLimited(
  'invite-request',
  INVITE_REQUEST_LIMIT,
);

/** The same as requireSession, and the user must be an admin. */
export const requireAdmin = createMiddleware<SessionEnv>(async (c, next) => {
  const currentUser = await loadCurrentUser(c.var.deps.auth, c.req.raw.headers);
  if (currentUser.role !== 'admin') {
    throw new ApiError(403, 'admin_required', 'Only admins can do this.');
  }
  c.set('currentUser', currentUser);
  await next();
});
