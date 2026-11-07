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
 * the first cell of a tidy grid (left to right, top to bottom) that overlaps no node placed so far.
 */
export function placeNodes(nodes: readonly PlaceableNode[]): PlacedNode[] {
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
    } while (blocked.has(`${String(column)},${String(row)}`));
    const x = column * CELL_WIDTH;
    const y = row * CELL_HEIGHT;
    block(x, y);
    return { seriesId: node.seriesId, x, y, placed: true };
  });
}
