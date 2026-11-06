import type { CatalogRequest, CatalogRequestStatus } from '@osusume/shared';
import { createRoute, Link } from '@tanstack/react-router';
import { EmptyState, LoadMore, QueryFallback } from '@/components/states';
import { TextLink } from '@/components/text-link';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { api } from '@/lib/api';
import { request } from '@/lib/api-request';
import { useCursorList } from '@/lib/pagination';
import { appRoute } from '@/routes/app';

const statusLabels: Record<CatalogRequestStatus, string> = {
  pending: 'Pending',
  approved: 'Approved',
  rejected: 'Rejected',
};

function RequestRow({ item }: { item: CatalogRequest }) {
  const { proposal, seriesId, seriesTitle } = item;
  const title = proposal.kind === 'new_series' ? proposal.series.title : proposal.season.title;
  const tags = proposal.suggestedTags ?? [];
  return (
    <li className="flex flex-col gap-1 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4">
        <h2 className="min-w-0 font-medium wrap-anywhere">{title}</h2>
        <Badge variant={item.status === 'rejected' ? 'destructive' : 'secondary'}>
          {statusLabels[item.status]}
        </Badge>
      </div>
      <p className="text-muted-foreground text-sm wrap-anywhere">
        {proposal.kind === 'new_series' ? 'New series' : 'New season for '}
        {proposal.kind === 'add_season' &&
          (seriesId === null ?
            (seriesTitle ?? 'a series no longer in the catalog')
          : <TextLink to="/series/$id" params={{ id: seriesId }}>
              {seriesTitle ?? 'this series'}
            </TextLink>)}
        {` · ${new Date(item.createdAt).toLocaleDateString()}`}
      </p>
      {tags.length > 0 && (
        <p className="text-muted-foreground text-sm wrap-anywhere">Suggested tags: {tags.join(', ')}</p>
      )}
      {item.decisionNote !== null && (
        <p className="text-sm wrap-anywhere whitespace-pre-wrap">Note: {item.decisionNote}</p>
      )}
    </li>
  );
}

function RequestsPage() {
  const { query, items } = useCursorList({
    queryKey: ['catalog-requests', 'mine'],
    fetchPage: (cursor) =>
      request(
        api['catalog-requests'].$get({
          query: { mine: 'true', ...(cursor === undefined ? {} : { cursor }) },
        }),
      ),
  });

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">My requests</h1>
        <Link to="/requests/new" className={buttonVariants()}>
          Request an addition
        </Link>
      </div>
      {query.data === undefined ?
        <QueryFallback query={query} />
      : items.length === 0 ?
        <EmptyState title="You haven't requested anything yet" />
      : <ul className="divide-y">
          {items.map((item) => (
            <RequestRow key={item.id} item={item} />
          ))}
        </ul>
      }
      <LoadMore query={query} />
    </>
  );
}

export const requestsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/requests',
  component: RequestsPage,
});
