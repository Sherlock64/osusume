import { z } from 'zod';
import { SEARCH_QUERY_MAX_LENGTH, coverSchema } from './catalog.ts';
import { seriesRatingSchema } from './social.ts';

/** 'recommend' means the two series go together, 'avoid' that they do not. */
export const canvasLinkKinds = ['recommend', 'avoid'] as const;
export const canvasLinkKindSchema = z.enum(canvasLinkKinds);
export type CanvasLinkKind = z.infer<typeof canvasLinkKindSchema>;

export const CANVAS_POSITIONS_MAX = 1000;
export const CANVAS_SEARCH_LIMIT = 20;
export const CANVAS_GROUP_NAME_MAX = 60;

const groupNameSchema = z.string().trim().min(1).max(CANVAS_GROUP_NAME_MAX);

/** Far beyond any real drag. Past about 1e18, the layout's grid loop in the web app never ends. */
export const CANVAS_COORDINATE_MAX = 1_000_000;
const coordinateSchema = z.number().min(-CANVAS_COORDINATE_MAX).max(CANVAS_COORDINATE_MAX);

/** A series on the canvas. `x` and `y` are null until the owner has placed it. */
export const canvasNodeSchema = z.object({
  seriesId: z.uuid(),
  title: z.string(),
  /** The series' primary image, as lists of series show it. Null shows a placeholder. */
  cover: coverSchema.nullable(),
  x: z.number().nullable(),
  y: z.number().nullable(),
  /** The owner's rating of the series, the default until they rate it. */
  rating: seriesRatingSchema,
  /** The owner's group the series is in, if any. */
  groupId: z.uuid().nullable(),
});
export type CanvasNode = z.infer<typeof canvasNodeSchema>;

/** A link has no direction: the pair is unordered, and the api reports it in a fixed order. */
export const canvasLinkSchema = z.object({
  seriesAId: z.uuid(),
  seriesBId: z.uuid(),
  kind: canvasLinkKindSchema,
});
export type CanvasLink = z.infer<typeof canvasLinkSchema>;

export const canvasGroupSchema = z.object({ id: z.uuid(), name: z.string() });
export type CanvasGroup = z.infer<typeof canvasGroupSchema>;

export const canvasResponseSchema = z.object({
  nodes: z.array(canvasNodeSchema),
  links: z.array(canvasLinkSchema),
  /** Only groups with a member among `nodes`, by name then id. */
  groups: z.array(canvasGroupSchema),
});
export type CanvasResponse = z.infer<typeof canvasResponseSchema>;

export const putCanvasPositionsSchema = z.object({
  positions: z
    .array(z.object({ seriesId: z.uuid(), x: coordinateSchema, y: coordinateSchema }))
    .min(1)
    .max(CANVAS_POSITIONS_MAX),
});

export const putCanvasLinkSchema = canvasLinkSchema;

export const deleteCanvasLinkQuerySchema = z.object({
  seriesAId: z.uuid(),
  seriesBId: z.uuid(),
});

export const canvasSearchQuerySchema = z.object({ q: z.string().trim().min(1).max(SEARCH_QUERY_MAX_LENGTH) });
export const canvasSearchResponseSchema = z.object({ seriesIds: z.array(z.uuid()) });
export const postCanvasGroupSchema = z.object({ name: groupNameSchema, seriesId: z.uuid() });
export const patchCanvasGroupSchema = z.object({ name: groupNameSchema });
export const canvasGroupParamSchema = z.object({ groupId: z.uuid() });
export const canvasGroupSeriesParamSchema = z.object({ groupId: z.uuid(), seriesId: z.uuid() });
