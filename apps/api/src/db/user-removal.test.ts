import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createMigratedDatabase } from '../test-support/scratch-database.ts';
import type { Database } from './client.ts';
import {
  account,
  catalogRequest,
  emailBlacklist,
  friendship,
  image,
  inviteRequest,
  listEntry,
  listSettings,
  season,
  series,
  session,
  user,
  usernameChangeRequest,
} from './schema.ts';

let counter = 0;

describe('removing a user', () => {
  let db: Database;
  let cleanup: () => Promise<void>;

  beforeAll(async () => {
    const migrated = await createMigratedDatabase();
    db = migrated.db;
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
        name: `user${String(counter)}`,
        username: `user${String(counter)}`,
        email: `user${String(counter)}@example.test`,
        ...overrides,
      })
      .returning();
    if (!row) throw new Error('user was not created');
    return row;
  }

  async function createSeason() {
    const [parent] = await db.insert(series).values({ title: 'A series' }).returning();
    if (!parent) throw new Error('series was not created');
    const [row] = await db
      .insert(season)
      .values({
        seriesId: parent.id,
        ordinal: 1,
        title: 'Season one',
        year: 2004,
        seasonOfYear: 'fall',
      })
      .returning();
    if (!row) throw new Error('season was not created');
    return row;
  }

  it('deletes the list, settings, sessions, credentials, friendships and username requests', async () => {
    const removed = await createUser();
    const friend = await createUser();
    const stranger = await createUser();
    const watched = await createSeason();

    await db.insert(listEntry).values({ userId: removed.id, seasonId: watched.id, status: 'completed' });
    await db.insert(listSettings).values({ userId: removed.id });
    await db.insert(session).values({
      userId: removed.id,
      token: `token-${removed.id}`,
      expiresAt: new Date(Date.now() + 60_000),
    });
    await db.insert(account).values({ userId: removed.id, accountId: removed.id, providerId: 'credential' });
    await db.insert(friendship).values([
      { requesterId: removed.id, addresseeId: friend.id, status: 'accepted' },
      { requesterId: stranger.id, addresseeId: removed.id },
    ]);
    await db.insert(usernameChangeRequest).values({ userId: removed.id, requestedUsername: 'renamed' });

    await db.delete(user).where(eq(user.id, removed.id));

    expect(await db.select().from(listEntry).where(eq(listEntry.userId, removed.id))).toEqual([]);
    expect(await db.select().from(listSettings).where(eq(listSettings.userId, removed.id))).toEqual([]);
    expect(await db.select().from(session).where(eq(session.userId, removed.id))).toEqual([]);
    expect(await db.select().from(account).where(eq(account.userId, removed.id))).toEqual([]);
    expect(await db.select().from(friendship).where(eq(friendship.requesterId, removed.id))).toEqual([]);
    expect(await db.select().from(friendship).where(eq(friendship.addresseeId, removed.id))).toEqual([]);
    expect(
      await db.select().from(usernameChangeRequest).where(eq(usernameChangeRequest.userId, removed.id)),
    ).toEqual([]);
    expect(await db.select().from(season).where(eq(season.id, watched.id))).toHaveLength(1);
  });

  it('deletes pending requests and keeps decided ones with the identity blanked', async () => {
    const removed = await createUser();
    const payload = { title: 'A proposal' };

    const catalog = await db
      .insert(catalogRequest)
      .values([
        { requesterId: removed.id, kind: 'new_series', payload, status: 'pending' },
        { requesterId: removed.id, kind: 'new_series', payload, status: 'approved' },
        { requesterId: removed.id, kind: 'new_series', payload, status: 'rejected' },
      ])
      .returning();
    const invites = await db
      .insert(inviteRequest)
      .values([
        { requesterId: removed.id, inviteeEmail: 'a@example.test', status: 'pending' },
        { requesterId: removed.id, inviteeEmail: 'b@example.test', status: 'accepted' },
      ])
      .returning();

    await db.delete(user).where(eq(user.id, removed.id));

    const keptCatalog = await db.select().from(catalogRequest);
    const catalogIds = catalog.map((row) => row.id);
    const remaining = keptCatalog.filter((row) => catalogIds.includes(row.id));
    expect(remaining.map((row) => row.status).sort()).toEqual(['approved', 'rejected']);
    expect(remaining.every((row) => row.requesterId === null)).toBe(true);

    const keptInvites = await db.select().from(inviteRequest);
    const inviteIds = invites.map((row) => row.id);
    const remainingInvites = keptInvites.filter((row) => inviteIds.includes(row.id));
    expect(remainingInvites.map((row) => row.status)).toEqual(['accepted']);
    expect(remainingInvites[0]?.requesterId).toBeNull();
  });

  it('keeps catalog content and blanks who uploaded or decided it', async () => {
    const admin = await createUser({ role: 'admin' });
    const requester = await createUser();

    const [cover] = await db
      .insert(image)
      .values({
        storageKey: `covers/${admin.id}`,
        mime: 'image/webp',
        width: 1,
        height: 1,
        uploadedBy: admin.id,
      })
      .returning();
    if (!cover) throw new Error('image was not created');
    const [entry] = await db
      .insert(series)
      .values({ title: 'Kept', coverImageId: cover.id })
      .returning();
    if (!entry) throw new Error('series was not created');
    const [request] = await db
      .insert(catalogRequest)
      .values({
        requesterId: requester.id,
        kind: 'new_series',
        payload: { title: 'Kept' },
        status: 'approved',
        reviewedBy: admin.id,
      })
      .returning();
    if (!request) throw new Error('request was not created');
    const [invite] = await db
      .insert(inviteRequest)
      .values({
        requesterId: requester.id,
        inviteeEmail: 'c@example.test',
        status: 'rejected',
        decidedBy: admin.id,
      })
      .returning();
    if (!invite) throw new Error('invite was not created');
    const [usernameRequest] = await db
      .insert(usernameChangeRequest)
      .values({
        userId: requester.id,
        requestedUsername: 'new-name',
        status: 'approved',
        decidedBy: admin.id,
      })
      .returning();
    if (!usernameRequest) throw new Error('username request was not created');
    await db.insert(emailBlacklist).values({ email: 'banned@example.test', bannedBy: admin.id });

    await db.delete(user).where(eq(user.id, admin.id));

    const [keptImage] = await db.select().from(image).where(eq(image.id, cover.id));
    expect(keptImage?.uploadedBy).toBeNull();
    const [keptSeries] = await db.select().from(series).where(eq(series.id, entry.id));
    expect(keptSeries?.coverImageId).toBe(cover.id);
    const [keptRequest] = await db.select().from(catalogRequest).where(eq(catalogRequest.id, request.id));
    expect(keptRequest?.reviewedBy).toBeNull();
    expect(keptRequest?.requesterId).toBe(requester.id);
    const [keptInvite] = await db.select().from(inviteRequest).where(eq(inviteRequest.id, invite.id));
    expect(keptInvite?.decidedBy).toBeNull();
    const [keptUsernameRequest] = await db
      .select()
      .from(usernameChangeRequest)
      .where(eq(usernameChangeRequest.id, usernameRequest.id));
    expect(keptUsernameRequest?.decidedBy).toBeNull();
    const [blacklisted] = await db
      .select()
      .from(emailBlacklist)
      .where(eq(emailBlacklist.email, 'banned@example.test'));
    expect(blacklisted?.bannedBy).toBeNull();
  });

  it('frees the email and username for a new account', async () => {
    const removed = await createUser({ username: 'reused', email: 'reused@example.test' });
    await db.delete(user).where(eq(user.id, removed.id));
    await expect(
      createUser({ username: 'reused', email: 'reused@example.test' }),
    ).resolves.toMatchObject({ username: 'reused' });
  });
});

