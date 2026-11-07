import { listStatusLabels } from '@osusume/shared';
import { createRoute } from '@tanstack/react-router';
import { EmptyState, ErrorState, LoadingState, LoadMore } from '@/components/states';
import { api } from '@/lib/api';
import { ApiError, request } from '@/lib/api-request';
import { useCursorList } from '@/lib/pagination';
import { rootRoute } from '@/routes/root';

/** Crawlers are kept off this page by the `noindex` in index.html, which every page is served. */
function PublicListPage() {
  const { slug } = publicListRoute.useParams();
  const { query, items } = useCursorList({
    queryKey: ['public-list', slug],
    fetchPage: (cursor) =>
      request(
        api.lists[':slug'].$get({
          param: { slug },
          query: cursor === undefined ? {} : { cursor },
        }),
      ),
  });

  const frame = 'mx-auto max-w-2xl p-4';
  if (query.isPending) {
    return (
      <main className={frame}>
        <LoadingState />
      </main>
    );
  }
  if (query.isError) {
    const gone =
      query.error instanceof ApiError && (query.error.status === 404 || query.error.status === 400);
    return (
      <main className={frame}>
        {gone ?
          <EmptyState title="List not found" />
        : <ErrorState error={query.error} onRetry={() => void query.refetch()} />}
      </main>
    );
  }

  return (
    <main className={frame}>
      <h1 className="mb-4 text-xl font-semibold">Anime list</h1>
      {items.length === 0 ?
        <EmptyState title="This list is empty" />
      : <ul className="divide-y">
          {items.map((series, index) => (
            // Public lists carry no ids. Titles can repeat, so the position goes in too.
            <li key={`${String(index)}-${series.title}`} className="py-3">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4">
                <h2 className="min-w-0 font-medium wrap-anywhere">{series.title}</h2>
                <p className="text-muted-foreground text-sm">{series.seriesStatus.label}</p>
              </div>
              <ul className="mt-1">
                {series.seasons.map((season, seasonIndex) => (
                  <li
                    key={`${String(seasonIndex)}-${season.title}`}
                    className="flex flex-wrap justify-between gap-x-4 text-sm"
                  >
                    <span className="min-w-0 wrap-anywhere">{season.title}</span>
                    <span className="text-muted-foreground">{listStatusLabels[season.status]}</span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      }
      <LoadMore query={query} />
    </main>
  );
}

export const publicListRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/lists/$slug',
  component: PublicListPage,
});
