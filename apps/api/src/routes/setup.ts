import { setupRequestSchema, tokenBodySchema } from '@osusume/shared';
import { and, eq, gt, like, lte } from 'drizzle-orm';
import { z } from 'zod';
import { hashPassword, insertAccount, refusingTakenUsername, toAccount } from '../auth/accounts.ts';
import { firstRunSetupMail } from '../auth/emails.ts';
import type { Database, Transaction } from '../db/client.ts';
import { user, verification } from '../db/schema.ts';
import { ApiError } from '../lib/errors.ts';
import { lockFirstRunSetup } from '../lib/locks.ts';
import { sendOrFail } from '../lib/mailer.ts';
import { createRouter, valid } from '../lib/router.ts';
import { generateToken, hashToken } from '../lib/tokens.ts';

const SETUP_LINK_LIFETIME_MS = 24 * 60 * 60 * 1000;
const IDENTIFIER_PREFIX = 'first-run-setup:';

/** What a pending setup holds in its verification row until the link is used. */
const pendingSetupSchema = z.object({
  username: z.string(),
  email: z.string(),
  passwordHash: z.string(),
});

const setupClosed = () =>
  new ApiError(409, 'setup_closed', 'Setup is closed because an account already exists.');

/** Setup is open only while no account exists. The first admin cannot be removed, so it never reopens. */
async function isSetupOpen(db: Database | Transaction): Promise<boolean> {
  const [existing] = await db.select({ id: user.id }).from(user).limit(1);
  return existing === undefined;
}

export const setupRoutes = createRouter()
  // Whether first-run setup is still open
  .get('/setup/status', async (c) => {
    return c.json({ open: await isSetupOpen(c.var.deps.db) }, 200);
  })
  // Start first-run setup: emails a link that creates the first admin
  .post('/setup', valid('json', setupRequestSchema), async (c) => {
    const { db, auth, mailer, publicBaseUrl } = c.var.deps;
    const body = c.req.valid('json');

    if (!(await isSetupOpen(db))) throw setupClosed();
    const passwordHash = await hashPassword(auth, body.password);

    const token = generateToken();
    await db.transaction(async (tx) => {
      await lockFirstRunSetup(tx);
      if (!(await isSetupOpen(tx))) throw setupClosed();
      await tx
        .delete(verification)
        .where(
          and(
            like(verification.identifier, `${IDENTIFIER_PREFIX}%`),
            lte(verification.expiresAt, new Date()),
          ),
        );
      await tx.insert(verification).values({
        identifier: IDENTIFIER_PREFIX + hashToken(token),
        value: JSON.stringify({
          username: body.username,
          email: body.email,
          passwordHash,
        } satisfies z.infer<typeof pendingSetupSchema>),
        expiresAt: new Date(Date.now() + SETUP_LINK_LIFETIME_MS),
      });
      await sendOrFail(mailer, firstRunSetupMail(publicBaseUrl, body.email, token));
    });
    return c.json({ status: 'email_sent' as const }, 202);
  })
  // Use the emailed link: creates the permanent first admin and closes setup
  .post('/setup/verify', valid('json', tokenBodySchema), async (c) => {
    const { db } = c.var.deps;
    const { token } = c.req.valid('json');

    const created = await refusingTakenUsername(() =>
      db.transaction(async (tx) => {
        // Two links used at once, or a stale one used later: the lock and this check leave
        // exactly one winner, and user_single_first_admin backs it at database level.
        await lockFirstRunSetup(tx);
        if (!(await isSetupOpen(tx))) throw setupClosed();

        const [row] = await tx
          .select({ value: verification.value })
          .from(verification)
          .where(
            and(
              eq(verification.identifier, IDENTIFIER_PREFIX + hashToken(token)),
              gt(verification.expiresAt, new Date()),
            ),
          );
        if (!row) throw new ApiError(404, 'token_invalid', 'This link is not valid or has expired.');
        const pending = pendingSetupSchema.parse(JSON.parse(row.value));

        const admin = await insertAccount(tx, {
          username: pending.username,
          email: pending.email,
          passwordHash: pending.passwordHash,
          role: 'admin',
          isFirstAdmin: true,
        });
        // Removes every pending setup, including the password hashes they hold.
        await tx.delete(verification).where(like(verification.identifier, `${IDENTIFIER_PREFIX}%`));
        return admin;
      }),
    );
    return c.json(toAccount(created), 201);
  });
