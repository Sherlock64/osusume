import type { CatalogRequest, CatalogRequestStatus } from '@osusume/shared';
import { createRoute, Link } from '@tanstack/react-router';
import { PageHeader } from '@/components/page-header';
import { EmptyState, LoadMore, QueryFallback } from '@/components/states';
import { TextLink } from '@/components/text-link';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { api } from '@/lib/api';
import { request } from '@/lib/api-request';
import { useCursorList } from '@/lib/pagination';
import { appRoute } from '@/routes/app';

const statuses: Record<
  CatalogRequestStatus,
  { label: string; variant: 'warning' | 'success' | 'destructive' }
> = {
  pending: { label: 'Pending', variant: 'warning' },
  approved: { label: 'Approved', variant: 'success' },
  rejected: { label: 'Rejected', variant: 'destructive' },
};

function RequestRow({ item }: { item: CatalogRequest }) {
  const { proposal, seriesId, seriesTitle } = item;
  const title = proposal.kind === 'new_series' ? proposal.series.title : proposal.season.title;
  const tags = proposal.suggestedTags ?? [];
  return (
    <li className="grid gap-x-8 gap-y-2 py-4 md:grid-cols-2">
      <div className="min-w-0">
        <div className="flex items-start justify-between gap-x-4">
          <h2 className="min-w-0 text-base font-medium wrap-anywhere">{title}</h2>
          <Badge variant={statuses[item.status].variant}>{statuses[item.status].label}</Badge>
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
      </div>
      {(tags.length > 0 || item.decisionNote !== null) && (
        <div className="flex min-w-0 flex-col gap-2 text-sm">
          {tags.length > 0 && (
            <p className="text-muted-foreground wrap-anywhere">Suggested tags: {tags.join(', ')}</p>
          )}
          {item.decisionNote !== null && (
            <div className="border-l-2 pl-3">
              <p className="eyebrow">Admin's note</p>
              <p className="wrap-anywhere whitespace-pre-wrap">{item.decisionNote}</p>
            </div>
          )}
        </div>
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
      <PageHeader
        title="My requests"
        description="Series and seasons you've asked an admin to add."
        actions={
          <Link to="/requests/new" className={buttonVariants()}>
            Request an addition
          </Link>
        }
      />
      {query.data === undefined ?
        <QueryFallback query={query} />
      : items.length === 0 ?
        <EmptyState title="You haven't requested anything yet">
          Missing a series or a season from the catalog? Ask for it, and an admin decides.
        </EmptyState>
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
