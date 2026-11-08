/** Footprint of a canvas node in canvas units: its cover circle and the title plate under it (up to three lines, 224 wide). */
export const NODE_WIDTH = 224;
export const NODE_HEIGHT = 236;

const GRID_GAP = 24;
const CELL_WIDTH = NODE_WIDTH + GRID_GAP;
const CELL_HEIGHT = NODE_HEIGHT + GRID_GAP;
const GRID_COLUMNS = 8;

export interface PlaceableNode {
  seriesId: string;
  x: number | null;
  y: number | null;
}

export interface PlacedNode {
  seriesId: string;
  x: number;
  y: number;
  /** True when this call chose the position, rather than the node already having one. */
  placed: boolean;
}

/**
 * Gives every node a position. Nodes that have one keep it; the others, in the given order, take
 * the first cell of a tidy grid (left to right, top to bottom) that overlaps no node placed so far
 * and no obstacle rect (group boxes).
 */
export function placeNodes(nodes: readonly PlaceableNode[], obstacles: readonly Rect[] = []): PlacedNode[] {
  const blocked = new Set<string>();
  const block = (x: number, y: number) => {
    // A cell's node overlaps this one when their origins are closer than a footprint on both axes.
    const firstColumn = Math.floor((x - NODE_WIDTH) / CELL_WIDTH) + 1;
    const lastColumn = Math.ceil((x + NODE_WIDTH) / CELL_WIDTH) - 1;
    const firstRow = Math.floor((y - NODE_HEIGHT) / CELL_HEIGHT) + 1;
    const lastRow = Math.ceil((y + NODE_HEIGHT) / CELL_HEIGHT) - 1;
    for (let column = firstColumn; column <= lastColumn; column++) {
      for (let row = firstRow; row <= lastRow; row++) blocked.add(`${String(column)},${String(row)}`);
    }
  };

  for (const node of nodes) {
    if (node.x !== null && node.y !== null) block(node.x, node.y);
  }

  let cell = 0;
  return nodes.map((node) => {
    if (node.x !== null && node.y !== null) {
      return { seriesId: node.seriesId, x: node.x, y: node.y, placed: false };
    }
    let column: number;
    let row: number;
    do {
      column = cell % GRID_COLUMNS;
      row = Math.floor(cell / GRID_COLUMNS);
      cell++;
    } while (
      blocked.has(`${String(column)},${String(row)}`) ||
      hitsAny(footprint({ x: column * CELL_WIDTH, y: row * CELL_HEIGHT }), obstacles)
    );
    const x = column * CELL_WIDTH;
    const y = row * CELL_HEIGHT;
    block(x, y);
    return { seriesId: node.seriesId, x, y, placed: true };
  });
}

export interface Point {
  x: number;
  y: number;
}
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}
export const GROUP_PADDING = 24;

/** Offset of the footprint's left edge from the node position: the title plate is centred under the 128 px star. */
const FOOTPRINT_OFFSET_X = (NODE_WIDTH - 128) / 2;
const RING_STEP = 16;
const MAX_RADIUS = 2000;

export function footprint(p: Point): Rect {
  return { x: p.x - FOOTPRINT_OFFSET_X, y: p.y, width: NODE_WIDTH, height: NODE_HEIGHT };
}

/** Positive-area intersection; touching edges do not overlap. */
export function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

function hitsAny(rect: Rect, others: readonly Rect[]): boolean {
  return others.some((other) => overlaps(rect, other));
}

function union(a: Rect, b: Rect): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, width: Math.max(a.x + a.width, b.x + b.width) - x, height: Math.max(a.y + a.height, b.y + b.height) - y };
}

function pad(rect: Rect): Rect {
  return {
    x: rect.x - GROUP_PADDING,
    y: rect.y - GROUP_PADDING,
    width: rect.width + 2 * GROUP_PADDING,
    height: rect.height + 2 * GROUP_PADDING,
  };
}

function unpaddedBox(members: readonly Point[]): Rect | null {
  return members.reduce<Rect | null>((box, p) => (box ? union(box, footprint(p)) : footprint(p)), null);
}

/** Union of the members' footprints plus GROUP_PADDING on every side; null when empty. */
export function groupBox(members: readonly Point[]): Rect | null {
  const box = unpaddedBox(members);
  return box && pad(box);
}

/** Where a title's plate starts under its node (star, gap, plate padding and outline), and its line height. */
const TITLE_TOP = 155;
const TITLE_LINE = 30;
const TITLE_CHARS_PER_LINE = 13;

/** Lines a title wraps to under its star, erring high; wide (CJK) characters count double. */
export function titleLines(title: string): number {
  const width = title.length + (title.match(/[\u2e80-\uffff]/g)?.length ?? 0);
  return Math.min(3, Math.max(1, Math.ceil(width / TITLE_CHARS_PER_LINE)));
}

/**
 * The box as drawn: groupBox with its bottom pulled up to the lowest title plus GROUP_PADDING, since the
 * footprint reserves three title lines. Never larger than groupBox, so the overlap rules still hold.
 * shortcut: titles are measured by character count, not the DOM; measure the plates if boxes clip titles.
 */
