import { describe, expect, it } from 'vitest';
import { NODE_HEIGHT, NODE_WIDTH, placeNodes, type PlaceableNode } from './canvas-layout';

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
