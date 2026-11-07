import { describe, expect, it } from 'vitest';
import { CANVAS_COORDINATE_MAX, putCanvasPositionsSchema } from './canvas.ts';

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
