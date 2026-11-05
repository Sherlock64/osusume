import type { CatalogProposal } from '@osusume/shared';
import { eq } from 'drizzle-orm';
import type { Transaction } from '../db/client.ts';
import { series } from '../db/schema.ts';
import {
  assertImagesExist,
  assertOrdinalFree,
  assertTagsExist,
  insertSeason,
  insertSeries,
  seriesNotFound,
} from './entries.ts';

function tagIdsOf(proposal: CatalogProposal): string[] {
  return proposal.kind === 'new_series'
    ? [
        ...(proposal.series.tagIds ?? []),
        ...proposal.seasons.flatMap((season) => season.tagIds ?? []),
      ]
    : (proposal.season.tagIds ?? []);
}

function coverIdsOf(proposal: CatalogProposal): string[] {
  const covers =
    proposal.kind === 'new_series'
      ? [proposal.series.coverImageId, ...proposal.seasons.map((season) => season.coverImageId)]
      : [proposal.season.coverImageId];
  return covers.filter((cover) => cover !== null && cover !== undefined);
}

/**
 * Refuses a proposal that could not be applied now: a tag outside the vocabulary, a cover that
 * does not exist, or a season for a missing series or a taken ordinal. Hold the catalog lock.
 */
export async function assertProposalApplies(
  tx: Transaction,
  proposal: CatalogProposal,
): Promise<void> {
  await assertTagsExist(tx, tagIdsOf(proposal));
  await assertImagesExist(tx, coverIdsOf(proposal));
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
  for (const season of proposal.seasons) await insertSeason(tx, seriesId, season);
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

/** The proposal with a deleted tag taken off everything that chose it. */
export function withoutTag(proposal: CatalogProposal, tagId: string): CatalogProposal {
  const without = <Entry extends { tagIds?: string[] | undefined }>(entry: Entry): Entry => ({
    ...entry,
    tagIds: entry.tagIds?.filter((id) => id !== tagId),
  });
  return proposal.kind === 'new_series'
    ? { ...proposal, series: without(proposal.series), seasons: proposal.seasons.map(without) }
    : { ...proposal, season: without(proposal.season) };
}
