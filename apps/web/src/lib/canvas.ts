import { CANVAS_POSITIONS_MAX, type CanvasLink, type CanvasResponse } from '@osusume/shared';
import { queryOptions } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { request } from '@/lib/api-request';

export const canvasQuery = (username: string) =>
  queryOptions({
    queryKey: ['canvas', username],
    queryFn: () => request(api.users[':username'].canvas.$get({ param: { username } })),
    // A series added to the list since the last visit must show up.
    staleTime: 0,
    refetchOnMount: 'always',
  });

type Position = { seriesId: string; x: number; y: number };

export function withPositions(canvas: CanvasResponse, positions: readonly Position[]): CanvasResponse {
  const moved = new Map(positions.map((position) => [position.seriesId, position]));
  return {
    ...canvas,
    nodes: canvas.nodes.map((node) => {
      const position = moved.get(node.seriesId);
      return position === undefined ? node : { ...node, x: position.x, y: position.y };
    }),
  };
}

/** A pair is unordered, so the link is found whichever way round it is given. */
function samePair(link: CanvasLink, a: string, b: string) {
  return (
    (link.seriesAId === a && link.seriesBId === b) || (link.seriesAId === b && link.seriesBId === a)
  );
}

export function withLink(canvas: CanvasResponse, next: CanvasLink): CanvasResponse {
  const exists = canvas.links.some((link) => samePair(link, next.seriesAId, next.seriesBId));
  return {
    ...canvas,
    links:
      exists ?
        canvas.links.map((link) => (samePair(link, next.seriesAId, next.seriesBId) ? { ...link, kind: next.kind } : link))
      : [...canvas.links, next],
  };
}

export function withoutLink(canvas: CanvasResponse, a: string, b: string): CanvasResponse {
  return { ...canvas, links: canvas.links.filter((link) => !samePair(link, a, b)) };
}

/** Saves positions, in as many requests as the api's limit needs. */
export async function savePositions(positions: readonly Position[]): Promise<void> {
  for (let start = 0; start < positions.length; start += CANVAS_POSITIONS_MAX) {
    await request(
      api.me.canvas.positions.$put({
        json: { positions: positions.slice(start, start + CANVAS_POSITIONS_MAX) },
      }),
    );
  }
}
