import { listStatuses, listStatusSchema, type ListStatus, listStatusLabels } from '@osusume/shared';
import { createRoute, Link } from '@tanstack/react-router';
import { z } from 'zod';
import { ListSeriesGrid } from '@/components/list-series';
import { PageHeader } from '@/components/page-header';
import { EmptyState, LoadMore, QueryFallback } from '@/components/states';
import { StatusBadge } from '@/components/status-badge';
import { TextLink } from '@/components/text-link';
import { buttonVariants } from '@/components/ui/button';
import { api } from '@/lib/api';
import { request } from '@/lib/api-request';
import { ownListKey } from '@/lib/own-list';
import { useCursorList } from '@/lib/pagination';
import { cn } from '@/lib/utils';
import { appRoute } from '@/routes/app';

function StatusFilter({ current }: { current: ListStatus | undefined }) {
  return (
    <nav aria-label="Filter by status" className="mb-6 flex flex-wrap gap-2">
      {[undefined, ...listStatuses].map((status) => (
        <Link
          key={status ?? 'all'}
          to="/"
          search={status === undefined ? {} : { status }}
          aria-current={status === current ? 'true' : undefined}
          className={buttonVariants({ variant: status === current ? 'default' : 'outline', size: 'sm' })}
        >
          {status === undefined ?
            'All'
          : <StatusBadge
              status={status}
              // Gold is a fill for dark text, so the chosen chip drops the status colour; its icon stays.
              className={cn('border-0 bg-transparent px-0', status === current && 'text-primary-foreground')}
            />
          }
        </Link>
      ))}
    </nav>
  );
}

function MyListPage() {
  const { status } = homeRoute.useSearch();
  const { query, items } = useCursorList({
    queryKey: [...ownListKey, 'page', status ?? 'all'],
    fetchPage: (cursor) =>
      request(
        api.me.list.$get({
          query: {
            ...(cursor === undefined ? {} : { cursor }),
            ...(status === undefined ? {} : { status }),
          },
        }),
      ),
  });

  return (
    <>
      <PageHeader
        title="My list"
        className="mb-4"
        actions={
          <Link to="/catalog" className={buttonVariants({ variant: 'outline' })}>
            Browse the catalog
          </Link>
        }
      />
      <StatusFilter current={status} />
      {query.data === undefined ?
        <QueryFallback query={query} />
      : items.length === 0 ?
        status === undefined ?
          <EmptyState title="Your list is empty">
            <TextLink to="/catalog">Find something in the catalog</TextLink>
          </EmptyState>
        : <EmptyState title={`Nothing is marked ${listStatusLabels[status].toLowerCase()}`}>
            <TextLink to="/">Show the whole list</TextLink>
          </EmptyState>
      : <ListSeriesGrid series={items} />
      }
      <LoadMore query={query} />
    </>
  );
}

export const homeRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/',
  validateSearch: z.object({ status: listStatusSchema.optional().catch(undefined) }),
  component: MyListPage,
});
