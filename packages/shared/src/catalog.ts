import { z } from 'zod';
import { mineQuerySchema } from './accounts.ts';
import {
  catalogRequestKindSchema,
  catalogRequestStatusSchema,
  seasonOfYearSchema,
} from './enums.ts';
import { paginationQuerySchema } from './http.ts';

export const TITLE_MAX_LENGTH = 500;
export const ALT_TITLES_MAX = 50;
export const SYNOPSIS_MAX_LENGTH = 10_000;
export const TAG_NAME_MAX_LENGTH = 100;
export const TAGS_PER_ENTRY_MAX = 50;
export const SUGGESTED_TAGS_MAX = 20;
export const SEASONS_PER_REQUEST_MAX = 100;
export const DECISION_NOTE_MAX_LENGTH = 2000;
export const SEARCH_QUERY_MAX_LENGTH = 200;
export const YEAR_MIN = 1900;
export const YEAR_MAX = 2999;
export const EPISODE_COUNT_MAX = 100_000;
export const ORDINAL_MAX = 100_000;

const timestampSchema = z.iso.datetime();

const titleSchema = z.string().trim().min(1).max(TITLE_MAX_LENGTH);
const altTitlesSchema = z.array(titleSchema).max(ALT_TITLES_MAX);
const synopsisSchema = z.string().trim().min(1).max(SYNOPSIS_MAX_LENGTH);
const tagIdsSchema = z.array(z.uuid()).max(TAGS_PER_ENTRY_MAX);
const yearSchema = z.number().int().min(YEAR_MIN).max(YEAR_MAX);
const episodeCountSchema = z.number().int().min(0).max(EPISODE_COUNT_MAX);
const ordinalSchema = z.number().int().min(0).max(ORDINAL_MAX);

export const tagNameSchema = z.string().trim().min(1).max(TAG_NAME_MAX_LENGTH);

/*
 * Editable fields. Required: title and, on a season, ordinal. Everything else may be left out
 * or sent as null. On a PATCH, a field left out stays as it is and null clears it.
 */
const seriesFields = {
  title: titleSchema,
  altTitles: altTitlesSchema.optional(),
  synopsis: synopsisSchema.nullable().optional(),
  /** From the tag vocabulary. On a PATCH, replaces the series' tags. */
  tagIds: tagIdsSchema.optional(),
};

const seasonFields = {
  ordinal: ordinalSchema,
  title: titleSchema,
  altTitles: altTitlesSchema.optional(),
  year: yearSchema.nullable().optional(),
  seasonOfYear: seasonOfYearSchema.nullable().optional(),
  /** Null while airing or unknown. */
  episodeCount: episodeCountSchema.nullable().optional(),
  synopsis: synopsisSchema.nullable().optional(),
  /** An image from this series' catalog for this season. Null uses the series primary. */
  coverImageId: z.uuid().nullable().optional(),
  /** The season's own extra tags, from the tag vocabulary. On a PATCH, replaces them. */
  tagIds: tagIdsSchema.optional(),
};

const atLeastOneField = (body: object) => Object.values(body).some((value) => value !== undefined);
const NO_FIELDS = 'Send at least one field to change.';

/* Tags */

export const tagSchema = z.object({ id: z.uuid(), name: z.string() });
export type Tag = z.infer<typeof tagSchema>;

export const tagListQuerySchema = paginationQuerySchema;

export const createTagSchema = z.object({ name: tagNameSchema });
export type CreateTag = z.infer<typeof createTagSchema>;

export const updateTagSchema = createTagSchema;
export type UpdateTag = z.infer<typeof updateTagSchema>;

/* Series and seasons */

export const createSeriesSchema = z.object(seriesFields);
export type CreateSeries = z.infer<typeof createSeriesSchema>;

export const updateSeriesSchema = z.object(seriesFields).partial().refine(atLeastOneField, NO_FIELDS);
export type UpdateSeries = z.infer<typeof updateSeriesSchema>;