export function drawnGroupBox(members: readonly (Point & { title: string })[]): Rect | null {
  const box = groupBox(members);
  if (!box) return null;
  const bottom = Math.max(...members.map((m) => m.y + TITLE_TOP + TITLE_LINE * titleLines(m.title))) + GROUP_PADDING;
  return { ...box, height: Math.min(box.height, bottom - box.y) };
}

export interface LayoutState {
  positions: ReadonlyMap<string, Point>;
  groupOf: ReadonlyMap<string, string>;
}

/** Rings of growing radius around `start`, nearest first; the first sample `isFree` accepts, else `start`. */
function nearestFree(start: Point, isFree: (p: Point) => boolean): Point {
  if (isFree(start)) return start;
  for (let radius = RING_STEP; radius <= MAX_RADIUS; radius += RING_STEP) {
    const samples = Math.ceil((2 * Math.PI * radius) / RING_STEP);
    for (let i = 0; i < samples; i++) {
      const angle = (2 * Math.PI * i) / samples;
      const p = { x: Math.round(start.x + radius * Math.cos(angle)), y: Math.round(start.y + radius * Math.sin(angle)) };
      if (isFree(p)) return p;
    }
  }
  return start;
}

/** Member positions of every group, optionally leaving one series out. */
function membersByGroup(state: LayoutState, without?: string): Map<string, Point[]> {
  const groups = new Map<string, Point[]>();
  for (const [seriesId, groupId] of state.groupOf) {
    const p = state.positions.get(seriesId);
    if (!p || seriesId === without) continue;
    const list = groups.get(groupId);
    if (list) list.push(p);
    else groups.set(groupId, [p]);
  }
  return groups;
}

/** Footprints of bubbles not in `groupId` (all bubbles but `without` when `groupId` is undefined). */
function outsiderFootprints(state: LayoutState, groupId: string | undefined, without?: string): Rect[] {
  const rects: Rect[] = [];
  for (const [seriesId, p] of state.positions) {
    if (seriesId === without) continue;
    if (groupId !== undefined && state.groupOf.get(seriesId) === groupId) continue;
    rects.push(footprint(p));
  }
  return rects;
}

function otherGroupBoxes(groups: Map<string, Point[]>, groupId: string | undefined): Rect[] {
  const boxes: Rect[] = [];
  for (const [id, members] of groups) {
    const box = id === groupId ? null : groupBox(members);
    if (box) boxes.push(box);
  }
  return boxes;
}

/** The free test for one bubble (feature 3), with obstacle rects built once. */
function seriesFreeTest(state: LayoutState, seriesId: string): (p: Point) => boolean {
  const groupId = state.groupOf.get(seriesId);
  const groups = membersByGroup(state, seriesId);
  const bubbles = outsiderFootprints(state, undefined, seriesId);
  const boxes = otherGroupBoxes(groups, groupId);
  if (groupId === undefined) return (p) => !hitsAny(footprint(p), bubbles) && !hitsAny(footprint(p), boxes);
  const outsiders = outsiderFootprints(state, groupId, seriesId);
  const rest = unpaddedBox(groups.get(groupId) ?? []);
  return (p) => {
    const own = footprint(p);
    if (hitsAny(own, bubbles) || hitsAny(own, boxes)) return false;
    const box = pad(rest ? union(rest, own) : own);
    return !hitsAny(box, outsiders) && !hitsAny(box, boxes);
  };
}

/** Where a bubble dropped at `drop` ends up (feature 3 rules). */
export function nudgeSeries(state: LayoutState, seriesId: string, drop: Point): Point {
  return nearestFree(drop, seriesFreeTest(state, seriesId));
}

/** The delta a group dragged by `delta` ends up moving by. */
export function nudgeGroup(state: LayoutState, groupId: string, delta: Point): Point {
  const groups = membersByGroup(state);
  const box = groupBox(groups.get(groupId) ?? []);
  if (!box) return delta;
  const outsiders = outsiderFootprints(state, groupId);
  const boxes = otherGroupBoxes(groups, groupId);
  return nearestFree(delta, (d) => {
    const moved = { ...box, x: box.x + d.x, y: box.y + d.y };
    return !hitsAny(moved, outsiders) && !hitsAny(moved, boxes);
  });
}

/** Where a series just added to `groupId` goes: nearest free spot to the group's box centre. */
export function placeInGroup(state: LayoutState, seriesId: string, groupId: string): Point {
  const box = groupBox(membersByGroup(state, seriesId).get(groupId) ?? []);
  const start = box
    ? {
        x: Math.round(box.x + box.width / 2 - NODE_WIDTH / 2 + FOOTPRINT_OFFSET_X),
        y: Math.round(box.y + box.height / 2 - NODE_HEIGHT / 2),
      }
    : (state.positions.get(seriesId) ?? { x: 0, y: 0 });
  return nearestFree(start, seriesFreeTest(state, seriesId));
}
