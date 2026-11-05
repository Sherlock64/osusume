import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createMigratedDatabase } from '../test-support/scratch-database.ts';
import type { Database } from './client.ts';
import { emailChangeRequest, session, tag, user, verification } from './schema.ts';

let db: Database;
let pool: Awaited<ReturnType<typeof createMigratedDatabase>>['pool'];
let cleanup: () => Promise<void>;
let counter = 0;

beforeAll(async () => {
  const migrated = await createMigratedDatabase();
  db = migrated.db;
  pool = migrated.pool;
  cleanup = migrated.cleanup;
});

afterAll(async () => {
  await cleanup();
});

async function createUser(overrides: Partial<typeof user.$inferInsert> = {}) {
  counter += 1;
  const [row] = await db
    .insert(user)
    .values({
      name: `schema${String(counter)}`,
      username: `schema${String(counter)}`,
      email: `schema${String(counter)}@example.test`,
      ...overrides,
    })
    .returning();
  if (!row) throw new Error('user was not created');
  return row;
}

describe('is_first_admin', () => {
  it('can be set at creation, once, and then never changed', async () => {
    const first = await createUser({ role: 'admin', isFirstAdmin: true });
    expect(first.isFirstAdmin).toBe(true);

    const cleared = db.update(user).set({ isFirstAdmin: false }).where(eq(user.id, first.id));
    await expect(cleared).rejects.toMatchObject({
      cause: { message: 'is_first_admin cannot be changed after creation' },
    });

    // The validated defect: clearing the flag and then deleting must not get through,
    // even when both statements run in one transaction.
    await expect(
      db.transaction(async (tx) => {
        await tx.update(user).set({ isFirstAdmin: false }).where(eq(user.id, first.id));
        await tx.delete(user).where(eq(user.id, first.id));
      }),
    ).rejects.toBeDefined();
    await expect(db.delete(user).where(eq(user.id, first.id))).rejects.toMatchObject({
      cause: { message: 'The first admin cannot be deleted' },
    });
    const [still] = await db.select().from(user).where(eq(user.id, first.id));
    expect(still?.isFirstAdmin).toBe(true);

    // A raw statement that does not name the column through Drizzle cannot do it either.
    await expect(
      pool.query(`UPDATE "user" SET is_first_admin = false WHERE id = $1`, [first.id]),
    ).rejects.toMatchObject({ code: '23001' });
  });

  it('cannot be granted to an existing account', async () => {
    const member = await createUser();
    await expect(
      db.update(user).set({ isFirstAdmin: true, role: 'admin' }).where(eq(user.id, member.id)),
    ).rejects.toMatchObject({
      cause: { message: 'is_first_admin cannot be changed after creation' },
    });
  });

  it('does not get in the way of other updates', async () => {
    const member = await createUser();
    const [updated] = await db
      .update(user)
      .set({ role: 'admin' })
      .where(eq(user.id, member.id))
      .returning();
    expect(updated?.role).toBe('admin');
  });
});

describe('usernames', () => {
  it('stores a lowercase key and keeps the entered capitalization', async () => {
    const row = await createUser({ username: 'MixedCase' });
    expect(row.username).toBe('mixedcase');
    expect(row.displayUsername).toBe('MixedCase');
  });

  it('refuses a name that differs only by case, on insert and on update', async () => {
    await createUser({ username: 'CaseTaken' });
    await expect(createUser({ username: 'CASETAKEN' })).rejects.toMatchObject({
      cause: { constraint: 'user_username_unique' },
    });
    const other = await createUser({ username: 'CaseOther' });
    await expect(
      db.update(user).set({ username: 'casetaken' }).where(eq(user.id, other.id)),
    ).rejects.toMatchObject({ cause: { constraint: 'user_username_unique' } });
  });

  it('finds a user through the lowercase key', async () => {
    await createUser({ username: 'LookMeUp' });
    const [found] = await db.select().from(user).where(eq(user.username, 'lookmeup'));
    expect(found?.displayUsername).toBe('LookMeUp');
  });

  it('moves the display name along when only the username is written', async () => {
    const row = await createUser({ username: 'Before' });
    const [renamed] = await db
      .update(user)
      .set({ username: 'AfterRename' })
      .where(eq(user.id, row.id))
      .returning();
    expect(renamed).toMatchObject({ username: 'afterrename', displayUsername: 'AfterRename' });
  });

  it('allows a capitalization-only change', async () => {
    const row = await createUser({ username: 'lowercase_only' });
    const [renamed] = await db
      .update(user)
      .set({ username: 'lowercase_only', displayUsername: 'LOWERCASE_only' })
      .where(eq(user.id, row.id))
      .returning();
    expect(renamed).toMatchObject({ username: 'lowercase_only', displayUsername: 'LOWERCASE_only' });
  });

  it('refuses a display name that is not a case variant of the username', async () => {
    await expect(
      createUser({ username: 'one_name', displayUsername: 'another_name' }),
    ).rejects.toMatchObject({ cause: { constraint: 'user_username_case' } });
  });
});

