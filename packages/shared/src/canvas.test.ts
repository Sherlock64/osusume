import { describe, expect, it } from 'vitest';
import {
  CANVAS_COORDINATE_MAX,
  canvasSearchQuerySchema,
  patchCanvasGroupSchema,
  postCanvasGroupSchema,
  putCanvasPositionsSchema,
} from './canvas.ts';

const positions = (x: number) => ({
  positions: [{ seriesId: '00000000-0000-4000-8000-000000000000', x, y: 0 }],
});

describe('putCanvasPositionsSchema', () => {
  it('refuses a coordinate that would hang the layout in every viewer', () => {
    expect(putCanvasPositionsSchema.safeParse(positions(1e300)).success).toBe(false);
    expect(putCanvasPositionsSchema.safeParse(positions(-1e300)).success).toBe(false);
  });

  it('accepts the limit itself', () => {
    expect(putCanvasPositionsSchema.safeParse(positions(CANVAS_COORDINATE_MAX)).success).toBe(true);
  });
});

describe('group and search schemas', () => {
  const seriesId = '00000000-0000-4000-8000-000000000000';

  it('refuses a blank or 61-character group name, and trims', () => {
    for (const name of ['', '   ', 'a'.repeat(61)]) {
      expect(postCanvasGroupSchema.safeParse({ name, seriesId }).success).toBe(false);
      expect(patchCanvasGroupSchema.safeParse({ name }).success).toBe(false);
    }
    expect(patchCanvasGroupSchema.parse({ name: ` ${'a'.repeat(60)} ` }).name).toBe('a'.repeat(60));
  });

  it('refuses a blank search', () => {
    expect(canvasSearchQuerySchema.safeParse({ q: '  ' }).success).toBe(false);
    expect(canvasSearchQuerySchema.safeParse({ q: 'narto' }).success).toBe(true);
  });
});