export const createSeasonSchema = z.object({ seriesId: z.uuid(), ...seasonFields });
export type CreateSeason = z.infer<typeof createSeasonSchema>;

/**
 * Sending another `seriesId` moves the season, which clears its own cover from the old catalog.
 * A `coverImageId` sent with it must be from the new series' catalog.
 */
export const updateSeasonSchema = z
  .object({ seriesId: z.uuid(), ...seasonFields })
  .partial()
  .refine(atLeastOneField, NO_FIELDS);
export type UpdateSeason = z.infer<typeof updateSeasonSchema>;

export const seriesListQuerySchema = paginationQuerySchema.extend({
  /** Matches titles and alternate titles of series and of their seasons. Blank means no search. */
  q: z.string().trim().max(SEARCH_QUERY_MAX_LENGTH).optional(),
  /** A tag id. Matches a tag on the series or on any of its seasons. */
  tag: z.uuid().optional(),
});
export type SeriesListQuery = z.infer<typeof seriesListQuerySchema>;

/**
 * The image to show, already resolved: fetch it from /images/{id}/{size}. Null means there are
 * no images, so show a placeholder.
 */
export const coverSchema = z.object({
  id: z.uuid(),
  width: z.number().int(),
  height: z.number().int(),
});
export type Cover = z.infer<typeof coverSchema>;

/**
 * A series in a list. A series has no date of its own: `firstYear` and `firstSeasonOfYear` come
 * from its earliest dated season, and are null when no season has a year.
 */
export const seriesSummarySchema = z.object({
  id: z.uuid(),
  title: z.string(),
  altTitles: z.array(z.string()),
  synopsis: z.string().nullable(),
  /** The primary image of its catalog. */
  cover: coverSchema.nullable(),
  tags: z.array(tagSchema),
  seasonCount: z.number().int(),
  firstYear: z.number().int().nullable(),
  firstSeasonOfYear: seasonOfYearSchema.nullable(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});
export type SeriesSummary = z.infer<typeof seriesSummarySchema>;

export const seasonSchema = z.object({
  id: z.uuid(),
  seriesId: z.uuid(),
  ordinal: z.number().int(),
  title: z.string(),
  altTitles: z.array(z.string()),
  year: z.number().int().nullable(),
  seasonOfYear: seasonOfYearSchema.nullable(),
  episodeCount: z.number().int().nullable(),
  synopsis: z.string().nullable(),
  /** The image chosen for this season, for editing. Null uses the series primary. */
  coverImageId: z.uuid().nullable(),
  /** What to display: the chosen image, or the series primary. */
  cover: coverSchema.nullable(),
  /** The season's own extra tags, for editing. */
  ownTags: z.array(tagSchema),
  /** What to display: the union of the series' tags and the season's own. */
  effectiveTags: z.array(tagSchema),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});
export type Season = z.infer<typeof seasonSchema>;

/** A series with its seasons, ordered by ordinal. */
export const seriesDetailSchema = seriesSummarySchema.extend({ seasons: z.array(seasonSchema) });
export type SeriesDetail = z.infer<typeof seriesDetailSchema>;

export const seasonDetailSchema = seasonSchema.extend({
  series: z.object({ id: z.uuid(), title: z.string() }),
});
export type SeasonDetail = z.infer<typeof seasonDetailSchema>;

/* Catalog requests */

/** Names a member proposes for the vocabulary. An admin may accept each one at review. */
const suggestedTagsSchema = z.array(tagNameSchema).max(SUGGESTED_TAGS_MAX);

/*
 * Proposals carry no cover, the member's or the admin's edit: a new series has no image catalog
 * until it exists, so admins add images after approval.
 */
const proposedSeriesSchema = z.object(seriesFields);
const proposedSeasonSchema = z.object(seasonFields).omit({ coverImageId: true });

const proposedSeasonsSchema = z
  .array(proposedSeasonSchema)
  .max(SEASONS_PER_REQUEST_MAX)
  .refine(
    (seasons) => new Set(seasons.map((season) => season.ordinal)).size === seasons.length,
    'Season ordinals must be unique within a series.',
  );

/** The full proposed entry: what a member files and what an admin may edit before approving. */
export const catalogProposalSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('new_series'),
    series: proposedSeriesSchema,
    /** Optional: a series can be approved with no seasons yet. */
    seasons: proposedSeasonsSchema.optional(),
    suggestedTags: suggestedTagsSchema.optional(),
  }),
  z.object({
    kind: z.literal('add_season'),
    seriesId: z.uuid(),
    season: proposedSeasonSchema,
    suggestedTags: suggestedTagsSchema.optional(),
  }),
]);
export type CatalogProposal = z.infer<typeof catalogProposalSchema>;

