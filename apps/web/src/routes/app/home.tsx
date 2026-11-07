import { listStatuses, listStatusSchema, type ListStatus, listStatusLabels } from '@osusume/shared';
import { createRoute, Link } from '@tanstack/react-router';
import { z } from 'zod';
import { ListSeries } from '@/components/list-series';
import { EmptyState, LoadMore, QueryFallback } from '@/components/states';
import { TextLink } from '@/components/text-link';
import { buttonVariants } from '@/components/ui/button';
import { api } from '@/lib/api';
import { request } from '@/lib/api-request';
import { ownListKey } from '@/lib/own-list';
import { useCursorList } from '@/lib/pagination';
import { appRoute } from '@/routes/app';

function StatusFilter({ current }: { current: ListStatus | undefined }) {
  const options = [
    { status: undefined, label: 'All' },
    ...listStatuses.map((status) => ({ status, label: listStatusLabels[status] })),
  ];
  return (
    <nav aria-label="Filter by status" className="mb-2 flex flex-wrap gap-2">
      {options.map(({ status, label }) => (
        <Link
          key={label}
          to="/"
          search={status === undefined ? {} : { status }}
          aria-current={status === current ? 'true' : undefined}
          className={buttonVariants({ variant: status === current ? 'default' : 'outline', size: 'sm' })}
        >
          {label}
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
      <h1 className="mb-4 text-xl font-semibold">My list</h1>
      <StatusFilter current={status} />
      {query.data === undefined ?
        <QueryFallback query={query} />
      : items.length === 0 ?
        status === undefined ?
          <EmptyState title="Your list is empty">
            <TextLink to="/catalog">Find something in the catalog</TextLink>
          </EmptyState>
        : <EmptyState title={`Nothing is marked ${listStatusLabels[status].toLowerCase()}`} />
      : <ul className="divide-y">
          {items.map((series) => (
            <ListSeries key={series.seriesId} series={series} />
          ))}
        </ul>
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
