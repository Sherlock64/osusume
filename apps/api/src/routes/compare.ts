import {
  type CompareRow,
  compareQuerySchema,
  parseCompareUsernames,
  usernameKey,
} from '@osusume/shared';
import { asc, eq, inArray } from 'drizzle-orm';
import { listEntry, season, series } from '../db/schema.ts';
import { createRouter, valid } from '../lib/router.ts';
import { requireSession } from '../middleware/auth.ts';
import { canView, loadListRefs, loadViewer } from '../social/lists.ts';

// Compare the lists of exactly the usernames given, comma separated
export const compareRoutes = createRouter().get('/compare', requireSession, valid('query', compareQuerySchema), async (c) => {
  const { db } = c.var.deps;
  const usernames = parseCompareUsernames(c.req.valid('query').users);
  const lists = await loadListRefs(db, usernames);
  const viewer = await loadViewer(
    db,
    c.var.currentUser.id,
    [...lists.values()].map((list) => list.ownerId),
  );

  const asked = usernames.map((typed) => {
    const list = lists.get(usernameKey(typed));
    return { typed, list: list && canView(viewer, list) ? list : undefined };
  });
  const users = asked.map(({ typed, list }) =>
    list ? { username: list.displayName, available: true } : { username: typed, available: false },
  );
  const compared = asked.flatMap(({ list }) => (list ? [list] : []));
  if (compared.length < 2) return c.json({ users, comparison: null }, 200);

  const rows = await db
    .select({
      userId: listEntry.userId,
      status: listEntry.status,
      seasonId: season.id,
      seriesId: series.id,
      seriesTitle: series.title,
      seasonTitle: season.title,
      ordinal: season.ordinal,
    })
    .from(listEntry)
    .innerJoin(season, eq(listEntry.seasonId, season.id))
    .innerJoin(series, eq(season.seriesId, series.id))
    .where(
      inArray(
        listEntry.userId,
        compared.map((list) => list.ownerId),
      ),
    )
    .orderBy(asc(series.title), asc(series.id), asc(season.ordinal));

  const bySeason = new Map<string, typeof rows>();
  for (const row of rows) {
    const seasonRows = bySeason.get(row.seasonId);
    if (seasonRows) seasonRows.push(row);
    else bySeason.set(row.seasonId, [row]);
  }

  const onAll: CompareRow[] = [];
  const onSome: CompareRow[] = [];
  const onOne: CompareRow[] = [];
  for (const [seasonId, seasonRows] of bySeason) {
    const first = seasonRows[0];
    if (!first) continue;
    const statuses = compared.map((list) => ({
      username: list.displayName,
      status: seasonRows.find((row) => row.userId === list.ownerId)?.status ?? null,
    }));
    const on = statuses.filter((entry) => entry.status !== null).map((entry) => entry.username);
    const group = on.length === compared.length ? onAll : on.length === 1 ? onOne : onSome;
    group.push({
      seasonId,
      seriesId: first.seriesId,
      seriesTitle: first.seriesTitle,
      seasonTitle: first.seasonTitle,
      ordinal: first.ordinal,
      on,
      statuses,
    });
  }
  return c.json({ users, comparison: { onAll, onSome, onOne } }, 200);
});
