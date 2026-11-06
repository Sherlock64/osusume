import { type ListQuery, type ListStatus, type VisibilityTier, usernameKey } from '@osusume/shared';
import { and, asc, count, eq, exists, inArray, or, sql } from 'drizzle-orm';
import { displayName } from '../auth/accounts.ts';
import type { Database } from '../db/client.ts';
import { friendship, listEntry, listSettings, season, series, user } from '../db/schema.ts';
import { ApiError } from '../lib/errors.ts';
import { type Cursor, keyset, toPage } from '../lib/pagination.ts';

/** Who is asking: nobody, or a member with those of the owners in question who are friends. */
export type Viewer = { id: string; friendIds: ReadonlySet<string> } | null;

export interface ListRef {
  ownerId: string;
  ownerDisabled: boolean;
  /** No settings row means nothing was ever chosen, which is the default, private. */
  visibility: VisibilityTier;
}

/**
 * The one check on whether a list can be seen, behind the member view, the public view and
 * compare. Roles play no part: an admin sees what any other member would.
 */
export function canView(viewer: Viewer, list: ListRef): boolean {
  if (list.ownerDisabled) return false;
  if (viewer?.id === list.ownerId) return true;
  switch (list.visibility) {
    case 'public':
      return true;
    case 'members':
      return viewer !== null;
    case 'friends':
      return viewer?.friendIds.has(list.ownerId) === true;
    case 'private':
      return false;
  }
}

/** A logged-in viewer, knowing which of these owners they are accepted friends with. */
export async function loadViewer(
  db: Database,
  viewerId: string,
  ownerIds: readonly string[],
): Promise<NonNullable<Viewer>> {
  const rows = await db
    .select({ requesterId: friendship.requesterId, addresseeId: friendship.addresseeId })
    .from(friendship)
    .where(
      and(
        eq(friendship.status, 'accepted'),
        or(
          and(eq(friendship.requesterId, viewerId), inArray(friendship.addresseeId, [...ownerIds])),
          and(eq(friendship.addresseeId, viewerId), inArray(friendship.requesterId, [...ownerIds])),
        ),
      ),
    );
  const friendIds = new Set(
    rows.map((row) => (row.requesterId === viewerId ? row.addresseeId : row.requesterId)),
  );
  return { id: viewerId, friendIds };
}

const listRefColumns = {
  ownerId: user.id,
  disabledAt: user.disabledAt,
  visibility: listSettings.visibility,
} as const;

function toListRef(row: {
  ownerId: string;
  disabledAt: Date | null;
  visibility: VisibilityTier | null;
}): ListRef {
  return {
    ownerId: row.ownerId,
    ownerDisabled: row.disabledAt !== null,
    visibility: row.visibility ?? 'private',
  };
}

/** The lists of these usernames, keyed by `usernameKey`. A missing user has no entry. */
export async function loadListRefs(db: Database, usernames: readonly string[]) {
  const rows = await db
    .select({
      ...listRefColumns,
      username: user.username,
      displayUsername: user.displayUsername,
    })
    .from(user)
    .leftJoin(listSettings, eq(listSettings.userId, user.id))
    .where(inArray(user.username, usernames.map(usernameKey)));
  return new Map(
    rows.map((row) => [row.username, { ...toListRef(row), displayName: displayName(row) }]),
  );
}

/** The list behind a public slug, if there is one. */
export async function loadListRefBySlug(db: Database, slug: string): Promise<ListRef | undefined> {
  const [row] = await db
    .select(listRefColumns)
    .from(listSettings)
    .innerJoin(user, eq(listSettings.userId, user.id))
    .where(eq(listSettings.publicSlug, slug));
  return row && toListRef(row);
}

/** The one answer for a list that is missing, hidden or belongs to a disabled user. */
export const listNotFound = () => new ApiError(404, 'list_not_found', 'No such list.');

const STATUS_NAMES: Record<ListStatus, string> = {
  plan_to_watch: 'Plan to watch',
  watching: 'Watching',
  completed: 'Completed',
  on_hold: 'On hold',
  dropped: 'Dropped',
};

// Which status speaks for a series with several: what is in progress, then what is done.
const STATUS_PRECEDENCE: readonly ListStatus[] = [
  'watching',
  'completed',
  'on_hold',
  'plan_to_watch',
  'dropped',
];

/** A series' status from the statuses of its seasons on a list, for example "Completed 2/3 seasons". */
export function deriveSeriesStatus(statuses: readonly ListStatus[], totalSeasons: number) {
  const status = STATUS_PRECEDENCE.find((candidate) => statuses.includes(candidate));
  if (status === undefined) throw new Error('a series on a list has at least one season on it');
  const matching = statuses.filter((candidate) => candidate === status).length;
  const unit = totalSeasons === 1 ? 'season' : 'seasons';
  return {
    status,
    count: matching,
    totalSeasons,
    label: `${STATUS_NAMES[status]} ${String(matching)}/${String(totalSeasons)} ${unit}`,
  };
}

/**
 * A page of a user's list, one item per series, by title. A series is in the page if any of its
 * seasons on the list has the status asked for. Each item still holds all its seasons on the
 * list and its status comes from all of them, with `matched` marking the ones that matched.
 */
export async function loadListPage(
  db: Database,
  ownerId: string,
  query: Omit<ListQuery, 'cursor'> & { cursor: Cursor<string> | undefined },
) {
  const { limit, status } = query;
  const page = keyset({ sortColumn: series.title, idColumn: series.id, cursor: query.cursor });
  const seriesRows = await db
    .select({ id: series.id, title: series.title })
    .from(series)
    .where(
      and(
        exists(
          db
            .select({ one: sql`1` })
            .from(listEntry)
            .innerJoin(season, eq(listEntry.seasonId, season.id))
            .where(
              and(
                eq(listEntry.userId, ownerId),
                eq(season.seriesId, series.id),
                status === undefined ? undefined : eq(listEntry.status, status),
              ),
            ),
        ),
        page.where,
      ),
    )
    .orderBy(...page.orderBy)
    .limit(limit + 1);
  const { items, nextCursor } = toPage(seriesRows, limit, (row) => ({
    sort: row.title,
    id: row.id,
  }));
  if (items.length === 0) return { items: [], nextCursor };

  const seriesIds = items.map((row) => row.id);
  const [entries, totals] = await Promise.all([
    db
      .select({ entry: listEntry, season })
      .from(listEntry)
      .innerJoin(season, eq(listEntry.seasonId, season.id))
      .where(and(eq(listEntry.userId, ownerId), inArray(season.seriesId, seriesIds)))
      .orderBy(asc(season.ordinal)),
    db
      .select({ seriesId: season.seriesId, total: count() })
      .from(season)
      .where(inArray(season.seriesId, seriesIds))
      .groupBy(season.seriesId),
  ]);
  const totalOf = new Map(totals.map((row) => [row.seriesId, row.total]));

  return {
    items: items.map((row) => {
      const seasons = entries
        .filter((entry) => entry.season.seriesId === row.id)
        .map((entry) => ({
          ...entry,
          matched: status !== undefined && entry.entry.status === status,
        }));
      return {
        seriesId: row.id,
        title: row.title,
        seriesStatus: deriveSeriesStatus(
          seasons.map((entry) => entry.entry.status),
          totalOf.get(row.id) ?? seasons.length,
        ),
        seasons,
      };
    }),
    nextCursor,
  };
}