export const catalogRequestListQuerySchema = mineQuerySchema;

export const adminCatalogRequestListQuerySchema = paginationQuerySchema.extend({
  status: catalogRequestStatusSchema.optional(),
});

export const catalogRequestSchema = z.object({
  id: z.uuid(),
  kind: catalogRequestKindSchema,
  /** The series added to, or created on approval. Null if not yet known or since deleted. */
  seriesId: z.uuid().nullable(),
  seriesTitle: z.string().nullable(),
  /** After an approval, the entry as the admin approved it. */
  proposal: catalogProposalSchema,
  status: catalogRequestStatusSchema,
  decisionNote: z.string().nullable(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});
export type CatalogRequest = z.infer<typeof catalogRequestSchema>;

export const adminCatalogRequestSchema = catalogRequestSchema.extend({
  /** Null once the requester has been removed. */
  requesterId: z.uuid().nullable(),
  requesterUsername: z.string().nullable(),
  reviewedBy: z.uuid().nullable(),
});
export type AdminCatalogRequest = z.infer<typeof adminCatalogRequestSchema>;

export const catalogRequestDecisionSchema = z.discriminatedUnion('decision', [
  z.object({
    decision: z.literal('approve'),
    /**
     * The edited entry, of the same kind and for the same series as the request. Left out, the
     * request is used as filed.
     */
    proposal: catalogProposalSchema.optional(),
    /**
     * Names from the request's suggestions to accept. Each creates the tag, or uses the existing
     * one matching ignoring case, and attaches it: to a new series, or to an added season.
     */
    acceptSuggestedTags: z.array(tagNameSchema).max(SUGGESTED_TAGS_MAX).optional(),
  }),
  z.object({
    decision: z.literal('reject'),
    decisionNote: z.string().trim().min(1).max(DECISION_NOTE_MAX_LENGTH).optional(),
  }),
]);
export type CatalogRequestDecision = z.infer<typeof catalogRequestDecisionSchema>;

/* Images */

export const MAX_IMAGE_UPLOAD_BYTES = 10 * 1024 * 1024;

/** The longest edge of each named size, in pixels. Images are never enlarged or cropped. */
export const imageSizeEdges = { small: 160, medium: 320, large: 640 } as const;
export const imageSizes = ['small', 'medium', 'large'] as const;
export const imageSizeSchema = z.enum(imageSizes);
export type ImageSize = z.infer<typeof imageSizeSchema>;

export const imageParamSchema = z.object({ id: z.uuid(), size: imageSizeSchema });

/** An image as stored, whatever was uploaded. `width` and `height` are the `large` size's. */
export const imageSchema = z.object({
  id: z.uuid(),
  width: z.number().int(),
  height: z.number().int(),
  createdAt: timestampSchema,
});
export type Image = z.infer<typeof imageSchema>;

/* A series' image catalog */

export const seriesImageListQuerySchema = paginationQuerySchema;

export const seriesImageParamSchema = z.object({ id: z.uuid(), imageId: z.uuid() });

export const seriesImageSchema = imageSchema.extend({
  isPrimary: z.boolean(),
});
export type SeriesImage = z.infer<typeof seriesImageSchema>;