describe('tag names', () => {
  it('are unique ignoring case and keep their capitalization', async () => {
    const [row] = await db.insert(tag).values({ name: 'Slice of Life' }).returning();
    expect(row?.name).toBe('Slice of Life');
    await expect(db.insert(tag).values({ name: 'slice of LIFE' })).rejects.toMatchObject({
      cause: { constraint: 'tag_name_lower_unique' },
    });
  });
});

describe('removing a user', () => {
  const expiresAt = () => new Date(Date.now() + 60_000);

  it('deletes their verification rows and leaves everyone else alone', async () => {
    const removed = await createUser();
    const other = await createUser();
    await db.insert(verification).values([
      { identifier: 'reset-password:gone', value: removed.id, expiresAt: expiresAt() },
      { identifier: 'reset-password:kept', value: other.id, expiresAt: expiresAt() },
    ]);

    await db.delete(user).where(eq(user.id, removed.id));

    const left = await db.select({ value: verification.value }).from(verification);
    expect(left.map((row) => row.value)).not.toContain(removed.id);
    expect(left.map((row) => row.value)).toContain(other.id);
  });

  it('deletes their pending email change, and the address with it', async () => {
    const removed = await createUser();
    await db.insert(emailChangeRequest).values({
      userId: removed.id,
      newEmail: 'pending-change@example.test',
      tokenHash: `hash-${removed.id}`,
      expiresAt: expiresAt(),
    });
    await db.delete(user).where(eq(user.id, removed.id));
    expect(
      await db.select().from(emailChangeRequest).where(eq(emailChangeRequest.userId, removed.id)),
    ).toEqual([]);
  });
});

describe('sessions', () => {
  const values = (userId: string) => ({
    userId,
    token: `session-${String((counter += 1))}`,
    expiresAt: new Date(Date.now() + 60_000),
  });

  it('cannot be created for a disabled user', async () => {
    const disabled = await createUser({ disabledAt: new Date() });
    await expect(db.insert(session).values(values(disabled.id))).rejects.toMatchObject({
      cause: { message: 'A session needs an active user' },
    });
  });

  it('wait for a disable in progress, then are refused', async () => {
    const target = await createUser();
    const disabling = await pool.connect();
    try {
      await disabling.query('BEGIN');
      await disabling.query(`UPDATE "user" SET disabled_at = now() WHERE id = $1`, [target.id]);

      const insert = db.insert(session).values(values(target.id)).then(
        () => 'created',
        () => 'refused',
      );
      await new Promise((resolve) => setTimeout(resolve, 100));
      await disabling.query('COMMIT');

      expect(await insert).toBe('refused');
    } finally {
      disabling.release();
    }
  });

  it('hold up a disable until they commit, so its delete catches them', async () => {
    const target = await createUser();
    const creating = await pool.connect();
    try {
      const row = values(target.id);
      await creating.query('BEGIN');
      await creating.query(
        `INSERT INTO session (user_id, token, expires_at) VALUES ($1, $2, $3)`,
        [row.userId, row.token, row.expiresAt],
      );

      const disable = db.transaction(async (tx) => {
        await tx.update(user).set({ disabledAt: new Date() }).where(eq(user.id, target.id));
        await tx.delete(session).where(eq(session.userId, target.id));
      });
      await new Promise((resolve) => setTimeout(resolve, 100));
      await creating.query('COMMIT');
      await disable;

      expect(await db.select().from(session).where(eq(session.userId, target.id))).toEqual([]);
    } finally {
      creating.release();
    }
  });
});
