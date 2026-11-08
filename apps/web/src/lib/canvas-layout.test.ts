import { describe, expect, it } from 'vitest';
import {
  footprint,
  drawnGroupBox,
  groupBox,
  NODE_HEIGHT,
  NODE_WIDTH,
  nudgeGroup,
  nudgeSeries,
  overlaps as rectsOverlap,
  placeInGroup,
  placeNodes,
  type LayoutState,
  type PlaceableNode,
  type Point,
} from './canvas-layout';

const loose = (seriesId: string): PlaceableNode => ({ seriesId, x: null, y: null });

function overlaps(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.abs(a.x - b.x) < NODE_WIDTH && Math.abs(a.y - b.y) < NODE_HEIGHT;
}

function first<T>(items: readonly T[], index = 0): T {
  const item = items[index];
  if (item === undefined) throw new Error('missing item');
  return item;
}

describe('placeNodes', () => {
  it('places unpositioned nodes without overlap, across rows', () => {
    const placed = placeNodes(Array.from({ length: 30 }, (_, index) => loose(`s${String(index)}`)));
    expect(placed.every((node) => node.placed)).toBe(true);
    for (const [index, node] of placed.entries()) {
      for (const other of placed.slice(index + 1)) expect(overlaps(node, other)).toBe(false);
    }
  });

  it('is deterministic', () => {
    const nodes = [loose('a'), { seriesId: 'b', x: 100, y: 50 }, loose('c')];
    expect(placeNodes(nodes)).toEqual(placeNodes(nodes));
  });

  it('keeps existing positions and avoids them', () => {
    const placed = placeNodes([{ seriesId: 'a', x: 10, y: 20 }, loose('b'), loose('c')]);
    expect(first(placed)).toEqual({ seriesId: 'a', x: 10, y: 20, placed: false });
    for (const node of placed.slice(1)) {
      expect(node.placed).toBe(true);
      expect(overlaps(node, first(placed))).toBe(false);
    }
    expect(overlaps(first(placed, 1), first(placed, 2))).toBe(false);
  });

  it('places a node with only one coordinate, and skips cells taken by later existing nodes', () => {
    const placed = placeNodes([{ seriesId: 'a', x: 5, y: null }, { seriesId: 'b', x: 0, y: 0 }]);
    expect(first(placed).placed).toBe(true);
    expect(overlaps(first(placed), first(placed, 1))).toBe(false);
  });

  it('takes the origin on an empty canvas', () => {
    expect(placeNodes([loose('a')])).toEqual([{ seriesId: 'a', x: 0, y: 0, placed: true }]);
  });
});

function state(positions: Record<string, Point>, groupOf: Record<string, string> = {}): LayoutState {
  return { positions: new Map(Object.entries(positions)), groupOf: new Map(Object.entries(groupOf)) };
}

function box(s: LayoutState, groupId: string) {
  const members = [...s.groupOf].filter(([, g]) => g === groupId).map(([id]) => s.positions.get(id));
  const result = groupBox(members.filter((p) => p !== undefined));
  if (!result) throw new Error('empty group');
  return result;
}

/** True when `id` at `p` overlaps no other bubble's footprint. */
function clearOfBubbles(s: LayoutState, id: string, p: Point) {
  return [...s.positions].every(([other, q]) => other === id || !rectsOverlap(footprint(p), footprint(q)));
}

describe('footprint and overlaps', () => {
  it('centres the plate under the star and lets edges touch', () => {
    expect(footprint({ x: 100, y: 10 })).toEqual({ x: 52, y: 10, width: 224, height: 236 });
    expect(rectsOverlap(footprint({ x: 0, y: 0 }), footprint({ x: NODE_WIDTH, y: 0 }))).toBe(false);
    expect(rectsOverlap(footprint({ x: 0, y: 0 }), footprint({ x: NODE_WIDTH - 1, y: 0 }))).toBe(true);
  });

  it('pads a group box and is null when empty', () => {
    expect(groupBox([])).toBeNull();
    expect(groupBox([{ x: 48, y: 24 }])).toEqual({ x: -24, y: 0, width: 272, height: 284 });
  });

  it('draws the box down to the lowest title only, never past groupBox', () => {
    expect(drawnGroupBox([])).toBeNull();
    // One line: 24 above the star, 24 below its plate (155 + 30).
    expect(drawnGroupBox([{ x: 48, y: 24, title: 'Bleach' }])).toEqual({ x: -24, y: 0, width: 272, height: 233 });
    expect(drawnGroupBox([{ x: 48, y: 24, title: 'A'.repeat(60) }])).toEqual(groupBox([{ x: 48, y: 24 }]));
  });
});

