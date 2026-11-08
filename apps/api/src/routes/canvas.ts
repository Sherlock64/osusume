import {
  CANVAS_SEARCH_LIMIT,
  canvasGroupParamSchema,
  canvasGroupSeriesParamSchema,
  canvasSearchQuerySchema,
  deleteCanvasLinkQuerySchema,
  patchCanvasGroupSchema,
  postCanvasGroupSchema,
  putCanvasLinkSchema,
  putCanvasPositionsSchema,
  usernameKey,
  usernameParamSchema,
} from '@osusume/shared';
import { and, asc, desc, eq, exists, inArray, notExists, sql } from 'drizzle-orm';
import { seriesMatchingSearch, seriesRelevance } from '../catalog/search.ts';
import type { Database, Transaction } from '../db/client.ts';
import {
  canvasGroup,
  canvasGroupMember,
  canvasLink,
  canvasPosition,
  image,
  listEntry,
  season,
  series,
  seriesRating,
} from '../db/schema.ts';
import { ApiError, one } from '../lib/errors.ts';
import { createRouter, valid } from '../lib/router.ts';
import { requireSession } from '../middleware/auth.ts';
import { canView, listNotFound, loadListRefs, loadViewer, ratingOrDefault } from '../social/lists.ts';

/** The series on a user's canvas: any of its seasons on their list at a status past plan to watch. */
const onCanvas = (db: Database | Transaction, ownerId: string, seriesId: typeof series.id) =>
  exists(
    db
      .select({ one: sql`1` })
      .from(listEntry)
      .innerJoin(season, eq(listEntry.seasonId, season.id))
      .where(
        and(
          eq(listEntry.userId, ownerId),
          eq(season.seriesId, seriesId),
          sql`${listEntry.status} <> 'plan_to_watch'`,
        ),
      ),
  );

/** Which of these series are on the user's canvas now. */
async function filterOnCanvas(db: Database | Transaction, ownerId: string, seriesIds: readonly string[]) {
  const rows = await db
    .select({ id: series.id })
    .from(series)
    .where(and(inArray(series.id, [...seriesIds]), onCanvas(db, ownerId, series.id)));
  return new Set(rows.map((row) => row.id));
}

async function loadCanvas(db: Database, ownerId: string) {
  const [nodes, links, groups] = await Promise.all([
    db
      .select({
        seriesId: series.id,
        title: series.title,
        imageId: image.id,
        imageWidth: image.width,
        imageHeight: image.height,
        x: canvasPosition.x,
        y: canvasPosition.y,
        rating: ratingOrDefault,
        groupId: canvasGroupMember.groupId,
      })
      .from(series)
      .leftJoin(image, and(eq(image.seriesId, series.id), eq(image.isPrimary, true)))
      .leftJoin(
        canvasPosition,
        and(eq(canvasPosition.seriesId, series.id), eq(canvasPosition.userId, ownerId)),
      )
      .leftJoin(seriesRating, and(eq(seriesRating.seriesId, series.id), eq(seriesRating.userId, ownerId)))
      .leftJoin(
        canvasGroupMember,
        and(eq(canvasGroupMember.seriesId, series.id), eq(canvasGroupMember.userId, ownerId)),
      )
      .where(onCanvas(db, ownerId, series.id))
      .orderBy(asc(series.title), asc(series.id)),
    db
      .select({
        seriesAId: canvasLink.seriesLowId,
        seriesBId: canvasLink.seriesHighId,
        kind: canvasLink.kind,
      })
      .from(canvasLink)
      .where(eq(canvasLink.userId, ownerId)),
    db
      .select({ id: canvasGroup.id, name: canvasGroup.name })
      .from(canvasGroup)
      .where(eq(canvasGroup.userId, ownerId))
      .orderBy(asc(canvasGroup.name), asc(canvasGroup.id)),
  ]);
  const ids = new Set(nodes.map((node) => node.seriesId));
  const shownGroups = new Set(nodes.map((node) => node.groupId));
  return {
    nodes: nodes.map((node) => ({
      seriesId: node.seriesId,
      title: node.title,
      cover:
        node.imageId === null
          ? null
          : { id: node.imageId, width: node.imageWidth ?? 0, height: node.imageHeight ?? 0 },
      x: node.x,
      y: node.y,
      rating: node.rating,
      groupId: node.groupId,
    })),
    // Links to a series that left the list stay stored but are not shown.
    links: links.filter((link) => ids.has(link.seriesAId) && ids.has(link.seriesBId)),
    // A group with no member on the canvas is not shown either.
    groups: groups.filter((group) => shownGroups.has(group.id)),
  };
}

/** Lowest id first, as the table requires. Ids are lowercase uuids, so this matches Postgres. */
function normalizePair(a: string, b: string) {
  const [x, y] = [a.toLowerCase(), b.toLowerCase()];
  if (x === y) {
    throw new ApiError(400, 'canvas_link_same_series', 'A series cannot be linked to itself.');
  }
  return x < y ? ([x, y] as const) : ([y, x] as const);
}

