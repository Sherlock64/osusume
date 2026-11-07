import {
  adminCatalogRequestListQuerySchema,
  catalogProposalSchema,
  catalogRequestDecisionSchema,
  catalogRequestListQuerySchema,
  idParamSchema,
} from '@osusume/shared';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { displayName } from '../auth/accounts.ts';
import { refusingTakenOrdinal } from '../catalog/entries.ts';
import {
  acceptSuggestions,
  applyProposal,
  assertProposalApplies,
  withUniqueSuggestions,
} from '../catalog/proposals.ts';
import type { Database, Transaction } from '../db/client.ts';
import { catalogRequest, series, user } from '../db/schema.ts';
import { ApiError } from '../lib/errors.ts';
import { lockCatalog } from '../lib/locks.ts';
import { decodeCursor, keyset, toPage } from '../lib/pagination.ts';
import { createRouter, valid } from '../lib/router.ts';
import { requireAdmin, requireSession } from '../middleware/auth.ts';

const requestNotFound = () =>
  new ApiError(404, 'catalog_request_not_found', 'No such catalog request.');

function toCatalogRequest(row: typeof catalogRequest.$inferSelect, seriesTitle: string | null) {
  return {
    id: row.id,
    kind: row.kind,
    seriesId: row.seriesId,
    seriesTitle,
    proposal: catalogProposalSchema.parse(row.payload),
    status: row.status,
    decisionNote: row.decisionNote,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const adminColumns = {
  request: catalogRequest,
  seriesTitle: series.title,
  username: user.username,
  displayUsername: user.displayUsername,
};

interface AdminRow {
  request: typeof catalogRequest.$inferSelect;
  seriesTitle: string | null;
  username: string | null;
  displayUsername: string | null;
}

function toAdminCatalogRequest(row: AdminRow) {
  return {
    ...toCatalogRequest(row.request, row.seriesTitle),
    requesterId: row.request.requesterId,
    requesterUsername:
      row.username === null
        ? null
        : displayName({ username: row.username, displayUsername: row.displayUsername }),
    reviewedBy: row.request.reviewedBy,
  };
}

async function loadAdminRequest(db: Database | Transaction, id: string) {
  const [row] = await db
    .select(adminColumns)
    .from(catalogRequest)
    .leftJoin(series, eq(catalogRequest.seriesId, series.id))
    .leftJoin(user, eq(catalogRequest.requesterId, user.id))
    .where(eq(catalogRequest.id, id));
  if (!row) throw requestNotFound();
  return toAdminCatalogRequest(row);
}

export const catalogRequestRoutes = createRouter()
  // Propose a new series with its seasons, or a new season for an existing series
  .post('/catalog-requests', requireSession, valid('json', catalogProposalSchema), async (c) => {
    const { db } = c.var.deps;
    const proposal = withUniqueSuggestions(c.req.valid('json'));
    const requesterId = c.var.currentUser.id;
    const seriesId = proposal.kind === 'add_season' ? proposal.seriesId : null;
    const created = await db.transaction(async (tx) => {
      await lockCatalog(tx);
      await assertProposalApplies(tx, proposal);
      const [row] = await tx
        .insert(catalogRequest)
        .values({ requesterId, kind: proposal.kind, seriesId, payload: proposal })
        .returning();
      if (!row) throw new Error('catalog request was not created');
      const [target] = seriesId
        ? await tx.select({ title: series.title }).from(series).where(eq(series.id, seriesId))
        : [];
      return toCatalogRequest(row, target?.title ?? null);
    });
    return c.json(created, 201);
  })
  // The catalog requests the current user made, newest first
  .get(
    '/catalog-requests',
    requireSession,
    valid('query', catalogRequestListQuerySchema),
    async (c) => {
      const { db } = c.var.deps;
      const { cursor, limit } = c.req.valid('query');
      const page = keyset({
        sortColumn: catalogRequest.createdAt,
        idColumn: catalogRequest.id,
        direction: 'desc',
        cursor: cursor === undefined ? undefined : decodeCursor(cursor, z.coerce.date()),
      });
      const rows = await db
        .select({ request: catalogRequest, seriesTitle: series.title })
        .from(catalogRequest)
        .leftJoin(series, eq(catalogRequest.seriesId, series.id))
        .where(and(eq(catalogRequest.requesterId, c.var.currentUser.id), page.where))
        .orderBy(...page.orderBy)
        .limit(limit + 1);
      const { items, nextCursor } = toPage(rows, limit, (row) => ({
        sort: row.request.createdAt,
        id: row.request.id,
      }));
      return c.json(
        { items: items.map((row) => toCatalogRequest(row.request, row.seriesTitle)), nextCursor },
        200,
      );
    },
  )
  // All catalog requests, newest first
  .get(
    '/admin/catalog-requests',
    requireAdmin,
    valid('query', adminCatalogRequestListQuerySchema),
    async (c) => {
      const { db } = c.var.deps;
      const { cursor, limit, status } = c.req.valid('query');
      const page = keyset({
        sortColumn: catalogRequest.createdAt,
        idColumn: catalogRequest.id,
        direction: 'desc',
        cursor: cursor === undefined ? undefined : decodeCursor(cursor, z.coerce.date()),
      });
      const rows = await db
        .select(adminColumns)
        .from(catalogRequest)
        .leftJoin(series, eq(catalogRequest.seriesId, series.id))
        .leftJoin(user, eq(catalogRequest.requesterId, user.id))
        .where(and(status === undefined ? undefined : eq(catalogRequest.status, status), page.where))
        .orderBy(...page.orderBy)
        .limit(limit + 1);
      const { items, nextCursor } = toPage(rows, limit, (row) => ({
        sort: row.request.createdAt,
        id: row.request.id,
      }));
      return c.json({ items: items.map(toAdminCatalogRequest), nextCursor }, 200);
    },
  )
  // Approve a pending request as filed or edited, creating its rows, or reject it
  .post(
    '/admin/catalog-requests/:id/decision',
    requireAdmin,
    valid('param', idParamSchema),
    valid('json', catalogRequestDecisionSchema),
    async (c) => {
      const { db } = c.var.deps;
      const { id } = c.req.valid('param');
      const body = c.req.valid('json');
      const adminId = c.var.currentUser.id;

      const decided = await refusingTakenOrdinal(() =>
        db.transaction(async (tx) => {
          await lockCatalog(tx);
          const [row] = await tx
            .select()
            .from(catalogRequest)
            .where(eq(catalogRequest.id, id))
            .for('update');
          if (!row) throw requestNotFound();
          if (row.status !== 'pending') {
            throw new ApiError(
              409,
              'catalog_request_not_pending',
              'This request has already been decided.',
            );
          }

          if (body.decision === 'reject') {
            await tx
              .update(catalogRequest)
              .set({
                status: 'rejected',
                reviewedBy: adminId,
                decisionNote: body.decisionNote ?? null,
              })
              .where(eq(catalogRequest.id, id));
            return loadAdminRequest(tx, id);
          }

          const filed = catalogProposalSchema.parse(row.payload);
          const edited = withUniqueSuggestions(body.proposal ?? filed);
          if (edited.kind !== filed.kind) {
            throw new ApiError(
              400,
              'proposal_kind_mismatch',
              'An edited entry must be of the same kind as the request.',
            );
          }
          if (
            edited.kind === 'add_season' &&
            filed.kind === 'add_season' &&
            edited.seriesId !== filed.seriesId
          ) {
            throw new ApiError(
              400,
              'proposal_series_mismatch',
              'A request cannot be moved to another series. Reject it instead.',
            );
          }
          const proposal = await acceptSuggestions(tx, filed, edited, body.acceptSuggestedTags ?? []);
          // Accepted tags can push an entry past a limit the edit alone was within.
          if (!catalogProposalSchema.safeParse(proposal).success) {
            throw new ApiError(400, 'too_many_tags', 'This entry would have too many tags.');
          }
          await assertProposalApplies(tx, proposal);
          const seriesId = await applyProposal(tx, proposal);
          await tx
            .update(catalogRequest)
            .set({ status: 'approved', reviewedBy: adminId, seriesId, payload: proposal })
            .where(eq(catalogRequest.id, id));
          return loadAdminRequest(tx, id);
        }),
      );
      return c.json(decided, 200);
    },
  );

