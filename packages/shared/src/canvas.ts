import { z } from 'zod';
import { coverSchema } from './catalog.ts';

/** 'recommend' means the two series go together, 'avoid' that they do not. */
export const canvasLinkKinds = ['recommend', 'avoid'] as const;
export const canvasLinkKindSchema = z.enum(canvasLinkKinds);
export type CanvasLinkKind = z.infer<typeof canvasLinkKindSchema>;

export const CANVAS_POSITIONS_MAX = 1000;

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
});
export type CanvasNode = z.infer<typeof canvasNodeSchema>;

/** A link has no direction: the pair is unordered, and the api reports it in a fixed order. */
export const canvasLinkSchema = z.object({
  seriesAId: z.uuid(),
  seriesBId: z.uuid(),
  kind: canvasLinkKindSchema,
});
export type CanvasLink = z.infer<typeof canvasLinkSchema>;

export const canvasResponseSchema = z.object({
  nodes: z.array(canvasNodeSchema),
  links: z.array(canvasLinkSchema),
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