describe('the first admin', () => {
  let db: Database;
  let cleanup: () => Promise<void>;
  let firstAdminId: string;

  beforeAll(async () => {
    const migrated = await createMigratedDatabase();
    db = migrated.db;
    cleanup = migrated.cleanup;
    const [row] = await db
      .insert(user)
      .values({
        name: 'first',
        username: 'first',
        email: 'first@example.test',
        role: 'admin',
        isFirstAdmin: true,
      })
      .returning();
    if (!row) throw new Error('first admin was not created');
    firstAdminId = row.id;
  });

  afterAll(async () => {
    await cleanup();
  });

  it('cannot be deleted', async () => {
    await expect(db.delete(user).where(eq(user.id, firstAdminId))).rejects.toMatchObject({
      cause: { message: 'The first admin cannot be deleted' },
    });
  });

  it('cannot be demoted', async () => {
    await expect(
      db.update(user).set({ role: 'member' }).where(eq(user.id, firstAdminId)),
    ).rejects.toMatchObject({ cause: { constraint: 'user_first_admin_stays_active_admin' } });
  });

  it('cannot be disabled', async () => {
    await expect(
      db.update(user).set({ disabledAt: new Date() }).where(eq(user.id, firstAdminId)),
    ).rejects.toMatchObject({ cause: { constraint: 'user_first_admin_stays_active_admin' } });
  });

  it('is the only one', async () => {
    await expect(
      db.insert(user).values({
        name: 'second',
        username: 'second',
        email: 'second@example.test',
        role: 'admin',
        isFirstAdmin: true,
      }),
    ).rejects.toMatchObject({ cause: { constraint: 'user_single_first_admin' } });
  });
});

