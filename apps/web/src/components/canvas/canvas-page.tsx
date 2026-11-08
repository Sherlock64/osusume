import type { CanvasLink, CanvasResponse } from '@osusume/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RecommendationCanvas } from '@/components/canvas/recommendation-canvas';
import { PageHeader } from '@/components/page-header';
import { EmptyState, QueryFallback } from '@/components/states';
import { TextLink } from '@/components/text-link';
import { Alert } from '@/components/ui/alert';
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

/** A group write: not optimistic, so the canvas is fetched again once it lands. */
function useGroupWrite<Variables>(username: string, save: (variables: Variables) => Promise<unknown>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: save,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: canvasQuery(username).queryKey }),
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

  const createGroup = useGroupWrite(username, (json: { name: string; seriesId: string }) =>
    request(api.me.canvas.groups.$post({ json })),
  );
  const renameGroup = useGroupWrite(username, ({ groupId, name }: { groupId: string; name: string }) =>
    request(api.me.canvas.groups[':groupId'].$patch({ param: { groupId }, json: { name } })),
  );
  const deleteGroup = useGroupWrite(username, (groupId: string) =>
    request(api.me.canvas.groups[':groupId'].$delete({ param: { groupId } })),
  );
  const addToGroup = useGroupWrite(
    username,
    async ({ groupId, seriesId, x, y }: { groupId: string; seriesId: string; x: number; y: number }) => {
      await request(api.me.canvas.groups[':groupId'].series[':seriesId'].$put({ param: { groupId, seriesId } }));
      await savePositions([{ seriesId, x, y }]);
    },
  );
  const removeFromGroup = useGroupWrite(username, (param: { groupId: string; seriesId: string }) =>
    request(api.me.canvas.groups[':groupId'].series[':seriesId'].$delete({ param })),
  );

  // The same for a missing user, a disabled one or a hidden list: nothing here may tell them apart.
  if (query.isError && isNotFoundError(query.error)) return <EmptyState title={`${CANVAS_LABEL} not found`} />;
  if (query.data === undefined) return <QueryFallback query={query} />;

  const title = `${username}'s ${CANVAS_LABEL.toLowerCase()}`;
  const { nodes, links, groups } = query.data;
  if (nodes.length === 0) {
    return (
      <>
        <PageHeader title={title} />
        <EmptyState title={`No ${CANVAS_LABEL.toLowerCase()} yet`}>
          {editable ?
            <>
              Series you start watching appear here as stars, ready to be joined up.{' '}
              <TextLink to="/catalog">Find something in the catalog</TextLink>
            </>
          : `${username} hasn't started anything on their list yet.`}
        </EmptyState>
      </>
    );
  }

  // A failed delete shows in its confirm dialog instead.
  const failedWrite = [move, setLink, removeLink, createGroup, renameGroup, addToGroup, removeFromGroup].find(
    (write) => write.isError,
  );
  return (
    // The canvas takes the whole viewport under the shell's 56px header. Fixed, so a classic scrollbar can't add sideways scroll.
    <div className="fixed inset-x-0 top-14 bottom-0">
      <RecommendationCanvas
        username={username}
        nodes={nodes}
        links={links}
        groups={groups}
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
        onCreateGroup={(name, seriesId) => {
          createGroup.mutate({ name, seriesId });
        }}
        onRenameGroup={(groupId, name) => {
          renameGroup.mutate({ groupId, name });
        }}
        onDeleteGroup={(groupId) => deleteGroup.mutateAsync(groupId)}
        onAddToGroup={(groupId, seriesId, { x, y }) => {
          addToGroup.mutate({ groupId, seriesId, x, y });
        }}
        onRemoveFromGroup={(groupId, seriesId) => {
          removeFromGroup.mutate({ groupId, seriesId });
        }}
      />
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex flex-col items-start gap-2 p-4">
        <div className="bg-card pointer-events-auto max-w-full rounded-lg border px-3 py-2">
          <h1 className="text-xl leading-tight font-medium wrap-anywhere sm:text-2xl">{title}</h1>
          <p className="text-muted-foreground mt-0.5 text-xs">
            {nodes.length} series, {links.length} {links.length === 1 ? 'line' : 'lines'}
            {!editable && (
              <>
                {' · '}
                <TextLink to="/users/$username" params={{ username }} className="text-xs">
                  See the list
                </TextLink>
              </>
            )}
          </p>
        </div>
        {failedWrite !== undefined && (
          <Alert variant="destructive" className="bg-card pointer-events-auto max-w-md">
            {toApiError(failedWrite.error).message}
          </Alert>
        )}
      </div>
    </div>
  );
}
