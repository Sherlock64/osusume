import {
  DECISION_NOTE_MAX_LENGTH,
  MAX_IMAGE_UPLOAD_BYTES,
  type CatalogProposal,
  type Tag,
} from '@osusume/shared';
import { z } from 'zod';
import { altTitlesField, seasonForm, synopsisField, titleField } from '@/lib/catalog-request-form';

/*
 * The admin's catalog forms. Unlike a proposal, which leaves out what is blank, these send blanks
 * as null: the same body creates an entry or, on a PATCH, clears what was emptied.
 */

export const seriesFormSchema = z
  .object({ title: titleField, altTitles: altTitlesField, synopsis: synopsisField })
  .transform(({ synopsis, ...series }) => ({
    ...series,
    synopsis: synopsis === '' ? null : synopsis,
  }));

export const seasonFormSchema = seasonForm.transform(({ seasonOfYear, synopsis, ...season }) => ({
  ...season,
  seasonOfYear: seasonOfYear === '' ? null : seasonOfYear,
  synopsis: synopsis === '' ? null : synopsis,
}));

export const moveSeasonFormSchema = z.object({ ordinal: seasonForm.shape.ordinal });

/** The note is optional, and the api refuses an empty one. */
export const rejectFormSchema = z
  .object({ decisionNote: z.string().trim().max(DECISION_NOTE_MAX_LENGTH) })
  .transform(({ decisionNote }) => (decisionNote === '' ? {} : { decisionNote }));

const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

/**
 * Why a file won't be accepted, before uploading it, or null. The api has the last word, since
 * the content decides the format; a browser may not name a type at all.
 */
export function imageUploadProblem(file: { size: number; type: string }): string | null {
  if (file.type !== '' && !ACCEPTED_IMAGE_TYPES.includes(file.type)) {
    return 'Upload a JPEG, PNG or WebP image.';
  }
  if (file.size > MAX_IMAGE_UPLOAD_BYTES) {
    return `Images can be at most ${String(MAX_IMAGE_UPLOAD_BYTES / (1024 * 1024))} MB.`;
  }
  return null;
}

/**
 * The entry to approve: what the admin edited, with the tags chosen by hand attached where the
 * request's kind says they go, and the member's suggestions kept as filed. `seasonTagIds` carries
 * a new series' seasons' own tags by position, which the review form doesn't edit.
 */
export function reviewedProposal(
  filed: CatalogProposal,
  edited: CatalogProposal,
  tagIds: string[],
  seasonTagIds: readonly (string[] | undefined)[] = [],
): CatalogProposal {
  const { suggestedTags } = filed;
  if (edited.kind === 'add_season') {
    return { ...edited, season: { ...edited.season, tagIds }, suggestedTags };
  }
  return {
    ...edited,
    series: { ...edited.series, tagIds },
    seasons: edited.seasons?.map((season, index) => ({ ...season, tagIds: seasonTagIds[index] })),
    suggestedTags,
  };
}

/** What accepting a suggestion will do, given the vocabulary. Names ignore case. */
export function suggestionOutcome(name: string, tags: readonly Tag[]): string {
  const match = tags.find((tag) => tag.name.toLowerCase() === name.toLowerCase());
  return match === undefined ? 'creates a new tag' : `uses the existing tag ${match.name}`;
}
