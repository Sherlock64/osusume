import { sql } from 'drizzle-orm';
import type { Transaction } from '../db/client.ts';

async function lock(tx: Transaction, key: string): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`);
}

/**
 * Serializes everything that decides what an email address may do: requesting, approving
 * and accepting invites, changing email, and removing or banning. Rules that span several
 * rows (one open invite per email, no invite for a blacklisted or registered address)
 * cannot be enforced by a constraint alone. Held until the transaction ends.
 *
 * Lock order, to rule out deadlocks: the user row, then email locks (sorted here), then
 * invite rows.
 */
export async function lockEmails(tx: Transaction, ...emails: string[]): Promise<void> {
  const keys = [...new Set(emails.map((email) => email.toLowerCase()))].sort();
  for (const key of keys) await lock(tx, `email:${key}`);
}

/** Serializes first-run setup, so exactly one first admin can ever be created. */
export async function lockFirstRunSetup(tx: Transaction): Promise<void> {
  await lock(tx, 'first-run-setup');
}