describe('nudgeSeries', () => {
  it('keeps a free drop point', () => {
    const s = state({ a: { x: 0, y: 0 }, b: { x: 1000, y: 0 } });
    expect(nudgeSeries(s, 'a', { x: 400, y: 50 })).toEqual({ x: 400, y: 50 });
  });

  it('moves off a bubble it was dropped on, within 260 units', () => {
    const s = state({ a: { x: 0, y: 0 }, b: { x: 500, y: 300 } });
    const drop = { x: 500, y: 300 };
    const p = nudgeSeries(s, 'a', drop);
    expect(clearOfBubbles(s, 'a', p)).toBe(true);
    expect(Math.hypot(p.x - drop.x, p.y - drop.y)).toBeLessThanOrEqual(260);
  });

  it('leaves a gap too small for it, and moves nothing else', () => {
    const s = state({ a: { x: 0, y: -1000 }, l: { x: 0, y: 0 }, r: { x: NODE_WIDTH + 100, y: 0 } });
    const before = new Map(s.positions);
    const p = nudgeSeries(s, 'a', { x: NODE_WIDTH / 2 + 50, y: 0 });
    expect(clearOfBubbles(s, 'a', p)).toBe(true);
    expect(s.positions).toEqual(before);
  });

  it('pushes a non-member out of a group box', () => {
    const s = state({ m1: { x: 0, y: 0 }, m2: { x: 300, y: 0 }, a: { x: 0, y: 1000 } }, { m1: 'g', m2: 'g' });
    const p = nudgeSeries(s, 'a', { x: 150, y: 0 });
    expect(rectsOverlap(footprint(p), box(s, 'g'))).toBe(false);
  });

  it('moves a member until its refitted box covers no outsider', () => {
    const s = state({ m1: { x: 0, y: 0 }, m2: { x: 0, y: 1000 }, o: { x: 600, y: 0 } }, { m1: 'g', m2: 'g' });
    // Free for the bubble itself, but the box would then span over o.
    const p = nudgeSeries(s, 'm2', { x: 600, y: 300 });
    expect(p).not.toEqual({ x: 600, y: 300 });
    const moved = state({ ...Object.fromEntries(s.positions), m2: p }, { m1: 'g', m2: 'g' });
    expect(rectsOverlap(box(moved, 'g'), footprint({ x: 600, y: 0 }))).toBe(false);
  });

  it('gives up on a packed map within budget for a thousand bubbles, keeping the drop', () => {
    const positions: Record<string, Point> = {};
    for (let i = 0; i < 1000; i++) positions[`s${String(i)}`] = { x: (i % 40) * 250, y: Math.floor(i / 40) * 260 };
    const started = performance.now();
    // A 40 x 25 grid at 250 x 260 pitch: every spot within the 2000 search radius is taken.
    expect(nudgeSeries(state(positions), 's0', { x: 5000, y: 3120 })).toEqual({ x: 5000, y: 3120 });
    expect(performance.now() - started).toBeLessThan(500);
  });
});

describe('nudgeGroup', () => {
  it('moves clear of an outsider and of another box', () => {
    const s = state(
      { m: { x: 0, y: 0 }, o: { x: 400, y: 0 }, h: { x: 0, y: 400 } },
      { m: 'g', h: 'h' },
    );
    for (const target of [{ x: 400, y: 0 }, { x: 0, y: 400 }]) {
      const d = nudgeGroup(s, 'g', target);
      const moved = state({ ...Object.fromEntries(s.positions), m: d }, { m: 'g', h: 'h' });
      expect(rectsOverlap(box(moved, 'g'), footprint({ x: 400, y: 0 }))).toBe(false);
      expect(rectsOverlap(box(moved, 'g'), box(moved, 'h'))).toBe(false);
    }
  });

  it('keeps a free delta', () => {
    const s = state({ m: { x: 0, y: 0 }, o: { x: 2000, y: 0 } }, { m: 'g' });
    expect(nudgeGroup(s, 'g', { x: 100, y: 100 })).toEqual({ x: 100, y: 100 });
  });
});

describe('placeInGroup', () => {
  it('finds a spot overlapping nothing, with a box that covers no outsider', () => {
    const groupOf = { m1: 'g', m2: 'g', n: 'g' };
    const s = state({ m1: { x: 0, y: 0 }, m2: { x: 300, y: 0 }, o: { x: 0, y: 300 }, n: { x: 3000, y: 3000 } }, groupOf);
    const p = placeInGroup(s, 'n', 'g');
    expect(clearOfBubbles(s, 'n', p)).toBe(true);
    const moved = state({ ...Object.fromEntries(s.positions), n: p }, groupOf);
    expect(rectsOverlap(box(moved, 'g'), footprint({ x: 0, y: 300 }))).toBe(false);
    expect(Math.hypot(p.x - 150, p.y)).toBeLessThan(700);
  });

  it('never stacks members in a crowded grid where no refitted box fits', () => {
    const positions: Record<string, Point> = {};
    for (let i = 0; i < 64; i++) positions[`s${String(i)}`] = { x: (i % 8) * 250, y: Math.floor(i / 8) * 260 };
    const groupOf: Record<string, string> = { s27: 'g' };
    for (const id of ['n1', 'n2']) {
      positions[id] = { x: 9000, y: 9000 };
      groupOf[id] = 'g';
      const s = state(positions, groupOf);
      positions[id] = placeInGroup(s, id, 'g');
      expect(clearOfBubbles(state(positions, groupOf), id, positions[id])).toBe(true);
    }
  });
});

describe('placeNodes with obstacles', () => {
  it('never places a bubble overlapping a group box', () => {
    const obstacle = { x: -50, y: -50, width: 800, height: 600 };
    const placed = placeNodes(Array.from({ length: 20 }, (_, i) => loose(`s${String(i)}`)), [obstacle]);
    for (const node of placed) expect(rectsOverlap(footprint(node), obstacle)).toBe(false);
  });
});
