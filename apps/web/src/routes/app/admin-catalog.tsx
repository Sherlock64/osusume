import { SEARCH_QUERY_MAX_LENGTH, type SeriesSummary } from '@osusume/shared';
import { useQueryClient } from '@tanstack/react-query';
import { createRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { SeriesForm } from '@/components/admin-series-form';
import { CoverImage } from '@/components/cover-image';
import { EmptyState, LoadMore, QueryFallback } from '@/components/states';
import { TagList } from '@/components/tag-list';
import { TextLink } from '@/components/text-link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api } from '@/lib/api';
import { request } from '@/lib/api-request';
import { useCursorList } from '@/lib/pagination';
import { adminRoute } from '@/routes/app/admin';

function SeriesRow({ series }: { series: SeriesSummary }) {
  return (
    <li className="flex gap-3 py-3">
      <CoverImage cover={series.cover} size="small" alt="" className="w-12 shrink-0" />
      <div className="flex min-w-0 flex-col gap-1">
        <h2 className="font-medium wrap-anywhere">
          <TextLink to="/admin/catalog/$id" params={{ id: series.id }} className="text-base">
            {series.title}
          </TextLink>
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
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">Manage catalog</h1>
        <Button
          variant="outline"
          aria-expanded={creating}
          onClick={() => {
            setCreating((open) => !open);
          }}
        >
          {creating ? 'Close' : 'New series'}
        </Button>
      </div>
      {creating && (
        <div className="mb-6 rounded-md border p-3">
          <NewSeries />
        </div>
      )}
      <form
        role="search"
        className="mb-2 flex flex-wrap items-end gap-2"
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
        <EmptyState title="No series found" />
      : <ul className="divide-y">
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
