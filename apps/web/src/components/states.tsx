import { TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { Constellation } from '@/components/logo-mark';
import { Button } from '@/components/ui/button';
import { toApiError } from '@/lib/api-request';

export function LoadingState({ label = 'Loading…' }: { label?: string }) {
  return (
    <p role="status" className="text-muted-foreground flex items-center gap-2.5 py-10 text-sm">
      <span className="bg-star size-1.5 animate-pulse rounded-full motion-reduce:animate-none" aria-hidden />
      {label}
    </p>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex items-center gap-5 py-10">
      <Constellation index={0} className="text-muted-foreground/60 size-16 shrink-0" />
      <div className="min-w-0">
        <p className="font-heading text-xl font-medium">{title}</p>
        {children !== undefined && <div className="text-muted-foreground mt-1 text-sm">{children}</div>}
      </div>
    </div>
  );
}

/** A failed load, with the api's message. Pass `onRetry` if trying again could help. */
export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: (() => void) | undefined }) {
  return (
    <div role="alert" className="flex items-start gap-3 py-10">
      <TriangleAlert className="text-destructive mt-0.5 size-5 shrink-0" aria-hidden />
      <div className="min-w-0">
        <p className="font-medium">{toApiError(error).message}</p>
        {onRetry !== undefined && (
          <Button variant="outline" className="mt-3" onClick={onRetry}>
            Try again
          </Button>
        )}
      </div>
    </div>
  );
}

/** Stands in for a query's data while it loads or after it fails. */
export function QueryFallback({
  query,
}: {
  query: { isError: boolean; error: unknown; refetch: () => unknown };
}) {
  if (!query.isError) return <LoadingState />;
  return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
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
    <div className="flex justify-center pt-6">
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
