import { SEARCH_QUERY_MAX_LENGTH, type SeriesSummary } from '@osusume/shared';
import { useQueryClient } from '@tanstack/react-query';
import { createRoute, Link, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { SeriesForm } from '@/components/admin-series-form';
import { AdminPanel } from '@/components/admin';
import { CoverImage } from '@/components/cover-image';
import { PageHeader } from '@/components/page-header';
import { EmptyState, LoadMore, QueryFallback } from '@/components/states';
import { TagList } from '@/components/tag-list';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api } from '@/lib/api';
import { request } from '@/lib/api-request';
import { useCursorList } from '@/lib/pagination';
import { adminRoute } from '@/routes/app/admin';

function SeriesRow({ series }: { series: SeriesSummary }) {
  return (
    <li className="group relative flex gap-3 border-b py-3">
      <CoverImage cover={series.cover} size="small" alt="" title={series.title} className="w-12 shrink-0 self-start" />
      <div className="flex min-w-0 flex-col gap-1">
        <h2 className="font-sans text-base font-medium tracking-normal wrap-anywhere">
          {/* The whole row is the target: the tags under it are not interactive. */}
          <Link
            to="/admin/catalog/$id"
            params={{ id: series.id }}
            className="rounded-xs group-hover:underline after:absolute after:inset-0"
          >
            {series.title}
          </Link>
        </h2>
        <p className="text-muted-foreground text-sm">
          {`${String(series.seasonCount)} ${series.seasonCount === 1 ? 'season' : 'seasons'}`}
        </p>
        <TagList tags={series.tags} />
      </div>
    </li>
  );
}

function NewSeries() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  return (
    <SeriesForm
      submitLabel="Create series"
      onSubmit={async (json) => {
        const series = await request(api.series.$post({ json }));
        await queryClient.invalidateQueries({ queryKey: ['series'] });
        await navigate({ to: '/admin/catalog/$id', params: { id: series.id } });
      }}
    />
  );
}

function AdminCatalogPage() {
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(false);
  const { query, items } = useCursorList({
    queryKey: ['series', q, '', 'admin'],
    fetchPage: (cursor) =>
      request(
        api.series.$get({
          query: {
            ...(q === '' ? {} : { q }),
            ...(cursor === undefined ? {} : { cursor }),
          },
        }),
      ),
  });

  return (
    <>
      <PageHeader
        eyebrow="Admin"
        title="Manage catalog"
        description="Open a series to edit its details, images and seasons."
        actions={
          <Button
            variant={creating ? 'outline' : 'default'}
            aria-expanded={creating}
            onClick={() => {
              setCreating((open) => !open);
            }}
          >
            {creating ? 'Close' : 'New series'}
          </Button>
        }
      />
      {creating && (
        <div className="mb-8">
          <AdminPanel>
            <NewSeries />
          </AdminPanel>
        </div>
      )}
      <form
        role="search"
        className="mb-2 flex max-w-xl flex-wrap items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          const value = new FormData(event.currentTarget).get('q');
          setQ(typeof value === 'string' ? value.trim() : '');
        }}
      >
        <div className="flex min-w-48 flex-1 flex-col gap-1.5">
          <Label htmlFor="admin-catalog-search">Search series</Label>
          <Input id="admin-catalog-search" name="q" type="search" maxLength={SEARCH_QUERY_MAX_LENGTH} />
        </div>
        <Button type="submit" variant="outline">
          Search
        </Button>
      </form>
      {query.data === undefined ?
        <QueryFallback query={query} />
      : items.length === 0 ?
        <EmptyState title={q === '' ? 'No series yet' : `No series match “${q}”`} />
      : <ul className="grid gap-x-8 md:grid-cols-2 xl:grid-cols-3">
          {items.map((series) => (
            <SeriesRow key={series.id} series={series} />
          ))}
        </ul>
      }
      <LoadMore query={query} />
    </>
  );
}

export const adminCatalogRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: 'catalog',
  component: AdminCatalogPage,
});
