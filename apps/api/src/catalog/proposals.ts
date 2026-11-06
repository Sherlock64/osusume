import type { CatalogProposal } from '@osusume/shared';
import { eq } from 'drizzle-orm';
import type { Transaction } from '../db/client.ts';
import { series } from '../db/schema.ts';
import { ApiError } from '../lib/errors.ts';
import {
  assertOrdinalFree,
  assertTagsExist,
  findOrCreateTag,
  insertSeason,
  insertSeries,
  seriesNotFound,
} from './entries.ts';

function tagIdsOf(proposal: CatalogProposal): string[] {
  return proposal.kind === 'new_series'
    ? [
        ...(proposal.series.tagIds ?? []),
        ...(proposal.seasons ?? []).flatMap((season) => season.tagIds ?? []),
      ]
    : (proposal.season.tagIds ?? []);
}

/**
 * Refuses a proposal that could not be applied now: a tag outside the vocabulary, or a season
 * for a missing series or a taken ordinal. Hold the catalog lock.
 */
export async function assertProposalApplies(
  tx: Transaction,
  proposal: CatalogProposal,
): Promise<void> {
  await assertTagsExist(tx, tagIdsOf(proposal));
  if (proposal.kind === 'add_season') {
    const [target] = await tx
      .select({ id: series.id })
      .from(series)
      .where(eq(series.id, proposal.seriesId));
    if (!target) throw seriesNotFound();
    await assertOrdinalFree(tx, proposal.seriesId, proposal.season.ordinal);
  }
}

/** Creates a proposal's rows, and returns the series they belong to. Check it first. */
export async function applyProposal(tx: Transaction, proposal: CatalogProposal): Promise<string> {
  if (proposal.kind === 'add_season') {
    await insertSeason(tx, proposal.seriesId, proposal.season);
    return proposal.seriesId;
  }
  const seriesId = await insertSeries(tx, proposal.series);
  for (const season of proposal.seasons ?? []) await insertSeason(tx, seriesId, season);
  return seriesId;
}

/** Suggested names without repeats, ignoring case. The first spelling stays. */
export function withUniqueSuggestions<Proposal extends CatalogProposal>(proposal: Proposal): Proposal {
  const byKey = new Map<string, string>();
  for (const name of proposal.suggestedTags ?? []) {
    if (!byKey.has(name.toLowerCase())) byKey.set(name.toLowerCase(), name);
  }
  return { ...proposal, suggestedTags: [...byKey.values()] };
}

/**
 * Resolves accepted names to tags, creating any that do not exist, and attaches them: to a new
 * series, since tags belong to the series, or to the season a request adds, so that one season
 * does not retag the others. Names must be among what the member suggested. Hold the catalog lock.
 */
export async function acceptSuggestions(
  tx: Transaction,
  filed: CatalogProposal,
  proposal: CatalogProposal,
  names: readonly string[],
): Promise<CatalogProposal> {
  const suggested = new Map((filed.suggestedTags ?? []).map((name) => [name.toLowerCase(), name]));
  const tagIds: string[] = [];
  for (const key of new Set(names.map((name) => name.toLowerCase()))) {
    const name = suggested.get(key);
    if (name === undefined) {
      throw new ApiError(400, 'unknown_suggestion', 'An accepted tag is not among the suggestions.');
    }
    tagIds.push(await findOrCreateTag(tx, name));
  }
  const added = <Entry extends { tagIds?: string[] | undefined }>(entry: Entry): Entry =>
    tagIds.length === 0 ? entry : { ...entry, tagIds: [...new Set([...(entry.tagIds ?? []), ...tagIds])] };
  return proposal.kind === 'new_series'
    ? { ...proposal, series: added(proposal.series) }
    : { ...proposal, season: added(proposal.season) };
}

/** The proposal with a deleted tag taken off everything that chose it. */
export function withoutTag(proposal: CatalogProposal, tagId: string): CatalogProposal {
  const without = <Entry extends { tagIds?: string[] | undefined }>(entry: Entry): Entry => ({
    ...entry,
    tagIds: entry.tagIds?.filter((id) => id !== tagId),
  });
  return proposal.kind === 'new_series'
    ? { ...proposal, series: without(proposal.series), seasons: proposal.seasons?.map(without) }
    : { ...proposal, season: without(proposal.season) };
}
