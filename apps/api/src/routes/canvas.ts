import { createRoute } from '@hono/zod-openapi';
import {
  canvasLinkSchema,
  canvasResponseSchema,
  deleteCanvasLinkQuerySchema,
  putCanvasLinkSchema,
  putCanvasPositionsSchema,
  usernameKey,
  usernameParamSchema,
} from '@osusume/shared';
import { and, asc, eq, exists, inArray, sql } from 'drizzle-orm';
import type { Database } from '../db/client.ts';
import { canvasLink, canvasPosition, image, listEntry, season, series } from '../db/schema.ts';
import { ApiError } from '../lib/errors.ts';
import { privateNoStore } from '../lib/http-cache.ts';
import {
  createRouter,
  invalidRequest,
  notFound,
  sessionSecurity,
  unauthenticated,
} from '../lib/router.ts';
import { requireSession } from '../middleware/auth.ts';
import { canView, listNotFound, loadListRefs, loadViewer } from '../social/lists.ts';

/** The series on a user's canvas: any of its seasons on their list at a status past plan to watch. */
const onCanvas = (db: Database, ownerId: string, seriesId: typeof series.id) =>
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
async function filterOnCanvas(db: Database, ownerId: string, seriesIds: readonly string[]) {
  const rows = await db
    .select({ id: series.id })
    .from(series)
    .where(and(inArray(series.id, [...seriesIds]), onCanvas(db, ownerId, series.id)));
  return new Set(rows.map((row) => row.id));
}

async function loadCanvas(db: Database, ownerId: string) {
  const [nodes, links] = await Promise.all([
    db
      .select({
        seriesId: series.id,
        title: series.title,
        imageId: image.id,
        imageWidth: image.width,
        imageHeight: image.height,
        x: canvasPosition.x,
        y: canvasPosition.y,
      })
      .from(series)
      .leftJoin(image, and(eq(image.seriesId, series.id), eq(image.isPrimary, true)))
      .leftJoin(
        canvasPosition,
        and(eq(canvasPosition.seriesId, series.id), eq(canvasPosition.userId, ownerId)),
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
  ]);
  const ids = new Set(nodes.map((node) => node.seriesId));
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
    })),
    // Links to a series that left the list stay stored but are not shown.
    links: links.filter((link) => ids.has(link.seriesAId) && ids.has(link.seriesBId)),
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

const getCanvasRoute = createRoute({
  method: 'get',
  path: '/users/{username}/canvas',
  summary: "A member's recommendation canvas. Not found if missing, disabled or not visible",
  security: sessionSecurity,
  middleware: [privateNoStore, requireSession] as const,
  request: { params: usernameParamSchema },
  responses: {
    200: {
      description: 'The series on the canvas, and the links between them',
      content: { 'application/json': { schema: canvasResponseSchema } },
    },
    ...unauthenticated,
    ...notFound,
  },
});

const putPositionsRoute = createRoute({
  method: 'put',
  path: '/me/canvas/positions',
  summary: 'Place series on the canvas. Series not on the canvas are ignored',
  security: sessionSecurity,
  middleware: [privateNoStore, requireSession] as const,
  request: {
    body: { required: true, content: { 'application/json': { schema: putCanvasPositionsSchema } } },
  },
  responses: {
    204: { description: 'Saved' },
    ...invalidRequest,
    ...unauthenticated,
  },
});

const putLinkRoute = createRoute({
  method: 'put',
  path: '/me/canvas/links',
  summary: 'Link two series on the canvas, or change the kind of their link',
  security: sessionSecurity,
  middleware: [privateNoStore, requireSession] as const,
  request: {
    body: { required: true, content: { 'application/json': { schema: putCanvasLinkSchema } } },
  },
  responses: {
    200: {
      description: 'The link, with the lower series id first',
      content: { 'application/json': { schema: canvasLinkSchema } },
    },
    ...invalidRequest,
    ...unauthenticated,
    ...notFound,
  },
});

const deleteLinkRoute = createRoute({
  method: 'delete',
  path: '/me/canvas/links',
  summary: 'Remove the link between two series. Nothing to remove is not an error',
  security: sessionSecurity,
  middleware: [privateNoStore, requireSession] as const,
  request: { query: deleteCanvasLinkQuerySchema },
  responses: {
    204: { description: 'No link between them' },
    ...invalidRequest,
    ...unauthenticated,
  },
});

export const canvasRoutes = createRouter()
  .openapi(getCanvasRoute, async (c) => {
    const { db } = c.var.deps;
    const { username } = c.req.valid('param');
    // The same rule as the list: whoever may see it, and the same answer for everyone else.
    const list = (await loadListRefs(db, [username])).get(usernameKey(username));
    const viewer = await loadViewer(db, c.var.currentUser.id, list ? [list.ownerId] : []);
    if (!list || !canView(viewer, list)) throw listNotFound();
    return c.json(await loadCanvas(db, list.ownerId), 200);
  })
  .openapi(putPositionsRoute, async (c) => {
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
  .openapi(putLinkRoute, async (c) => {
    const { db } = c.var.deps;
    const userId = c.var.currentUser.id;
    const { seriesAId, seriesBId, kind } = c.req.valid('json');
    const [low, high] = normalizePair(seriesAId, seriesBId);
    const eligible = await filterOnCanvas(db, userId, [low, high]);
    if (eligible.size < 2) {
      throw new ApiError(404, 'series_not_on_canvas', 'Both series must be on your canvas.');
    }
    const [row] = await db
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
      });
    if (!row) throw new Error('canvas link was not saved');
    return c.json(row, 200);
  })
  .openapi(deleteLinkRoute, async (c) => {
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
  });
