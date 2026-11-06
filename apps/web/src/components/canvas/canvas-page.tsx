import type { CanvasLink, CanvasResponse } from '@osusume/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RecommendationCanvas } from '@/components/canvas/recommendation-canvas';
import { EmptyState, QueryFallback } from '@/components/states';
import { api } from '@/lib/api';
import { CANVAS_LABEL } from '@/lib/canvas-label';
import { isNotFoundError, request, toApiError } from '@/lib/api-request';
import {
  canvasQuery,
  savePositions,
  withLink,
  withoutLink,
  withPositions,
} from '@/lib/canvas';

/**
 * Runs a write against the cached canvas straight away, and puts the cache back if it fails. The
 * rollback is the snapshot taken just before, and a refetch settles whatever overlapped it.
 */
function useCanvasWrite<Variables>(
  username: string,
  options: { apply: (canvas: CanvasResponse, variables: Variables) => CanvasResponse; save: (variables: Variables) => Promise<unknown> },
) {
  const queryClient = useQueryClient();
  const key = canvasQuery(username).queryKey;
  return useMutation({
    mutationFn: options.save,
    onMutate: async (variables: Variables) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData(key);
      queryClient.setQueryData(key, (canvas) => (canvas ? options.apply(canvas, variables) : canvas));
      return { previous };
    },
    onError: (_error, _variables, context) => {
      queryClient.setQueryData(key, context?.previous);
      // Overlapping writes can leave the snapshot stale, so take the server's word.
      void queryClient.invalidateQueries({ queryKey: key });
    },
  });
}

export function CanvasPage({ username, editable }: { username: string; editable: boolean }) {
  const query = useQuery(canvasQuery(username));
  const move = useCanvasWrite(username, {
    apply: (canvas, positions: { seriesId: string; x: number; y: number }[]) => withPositions(canvas, positions),
    save: savePositions,
  });
  const setLink = useCanvasWrite(username, {
    apply: withLink,
    save: (link: CanvasLink) => request(api.me.canvas.links.$put({ json: link })),
  });
  const removeLink = useCanvasWrite(username, {
    apply: (canvas, pair: { seriesAId: string; seriesBId: string }) =>
      withoutLink(canvas, pair.seriesAId, pair.seriesBId),
    save: (pair) => request(api.me.canvas.links.$delete({ query: pair })),
  });

  // The same for a missing user, a disabled one or a hidden list: nothing here may tell them apart.
  if (query.isError && isNotFoundError(query.error)) return <EmptyState title={`${CANVAS_LABEL} not found`} />;
  if (query.data === undefined) return <QueryFallback query={query} />;

  const failedWrite = [move, setLink, removeLink].find((write) => write.isError);
  return (
    <>
      <h1 className="mb-4 text-xl font-semibold wrap-anywhere">
        {username}&apos;s {CANVAS_LABEL.toLowerCase()}
      </h1>
      {failedWrite !== undefined && (
        <p role="alert" className="text-destructive mb-2 text-sm">
          {toApiError(failedWrite.error).message}
        </p>
      )}
      {query.data.nodes.length === 0 ?
        <EmptyState title={`No ${CANVAS_LABEL.toLowerCase()} yet`}>
          {editable ?
            'Series you watch will appear here.'
          : `${username} has no series on their list yet.`}
        </EmptyState>
      : <div className="h-[calc(100svh-13rem)] min-h-96">
          <RecommendationCanvas
            nodes={query.data.nodes}
            links={query.data.links}
            editable={editable}
            onMoveNodes={(positions) => {
              move.mutate(positions);
            }}
            onSetLink={(link) => {
              setLink.mutate(link);
            }}
            onRemoveLink={(seriesAId, seriesBId) => {
              removeLink.mutate({ seriesAId, seriesBId });
            }}
          />
        </div>
      }
    </>
  );
}