describe('schema constraints', () => {
  let db: Database;
  let cleanup: () => Promise<void>;

  beforeAll(async () => {
    const migrated = await createMigratedDatabase();
    db = migrated.db;
    cleanup = migrated.cleanup;
  });

  afterAll(async () => {
    await cleanup();
  });

  async function twoUsers() {
    const rows = await db
      .insert(user)
      .values(
        [1, 2].map((n) => {
          counter += 1;
          return {
            name: `c${String(counter)}`,
            username: `c${String(counter)}`,
            email: `c${String(counter)}-${String(n)}@example.test`,
          };
        }),
      )
      .returning();
    const [a, b] = rows;
    if (!a || !b) throw new Error('users were not created');
    return [a, b] as const;
  }

  it('treats a friendship pair as the same in either direction', async () => {
    const [a, b] = await twoUsers();
    await db.insert(friendship).values({ requesterId: a.id, addresseeId: b.id });
    await expect(
      db.insert(friendship).values({ requesterId: b.id, addresseeId: a.id }),
    ).rejects.toMatchObject({ cause: { constraint: 'friendship_pair_unique' } });
  });

  it('rejects a friendship with oneself', async () => {
    const [a] = await twoUsers();
    await expect(
      db.insert(friendship).values({ requesterId: a.id, addresseeId: a.id }),
    ).rejects.toMatchObject({ cause: { constraint: 'friendship_not_self' } });
  });

  it('allows a public slug only while the list is public', async () => {
    const [a, b] = await twoUsers();
    await expect(
      db.insert(listSettings).values({ userId: a.id, visibility: 'friends', publicSlug: 'abc' }),
    ).rejects.toMatchObject({ cause: { constraint: 'list_settings_slug_only_while_public' } });
    await expect(
      db.insert(listSettings).values({ userId: a.id, visibility: 'public' }),
    ).rejects.toMatchObject({ cause: { constraint: 'list_settings_slug_only_while_public' } });
    await db.insert(listSettings).values({ userId: a.id, visibility: 'public', publicSlug: 'abc' });
    const [defaults] = await db.insert(listSettings).values({ userId: b.id }).returning();
    expect(defaults).toMatchObject({ visibility: 'private', publicSlug: null });
  });

  it('allows one list entry per user per season', async () => {
    const [a] = await twoUsers();
    const [parent] = await db.insert(series).values({ title: 'Parent' }).returning();
    if (!parent) throw new Error('series was not created');
    const [child] = await db
      .insert(season)
      .values({ seriesId: parent.id, ordinal: 1, title: 'One', year: 2020, seasonOfYear: 'spring' })
      .returning();
    if (!child) throw new Error('season was not created');
    expect(child.episodeCount).toBeNull();
    await db.insert(listEntry).values({ userId: a.id, seasonId: child.id, status: 'watching' });
    await expect(
      db.insert(listEntry).values({ userId: a.id, seasonId: child.id, status: 'dropped' }),
    ).rejects.toMatchObject({ cause: { constraint: 'list_entry_user_id_season_id_unique' } });
  });

  it('matches blacklisted and account emails case-insensitively', async () => {
    await db.insert(emailBlacklist).values({ email: 'Someone@example.test' });
    await expect(
      db.insert(emailBlacklist).values({ email: 'someone@EXAMPLE.test' }),
    ).rejects.toMatchObject({ cause: { constraint: 'email_blacklist_email_unique' } });

    const [a] = await twoUsers();
    await expect(
      db.insert(user).values({ name: 'x', username: 'x', email: a.email.toUpperCase() }),
    ).rejects.toMatchObject({ cause: { constraint: 'user_email_unique' } });
  });
});
