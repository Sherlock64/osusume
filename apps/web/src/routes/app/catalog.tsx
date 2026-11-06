import { SEARCH_QUERY_MAX_LENGTH, type SeriesSummary } from '@osusume/shared';
import { useQuery } from '@tanstack/react-query';
import { createRoute, useNavigate } from '@tanstack/react-router';
import { z } from 'zod';
import { CoverImage } from '@/components/cover-image';
import { EmptyState, LoadMore, QueryFallback } from '@/components/states';
import { TagList } from '@/components/tag-list';
import { TextLink } from '@/components/text-link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { api } from '@/lib/api';
import { request } from '@/lib/api-request';
import { tagsQuery } from '@/lib/catalog';
import { formatAired } from '@/lib/catalog-format';
import { useCursorList } from '@/lib/pagination';
import { appRoute } from '@/routes/app';

function SeriesRow({ series }: { series: SeriesSummary }) {
  const aired = formatAired(series.firstYear, series.firstSeasonOfYear);
  const seasons = `${String(series.seasonCount)} ${series.seasonCount === 1 ? 'season' : 'seasons'}`;
  return (
    <li className="flex gap-3 py-3">
      <CoverImage cover={series.cover} size="small" alt="" className="w-16 shrink-0" />
      <div className="flex min-w-0 flex-col gap-1">
        <h2 className="font-medium wrap-anywhere">
          <TextLink to="/series/$id" params={{ id: series.id }} className="text-base">
            {series.title}
          </TextLink>
        </h2>
        <p className="text-muted-foreground text-sm">
          {aired === null ? seasons : `${aired} · ${seasons}`}
        </p>
        <TagList tags={series.tags} />
      </div>
    </li>
  );
}

function CatalogPage() {
  const { q, tag } = catalogRoute.useSearch();
  const navigate = useNavigate({ from: '/catalog' });
  const tags = useQuery(tagsQuery);
  const { query, items } = useCursorList({
    queryKey: ['series', q ?? '', tag ?? ''],
    fetchPage: (cursor) =>
      request(
        api.series.$get({
          query: {
            ...(cursor === undefined ? {} : { cursor }),
            ...(q === undefined ? {} : { q }),
            ...(tag === undefined ? {} : { tag }),
          },
        }),
      ),
  });

  const setSearch = (next: { q?: string | undefined; tag?: string | undefined }) => {
    void navigate({ search: { q: next.q || undefined, tag: next.tag || undefined } });
  };

  return (
    <>
      <h1 className="mb-4 text-xl font-semibold">Catalog</h1>
      <form
        role="search"
        className="mb-2 flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          const searched = new FormData(event.currentTarget).get('q');
          setSearch({ q: typeof searched === 'string' ? searched.trim() : undefined, tag });
        }}
      >
        <div className="flex min-w-48 flex-1 flex-col gap-1.5">
          <Label htmlFor="catalog-search">Search</Label>
          <Input
            // Follows the address, such as when going back.
            key={q ?? ''}
            id="catalog-search"
            name="q"
            type="search"
            maxLength={SEARCH_QUERY_MAX_LENGTH}
            defaultValue={q ?? ''}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="catalog-tag">Tag</Label>
          <NativeSelect
            id="catalog-tag"
            className="w-full sm:w-48"
            value={tag ?? ''}
            onChange={(event) => {
              setSearch({ q, tag: event.target.value });
            }}
          >
            <NativeSelectOption value="">All tags</NativeSelectOption>
            {tags.data?.map(({ id, name }) => (
              <NativeSelectOption key={id} value={id}>
                {name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
        <Button type="submit">Search</Button>
      </form>
      {query.data === undefined ?
        <QueryFallback query={query} />
      : items.length === 0 ?
        <EmptyState title="No series found">
          <TextLink to="/requests/new">Request an addition</TextLink>
        </EmptyState>
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

export const catalogRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/catalog',
  validateSearch: z.object({
    q: z.string().max(SEARCH_QUERY_MAX_LENGTH).optional().catch(undefined),
    tag: z.uuid().optional().catch(undefined),
  }),
  component: CatalogPage,
});
