import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  USERNAME_MAX_LENGTH,
  USERNAME_MIN_LENGTH,
} from '@osusume/shared';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { APIError } from 'better-auth/api';
import { username } from 'better-auth/plugins';
import { eq } from 'drizzle-orm';
import type { Database } from '../db/client.ts';
import { account, session, user, verification } from '../db/schema.ts';
import type { Mailer } from '../lib/mailer.ts';
import { passwordResetMail } from './emails.ts';

/**
 * The only Better Auth endpoints reachable over HTTP. Everything else it ships would
 * bypass a rule here: signing up, logging in by email, changing username or email
 * directly, deleting an account, or testing whether a username exists.
 */
export const exposedAuthEndpoints = {
  GET: ['/get-session'],
  POST: [
    '/sign-in/username',
    '/sign-out',
    '/request-password-reset',
    '/reset-password',
    '/change-password',
  ],
} as const;

export interface AuthOptions {
  db: Database;
  secret: string;
  publicBaseUrl: string;
  mailer: Mailer;
}

async function isDisabled(db: Database, userId: string): Promise<boolean> {
  const [row] = await db
    .select({ disabledAt: user.disabledAt })
    .from(user)
    .where(eq(user.id, userId));
  return row?.disabledAt != null;
}

export function createAuth({ db, secret, publicBaseUrl, mailer }: AuthOptions) {
  return betterAuth({
    appName: 'Osusume',
    baseURL: publicBaseUrl,
    basePath: '/api/auth',
    secret,
    telemetry: { enabled: false },
    database: drizzleAdapter(db, {
      provider: 'pg',
      schema: { user, session, account, verification },
    }),
    advanced: {
      database: { generateId: 'uuid' },
      // Better Auth turns this check off when NODE_ENV is test. Stated here so the tests
      // run what production runs.
      disableOriginCheck: false,
    },
    // Blanket limit on the endpoints above, keyed by client IP. Better Auth only enables
    // it by default in production.
    rateLimit: { enabled: true },
    // Password reset tokens are stored hashed, like every other emailed token.
    verification: { storeIdentifier: 'hashed' },
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: PASSWORD_MIN_LENGTH,
      maxPasswordLength: PASSWORD_MAX_LENGTH,
      revokeSessionsOnPasswordReset: true,
      resetPasswordTokenExpiresIn: 60 * 60,
      sendResetPassword: async ({ user: target, token }) => {
        try {
          if (await isDisabled(db, target.id)) return;
          await mailer.send(passwordResetMail(publicBaseUrl, target.email, token));
        } catch (error) {
          console.error('Sending the password reset email failed:', error);
        }
      },
    },
    plugins: [
      username({ minUsernameLength: USERNAME_MIN_LENGTH, maxUsernameLength: USERNAME_MAX_LENGTH }),
    ],
    user: {
      additionalFields: {
        role: { type: 'string', input: false, required: false },
        isFirstAdmin: { type: 'boolean', input: false, required: false },
        disabledAt: { type: 'date', input: false, required: false },
      },
    },
    databaseHooks: {
      session: {
        create: {
          before: async (newSession) => {
            if (await isDisabled(db, newSession.userId)) {
              throw new APIError('FORBIDDEN', {
                code: 'ACCOUNT_DISABLED',
                message: 'This account is disabled.',
              });
            }
          },
        },
      },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