/** The owner of a canvas the viewer may see. The same rule and answer as the list. */
async function visibleCanvasOwner(db: Database, viewerId: string, username: string) {
  const list = (await loadListRefs(db, [username])).get(usernameKey(username));
  const viewer = await loadViewer(db, viewerId, list ? [list.ownerId] : []);
  if (!list || !canView(viewer, list)) throw listNotFound();
  return list.ownerId;
}

const groupNotFound = () => new ApiError(404, 'canvas_group_not_found', 'No such group.');
const seriesNotOnCanvas = () =>
  new ApiError(404, 'series_not_on_canvas', 'The series must be on your canvas.');

/** Locks the user's own group for this transaction. Another user's group is not found. */
async function lockOwnGroup(tx: Transaction, userId: string, groupId: string) {
  const [row] = await tx
    .select({ id: canvasGroup.id })
    .from(canvasGroup)
    .where(and(eq(canvasGroup.id, groupId), eq(canvasGroup.userId, userId)))
    .for('update');
  if (!row) throw groupNotFound();
}

async function assertOnCanvas(tx: Transaction, userId: string, seriesId: string) {
  if ((await filterOnCanvas(tx, userId, [seriesId])).size === 0) throw seriesNotOnCanvas();
}

async function deleteGroupIfEmpty(tx: Transaction, groupId: string) {
  await tx
    .delete(canvasGroup)
    .where(
      and(
        eq(canvasGroup.id, groupId),
        notExists(
          tx.select({ one: sql`1` }).from(canvasGroupMember).where(eq(canvasGroupMember.groupId, groupId)),
        ),
      ),
    );
}

/** Puts the series in the group, out of any old one, which goes if now empty. */
async function joinGroup(tx: Transaction, userId: string, seriesId: string, groupId: string) {
  const [old] = await tx
    .select({ groupId: canvasGroupMember.groupId })
    .from(canvasGroupMember)
    .where(and(eq(canvasGroupMember.userId, userId), eq(canvasGroupMember.seriesId, seriesId)))
    .for('update');
  await tx
    .insert(canvasGroupMember)
    .values({ userId, seriesId, groupId })
    .onConflictDoUpdate({
      target: [canvasGroupMember.userId, canvasGroupMember.seriesId],
      set: { groupId },
    });
  if (old && old.groupId !== groupId) await deleteGroupIfEmpty(tx, old.groupId);
}

