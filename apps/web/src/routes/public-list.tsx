import { createRoute } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { CoverImage } from '@/components/cover-image';
import { PageHeader } from '@/components/page-header';
import { PublicBar } from '@/components/public-card';
import { EmptyState, ErrorState, LoadingState, LoadMore } from '@/components/states';
import { api } from '@/lib/api';
import { StatusBadge } from '@/components/status-badge';
import { ApiError, request } from '@/lib/api-request';
import { useCursorList } from '@/lib/pagination';
import { rootRoute } from '@/routes/root';

function Frame({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-svh">
      <header className="star-field border-b">
        <div className="mx-auto max-w-7xl px-4 pt-3 pb-8 sm:px-6 sm:pb-12">
          <PublicBar />
          <PageHeader
            eyebrow="オススメ · a shared list"
            title="Anime list"
            className="mt-10 mb-0 border-b-0 pb-0 sm:mt-14"
          />
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 pb-10 sm:px-6">{children}</main>
    </div>
  );
}

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

  if (query.isPending) {
    return (
      <Frame>
        <LoadingState />
      </Frame>
    );
  }
  if (query.isError) {
    const gone =
      query.error instanceof ApiError && (query.error.status === 404 || query.error.status === 400);
    return (
      <Frame>
        {gone ?
          <EmptyState title="List not found">
            The link may be wrong, or the list may no longer be public.
          </EmptyState>
        : <ErrorState error={query.error} onRetry={() => void query.refetch()} />}
      </Frame>
    );
  }

  return (
    <Frame>
      {items.length === 0 ?
        <EmptyState title="This list is empty">Nothing has been added yet.</EmptyState>
      : <ul className="grid gap-x-10 sm:grid-cols-2 xl:grid-cols-3">
          {items.map((series, index) => {
            // A one-season show would otherwise repeat its title on the line below.
            const soloSeason = series.seasons.length === 1 && series.seasons[0]?.title === series.title;
            const { status, count, totalSeasons } = series.seriesStatus;
            return (
              // Public lists carry no ids. Titles can repeat, so the position goes in too.
              <li key={`${String(index)}-${series.title}`} className="flex gap-4 border-b py-5">
                <CoverImage cover={series.cover} size="medium" alt="" title={series.title} className="w-24 shrink-0 self-start" />
                <div className="min-w-0 flex-1">
                  <h2 className="text-base leading-snug font-medium wrap-anywhere">{series.title}</h2>
                  <p className="text-muted-foreground mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                    <StatusBadge status={status} />
                    {`${String(count)}/${String(totalSeasons)} ${totalSeasons === 1 ? 'season' : 'seasons'}`}
                  </p>
                  {!soloSeason && (
                    <ul className="mt-3 flex flex-col gap-2 border-t pt-3">
                      {series.seasons.map((season, seasonIndex) => (
                        <li
                          key={`${String(seasonIndex)}-${season.title}`}
                          className="flex items-start justify-between gap-3 text-sm"
                        >
                          <span className="min-w-0 wrap-anywhere">{season.title}</span>
                          <StatusBadge status={season.status} />
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      }
      <LoadMore query={query} />
    </Frame>
  );
}

export const publicListRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/lists/$slug',
  component: PublicListPage,
});
