import {
  catalogRequestKinds,
  catalogRequestStatuses,
  friendshipStatuses,
  inviteRequestStatuses,
  listStatuses,
  seasonsOfYear,
  userRoles,
  usernameChangeRequestStatuses,
  visibilityTiers,
} from '@osusume/shared';
import { type AnyColumn, type SQL, sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/*
 * What removing a user does (V1_DECISIONS.md: removed, banned, delete own account).
 * All of these happen on `DELETE FROM "user"`, so no code path can forget a step.
 *
 *   CASCADE    session, account, list_entry, list_settings, friendship (either
 *              side), username_change_request and email_change_request: this is
 *              the user's own data.
 *   SET NULL   who-did-it columns: image.uploaded_by, catalog_request.requester_id
 *              and reviewed_by, invite_request.requester_id and decided_by,
 *              username_change_request.decided_by and email_blacklist.banned_by.
 *              The record stays with the identity blanked.
 *   TRIGGER    user_before_delete (migration 0005), for what depends on row contents:
 *              - deletes the user's pending catalog and invite requests;
 *              - revokes invites they requested that are approved but unaccepted;
 *              - deletes invite rows holding the user's own email;
 *              - deletes Better Auth verification rows (password reset tokens), which
 *                have no foreign key and hold the user id in `value`;
 *              - refuses to delete the first admin.
 *
 * Banning is a removal plus an email_blacklist row, which keeps the address. After
 * a plain removal the address can be invited again.
 */

export const userRole = pgEnum('user_role', userRoles);
export const listStatus = pgEnum('list_status', listStatuses);
export const visibilityTier = pgEnum('visibility_tier', visibilityTiers);
export const inviteRequestStatus = pgEnum('invite_request_status', inviteRequestStatuses);
export const catalogRequestStatus = pgEnum('catalog_request_status', catalogRequestStatuses);
export const catalogRequestKind = pgEnum('catalog_request_kind', catalogRequestKinds);
export const usernameChangeRequestStatus = pgEnum(
  'username_change_request_status',
  usernameChangeRequestStatuses,
);
export const friendshipStatus = pgEnum('friendship_status', friendshipStatuses);
export const seasonOfYear = pgEnum('season_of_year', seasonsOfYear);

// Millisecond precision so a value survives a round trip through a JS Date,
// which keyset pagination cursors depend on.
const timestampMs = () => timestamp({ withTimezone: true, precision: 3 });

const createdAt = () => timestampMs().notNull().defaultNow();
const updatedAt = () =>
  timestampMs()
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

const primaryId = () => uuid().primaryKey().defaultRandom();

/*
 * Better Auth tables. Property names follow Better Auth's field names, so its
 * Drizzle adapter maps onto them directly; `displayUsername` belongs to its
 * username plugin. Ids are UUIDs: configure Better Auth with
 * `advanced.database.generateId: "uuid"`.
 */
export const user = pgTable(
  'user',
  {
    id: primaryId(),
    name: text().notNull(),
    email: text().notNull(),
    emailVerified: boolean().notNull().default(false),
    image: text(),
    /**
     * The lowercase lookup key, so this column's unique constraint ignores case. Better
     * Auth signs in by lowercasing the entered name and comparing it to this column.
     * Trigger user_normalize_username (migration 0005) lowercases every write.
     */
    username: text().notNull().unique(),
    /** The capitalization the user entered, for display. Always a case variant of username. */
    displayUsername: text(),
    role: userRole().notNull().default('member'),
    /**
     * The permanent first admin. See the constraints below, user_before_delete and
     * user_first_admin_immutable, which stops this being changed after creation.
     */
    isFirstAdmin: boolean().notNull().default(false),
    /** Set while the account is disabled; null when active. Reversible. */
    disabledAt: timestampMs(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('user_email_unique').on(sql`lower(${t.email})`),
    uniqueIndex('user_single_first_admin').on(t.isFirstAdmin).where(sql`${t.isFirstAdmin}`),
    check(
      'user_first_admin_stays_active_admin',
      sql`NOT ${t.isFirstAdmin} OR (${t.role} = 'admin' AND ${t.disabledAt} IS NULL)`,
    ),
    check(
      'user_username_case',
      sql`${t.username} = lower(${t.username}) AND (${t.displayUsername} IS NULL OR lower(${t.displayUsername}) = ${t.username})`,
    ),
  ],
);

export const session = pgTable(
  'session',
  {
    id: primaryId(),
    expiresAt: timestampMs().notNull(),
    token: text().notNull().unique(),
    ipAddress: text(),
    userAgent: text(),
    userId: uuid()
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('session_user_id_idx').on(t.userId)],
);

export const account = pgTable(
  'account',
  {
    id: primaryId(),
    accountId: text().notNull(),
    providerId: text().notNull(),
    userId: uuid()
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    accessToken: text(),
    refreshToken: text(),
    idToken: text(),
    accessTokenExpiresAt: timestampMs(),
    refreshTokenExpiresAt: timestampMs(),
    scope: text(),
    password: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('account_user_id_idx').on(t.userId)],
);

export const verification = pgTable(
  'verification',
  {
    id: primaryId(),
    identifier: text().notNull(),
    value: text().notNull(),
    expiresAt: timestampMs().notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('verification_identifier_idx').on(t.identifier)],
);

/* Accounts and invites */

export const usernameChangeRequest = pgTable(
  'username_change_request',
  {
    id: primaryId(),
    userId: uuid()
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    requestedUsername: text().notNull(),
    status: usernameChangeRequestStatus().notNull().default('pending'),
    decidedBy: uuid().references(() => user.id, { onDelete: 'set null' }),
    decidedAt: timestampMs(),
    createdAt: createdAt(),
  },
  (t) => [
    index('username_change_request_user_id_idx').on(t.userId),
    uniqueIndex('username_change_request_one_pending_per_user')
      .on(t.userId)
      .where(sql`${t.status} = 'pending'`),
    index('username_change_request_status_idx').on(t.status, t.createdAt),
  ],
);

export const inviteRequest = pgTable(
  'invite_request',
  {
    id: primaryId(),
    /** Null once the requester has been removed. */
    requesterId: uuid().references(() => user.id, { onDelete: 'set null' }),
    inviteeEmail: text().notNull(),
    status: inviteRequestStatus().notNull().default('pending'),
    /** Set on approval. The raw token is only ever in the emailed link. */
    tokenHash: text().unique(),
    expiresAt: timestampMs(),
    decidedBy: uuid().references(() => user.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('invite_request_requester_id_idx').on(t.requesterId),
    index('invite_request_status_idx').on(t.status, t.createdAt),
    index('invite_request_invitee_email_idx').on(sql`lower(${t.inviteeEmail})`),
    // Part of the one-open-invite rule. Approved invites also count as open until
    // they expire, which depends on the clock, so the application enforces that part.
    uniqueIndex('invite_request_one_pending_per_email')
      .on(sql`lower(${t.inviteeEmail})`)
      .where(sql`${t.status} = 'pending'`),
  ],
);

/**
 * A change of email waiting for its link to be clicked; the user's email is untouched
 * until then. One per user: asking again replaces the earlier request and its link.
 */
export const emailChangeRequest = pgTable('email_change_request', {
  id: primaryId(),
  userId: uuid()
    .notNull()
    .unique()
    .references(() => user.id, { onDelete: 'cascade' }),
  newEmail: text().notNull(),
  /** The raw token is only ever in the emailed link. */
  tokenHash: text().notNull().unique(),
  expiresAt: timestampMs().notNull(),
  createdAt: createdAt(),
});

/** Emails that cannot be invited again. Lookups compare on lower(email). */
export const emailBlacklist = pgTable(
  'email_blacklist',
  {
    id: primaryId(),
    email: text().notNull(),
    /** Null once the admin who banned has been removed. */
    bannedBy: uuid().references(() => user.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('email_blacklist_email_unique').on(sql`lower(${t.email})`)],
);

export const friendship = pgTable(
  'friendship',
  {
    id: primaryId(),
    requesterId: uuid()
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    addresseeId: uuid()
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    status: friendshipStatus().notNull().default('pending'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // Friendship is mutual, so (a, b) and (b, a) are the same pair.
    uniqueIndex('friendship_pair_unique').on(
      sql`least(${t.requesterId}, ${t.addresseeId})`,
      sql`greatest(${t.requesterId}, ${t.addresseeId})`,
    ),
    index('friendship_addressee_id_idx').on(t.addresseeId),
    index('friendship_requester_id_idx').on(t.requesterId),
    check('friendship_not_self', sql`${t.requesterId} <> ${t.addresseeId}`),
  ],
);

/* Catalog */

/**
 * An uploaded image. It joins one series' image catalog, and then cannot leave it except by being
 * removed, which deletes it. Its rows go with the series; its files are removed by the api after
 * the transaction commits, so a rollback never loses them.
 */
export const image = pgTable(
  'image',
  {
    id: primaryId(),
    storageKey: text().notNull().unique(),
    mime: text().notNull(),
    width: integer().notNull(),
    height: integer().notNull(),
    uploadedBy: uuid().references(() => user.id, { onDelete: 'set null' }),
    /** The catalog this image is in. Every image is in one, from the moment it is uploaded. */
    seriesId: uuid()
      .notNull()
      .references(() => series.id, { onDelete: 'cascade' }),
    /** The series' cover, and the default for its seasons. */
    isPrimary: boolean().notNull().default(false),
    /** When it joined the catalog: the earliest remaining takes over from a removed primary. */
    addedAt: timestampMs().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('image_one_primary_per_series').on(t.seriesId).where(sql`${t.isPrimary}`),
    index('image_series_id_added_at_idx').on(t.seriesId, t.addedAt),
  ],
);

/**
 * The text that search indexes cover: a row's title and alternate titles. The
 * function is created in migration 0000. Search queries must use these exact
 * expressions for Postgres to use the indexes below:
 *
 *   titleSearchText(series.title, series.altTitles)  with pg_trgm operators
 *   titleSearchVector(series.title, series.altTitles)  with `@@`
 *
 * Full-text uses the `simple` configuration: titles are mixed-language, often
 * romanized Japanese, so English stemming and stop words would do harm.
 */
export function titleSearchText(title: AnyColumn, altTitles: AnyColumn): SQL<string> {
  return sql`osusume_title_search_text(${title}, ${altTitles})`;
}

export function titleSearchVector(title: AnyColumn, altTitles: AnyColumn): SQL {
  return sql`to_tsvector('simple'::regconfig, osusume_title_search_text(${title}, ${altTitles}))`;
}

export const series = pgTable(
  'series',
  {
    id: primaryId(),
    title: text().notNull(),
    altTitles: text().array().notNull().default(sql`'{}'::text[]`),
    synopsis: text(),
    source: text(),
    sourceId: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('series_title_trgm_idx').using(
      'gin',
      sql`osusume_title_search_text(${t.title}, ${t.altTitles}) gin_trgm_ops`,
    ),
    index('series_title_fts_idx').using('gin', titleSearchVector(t.title, t.altTitles)),
  ],
);

export const season = pgTable(
  'season',
  {
    id: primaryId(),
    // A series that still has seasons cannot be deleted.
    seriesId: uuid()
      .notNull()
      .references(() => series.id, { onDelete: 'restrict' }),
    ordinal: integer().notNull(),
    title: text().notNull(),
    altTitles: text().array().notNull().default(sql`'{}'::text[]`),
    /** Optional, as is seasonOfYear. Sorting and display must handle blanks. */
    year: integer(),
    seasonOfYear: seasonOfYear(),
    /** Null while airing or unknown. */
    episodeCount: integer(),
    synopsis: text(),
    /**
     * An image from this series' catalog chosen for this season; null uses the series primary.
     * The api enforces the same-series rule. Removing the image falls back to the primary.
     */
    coverImageId: uuid().references(() => image.id, { onDelete: 'set null' }),
    source: text(),
    sourceId: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('season_series_id_ordinal_unique').on(t.seriesId, t.ordinal),
    index('season_title_trgm_idx').using(
      'gin',
      sql`osusume_title_search_text(${t.title}, ${t.altTitles}) gin_trgm_ops`,
    ),
    index('season_title_fts_idx').using('gin', titleSearchVector(t.title, t.altTitles)),
    check('season_episode_count_not_negative', sql`${t.episodeCount} >= 0`),
  ],
);

export const tag = pgTable(
  'tag',
  {
    id: primaryId(),
    /** Unique ignoring case; the entered capitalization is kept. */
    name: text().notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('tag_name_lower_unique').on(sql`lower(${t.name})`)],
);

export const seriesTag = pgTable(
  'series_tag',
  {
    seriesId: uuid()
      .notNull()
      .references(() => series.id, { onDelete: 'cascade' }),
    tagId: uuid()
      .notNull()
      .references(() => tag.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.seriesId, t.tagId] }), index('series_tag_tag_id_idx').on(t.tagId)],
);

export const seasonTag = pgTable(
  'season_tag',
  {
    seasonId: uuid()
      .notNull()
      .references(() => season.id, { onDelete: 'cascade' }),
    tagId: uuid()
      .notNull()
      .references(() => tag.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.seasonId, t.tagId] }), index('season_tag_tag_id_idx').on(t.tagId)],
);

export const catalogRequest = pgTable(
  'catalog_request',
  {
    id: primaryId(),
    /** Null once the requester has been removed. */
    requesterId: uuid().references(() => user.id, { onDelete: 'set null' }),
    kind: catalogRequestKind().notNull(),
    /** The series an add_season request targets, or the one a new_series approval created. */
    seriesId: uuid().references(() => series.id, { onDelete: 'set null' }),
    /** The full proposed entry. Holds catalog data only, never user identity. */
    payload: jsonb().notNull(),
    status: catalogRequestStatus().notNull().default('pending'),
    reviewedBy: uuid().references(() => user.id, { onDelete: 'set null' }),
    decisionNote: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('catalog_request_requester_id_idx').on(t.requesterId),
    index('catalog_request_status_idx').on(t.status, t.createdAt),
  ],
);

/* Watch lists */

export const listEntry = pgTable(
  'list_entry',
  {
    id: primaryId(),
    userId: uuid()
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    // A season on anyone's list cannot be deleted.
    seasonId: uuid()
      .notNull()
      .references(() => season.id, { onDelete: 'restrict' }),
    status: listStatus().notNull(),
    /** Owner-only at every visibility tier. */
    note: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('list_entry_user_id_season_id_unique').on(t.userId, t.seasonId),
    index('list_entry_season_id_idx').on(t.seasonId),
  ],
);

export const listSettings = pgTable(
  'list_settings',
  {
    userId: uuid()
      .primaryKey()
      .references(() => user.id, { onDelete: 'cascade' }),
    visibility: visibilityTier().notNull().default('private'),
    publicSlug: text().unique(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // A public list always has a slug, and the slug exists only while public.
    check(
      'list_settings_slug_only_while_public',
      sql`(${t.visibility} = 'public') = (${t.publicSlug} IS NOT NULL)`,
    ),
  ],
);
