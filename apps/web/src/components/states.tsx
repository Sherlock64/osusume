import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { toApiError } from '@/lib/api-request';

export function LoadingState({ label = 'Loading…' }: { label?: string }) {
  return (
    <p role="status" className="text-muted-foreground py-8 text-center text-sm">
      {label}
    </p>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="py-8 text-center">
      <p className="font-medium">{title}</p>
      {children !== undefined && <div className="text-muted-foreground mt-1 text-sm">{children}</div>}
    </div>
  );
}

/** A failed load, with the api's message. Pass `onRetry` if trying again could help. */
export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: (() => void) | undefined }) {
  return (
    <div role="alert" className="py-8 text-center">
      <p className="font-medium">{toApiError(error).message}</p>
      {onRetry !== undefined && (
        <Button variant="outline" className="mt-3" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

interface LoadMoreQuery {
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  fetchNextPage: () => unknown;
}

/** The next-page button for `useCursorList`. Renders nothing on the last page. */
export function LoadMore({ query }: { query: LoadMoreQuery }) {
  if (!query.hasNextPage) return null;
  return (
    <div className="pt-4 text-center">
      <Button
        variant="outline"
        disabled={query.isFetchingNextPage}
        onClick={() => {
          query.fetchNextPage();
        }}
      >
        {query.isFetchingNextPage ? 'Loading…' : 'Load more'}
      </Button>
    </div>
  );
}
