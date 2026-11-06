import { createRoute } from '@tanstack/react-router';
import { ListSeries } from '@/components/list-series';
import { EmptyState, LoadMore, QueryFallback } from '@/components/states';
import { api } from '@/lib/api';
import { isNotFoundError, request } from '@/lib/api-request';
import { useCursorList } from '@/lib/pagination';
import { appRoute } from '@/routes/app';

function MemberListPage() {
  const { username } = memberListRoute.useParams();
  const { query, items } = useCursorList({
    queryKey: ['member-list', username],
    fetchPage: (cursor) =>
      request(
        api.users[':username'].list.$get({
          param: { username },
          query: cursor === undefined ? {} : { cursor },
        }),
      ),
  });

  // The same for a missing user, a disabled one or a hidden list: nothing here may tell them apart.
  if (query.isError && isNotFoundError(query.error)) return <EmptyState title="List not found" />;
  if (query.data === undefined) return <QueryFallback query={query} />;

  return (
    <>
      <h1 className="mb-4 text-xl font-semibold wrap-anywhere">{username}'s list</h1>
      {items.length === 0 ?
        <EmptyState title="This list is empty" />
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

export const memberListRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/users/$username',
  component: MemberListPage,
});