export const canvasRoutes = createRouter()
  // A member's recommendation canvas. Not found if missing, disabled or not visible
  .get('/users/:username/canvas', requireSession, valid('param', usernameParamSchema), async (c) => {
    const { db } = c.var.deps;
    const ownerId = await visibleCanvasOwner(db, c.var.currentUser.id, c.req.valid('param').username);
    return c.json(await loadCanvas(db, ownerId), 200);
  })
  // Series on a member's canvas matching a search, best match first
  .get(
    '/users/:username/canvas/search',
    requireSession,
    valid('param', usernameParamSchema),
    valid('query', canvasSearchQuerySchema),
    async (c) => {
      const { db } = c.var.deps;
      const ownerId = await visibleCanvasOwner(db, c.var.currentUser.id, c.req.valid('param').username);
      const { q } = c.req.valid('query');
      const rows = await db
        .select({ id: series.id })
        .from(series)
        .where(and(onCanvas(db, ownerId, series.id), seriesMatchingSearch(q)))
        .orderBy(desc(seriesRelevance(q)), asc(series.title), asc(series.id))
        .limit(CANVAS_SEARCH_LIMIT);
      return c.json({ seriesIds: rows.map((row) => row.id) }, 200);
    },
  )
  // Start a group with one series, taking it out of its old group
  .post('/me/canvas/groups', requireSession, valid('json', postCanvasGroupSchema), async (c) => {
    const userId = c.var.currentUser.id;
    const { name, seriesId } = c.req.valid('json');
    const group = await c.var.deps.db.transaction(async (tx) => {
      await assertOnCanvas(tx, userId, seriesId);
      const created = await tx
        .insert(canvasGroup)
        .values({ userId, name })
        .returning({ id: canvasGroup.id, name: canvasGroup.name })
        .then(one);
      await joinGroup(tx, userId, seriesId, created.id);
      return created;
    });
    return c.json(group, 201);
  })
  // Rename a group
  .patch(
    '/me/canvas/groups/:groupId',
    requireSession,
    valid('param', canvasGroupParamSchema),
    valid('json', patchCanvasGroupSchema),
    async (c) => {
      const { groupId } = c.req.valid('param');
      const [row] = await c.var.deps.db
        .update(canvasGroup)
        .set({ name: c.req.valid('json').name, updatedAt: new Date() })
        .where(and(eq(canvasGroup.id, groupId), eq(canvasGroup.userId, c.var.currentUser.id)))
        .returning({ id: canvasGroup.id, name: canvasGroup.name });
      if (!row) throw groupNotFound();
      return c.json(row, 200);
    },
  )
  // Delete a group. Its members stay on the canvas where they are
  .delete(
    '/me/canvas/groups/:groupId',
    requireSession,
    valid('param', canvasGroupParamSchema),
    async (c) => {
      const { groupId } = c.req.valid('param');
      const [row] = await c.var.deps.db
        .delete(canvasGroup)
        .where(and(eq(canvasGroup.id, groupId), eq(canvasGroup.userId, c.var.currentUser.id)))
        .returning({ id: canvasGroup.id });
      if (!row) throw groupNotFound();
      return c.body(null, 204);
    },
  )
  // Add a series to a group, taking it out of its old group
  .put(
    '/me/canvas/groups/:groupId/series/:seriesId',
    requireSession,
    valid('param', canvasGroupSeriesParamSchema),
    async (c) => {
      const userId = c.var.currentUser.id;
      const { groupId, seriesId } = c.req.valid('param');
      await c.var.deps.db.transaction(async (tx) => {
        await lockOwnGroup(tx, userId, groupId);
        await assertOnCanvas(tx, userId, seriesId);
        await joinGroup(tx, userId, seriesId, groupId);
      });
      return c.body(null, 204);
    },
  )
  // Take a series out of a group. Not a member is not an error; the last member takes the group
  .delete(
    '/me/canvas/groups/:groupId/series/:seriesId',
    requireSession,
    valid('param', canvasGroupSeriesParamSchema),
    async (c) => {
      const userId = c.var.currentUser.id;
      const { groupId, seriesId } = c.req.valid('param');
      await c.var.deps.db.transaction(async (tx) => {
        await lockOwnGroup(tx, userId, groupId);
        await tx
          .delete(canvasGroupMember)
          .where(
            and(
              eq(canvasGroupMember.userId, userId),
              eq(canvasGroupMember.seriesId, seriesId),
              eq(canvasGroupMember.groupId, groupId),
            ),
          );
        await deleteGroupIfEmpty(tx, groupId);
      });
      return c.body(null, 204);
    },
  )
  // Place series on the canvas. Series not on the canvas are ignored
  .put('/me/canvas/positions', requireSession, valid('json', putCanvasPositionsSchema), async (c) => {
    const { db } = c.var.deps;
    const userId = c.var.currentUser.id;
    const { positions } = c.req.valid('json');
    // One row per series, the last one sent: a statement cannot upsert the same row twice.
    const latest = new Map(positions.map((p) => [p.seriesId.toLowerCase(), p]));
    const eligible = await filterOnCanvas(db, userId, [...latest.keys()]);
    const values = [...latest.entries()]
      .filter(([id]) => eligible.has(id))
      .map(([seriesId, { x, y }]) => ({ userId, seriesId, x, y }));
    if (values.length > 0) {
      await db
        .insert(canvasPosition)
        .values(values)
        .onConflictDoUpdate({
          target: [canvasPosition.userId, canvasPosition.seriesId],
          set: {
            x: sql`excluded.x`,
            y: sql`excluded.y`,
            updatedAt: new Date(),
          },
        });
    }
    return c.body(null, 204);
  })
  // Link two series on the canvas, or change the kind of their link
  .put('/me/canvas/links', requireSession, valid('json', putCanvasLinkSchema), async (c) => {
    const { db } = c.var.deps;
    const userId = c.var.currentUser.id;
    const { seriesAId, seriesBId, kind } = c.req.valid('json');
    const [low, high] = normalizePair(seriesAId, seriesBId);
    const eligible = await filterOnCanvas(db, userId, [low, high]);
    if (eligible.size < 2) {
      throw new ApiError(404, 'series_not_on_canvas', 'Both series must be on your canvas.');
    }
    const row = await db
      .insert(canvasLink)
      .values({ userId, seriesLowId: low, seriesHighId: high, kind })
      .onConflictDoUpdate({
        target: [canvasLink.userId, canvasLink.seriesLowId, canvasLink.seriesHighId],
        set: { kind, updatedAt: new Date() },
      })
      .returning({
        seriesAId: canvasLink.seriesLowId,
        seriesBId: canvasLink.seriesHighId,
        kind: canvasLink.kind,
      })
      .then(one);
    return c.json(row, 200);
  })
  // Remove the link between two series. Nothing to remove is not an error
  .delete(
    '/me/canvas/links',
    requireSession,
    valid('query', deleteCanvasLinkQuerySchema),
    async (c) => {
      const { seriesAId, seriesBId } = c.req.valid('query');
      const [low, high] = normalizePair(seriesAId, seriesBId);
      await c.var.deps.db
        .delete(canvasLink)
        .where(
          and(
            eq(canvasLink.userId, c.var.currentUser.id),
            eq(canvasLink.seriesLowId, low),
            eq(canvasLink.seriesHighId, high),
          ),
        );
      return c.body(null, 204);
    },
  );
