import { SEARCH_QUERY_MAX_LENGTH, type SeriesSummary } from '@osusume/shared';
import { useQuery } from '@tanstack/react-query';
import { createRoute, Link, useNavigate } from '@tanstack/react-router';
import { Check, Search } from 'lucide-react';
import { z } from 'zod';
import { CoverImage } from '@/components/cover-image';
import { PageHeader } from '@/components/page-header';
import { EmptyState, LoadMore, QueryFallback } from '@/components/states';
import { TagList } from '@/components/tag-list';
import { TextLink } from '@/components/text-link';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { api } from '@/lib/api';
import { request } from '@/lib/api-request';
import { tagsQuery } from '@/lib/catalog';
import { formatAired } from '@/lib/catalog-format';
import { ownSeriesIdsQuery } from '@/lib/own-list';
import { useCursorList } from '@/lib/pagination';
import { appRoute } from '@/routes/app';

function SeriesCard({ series, onList }: { series: SeriesSummary; onList: boolean }) {
  const aired = formatAired(series.firstYear, series.firstSeasonOfYear);
  const seasons = `${String(series.seasonCount)} ${series.seasonCount === 1 ? 'season' : 'seasons'}`;
  return (
    <li className="group relative flex flex-col gap-2">
      <div className="relative transition-transform motion-safe:group-hover:-translate-y-0.5">
        <CoverImage cover={series.cover} size="medium" alt="" title={series.title} />
        {onList && (
          <Badge className="absolute top-2 left-2">
            <Check aria-hidden />
            On my list
          </Badge>
        )}
      </div>
      <h2 className="text-base leading-snug font-medium wrap-anywhere">
        {/* Stretched over the card, so the cover is part of the one link. */}
        <Link
          to="/series/$id"
          params={{ id: series.id }}
          className="text-foreground rounded-xs underline-offset-4 group-hover:underline after:absolute after:inset-0"
        >
          {series.title}
        </Link>
      </h2>
      <p className="text-muted-foreground text-xs">{aired === null ? seasons : `${aired} · ${seasons}`}</p>
      <TagList tags={series.tags} limit={2} />
    </li>
  );
}

function CatalogPage() {
  const { q, tag } = catalogRoute.useSearch();
  const navigate = useNavigate({ from: '/catalog' });
  const tags = useQuery(tagsQuery);
  const onList = useQuery(ownSeriesIdsQuery).data ?? new Set<string>();
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
      <PageHeader title="Catalog" className="mb-4" />
      <form
        role="search"
        className="mb-8 flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          const searched = new FormData(event.currentTarget).get('q');
          setSearch({ q: typeof searched === 'string' ? searched.trim() : undefined, tag });
        }}
      >
        <div className="flex min-w-48 flex-1 flex-col gap-1.5">
          <Label htmlFor="catalog-search">Search</Label>
          <div className="relative">
            <Search
              className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
              aria-hidden
            />
            <Input
              // Follows the address, such as when going back.
              key={q ?? ''}
              id="catalog-search"
              name="q"
              type="search"
              maxLength={SEARCH_QUERY_MAX_LENGTH}
              defaultValue={q ?? ''}
              placeholder="Titles and alternate titles"
              className="pl-9"
            />
          </div>
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
        {(q !== undefined || tag !== undefined) && (
          <Link to="/catalog" className={buttonVariants({ variant: 'ghost' })}>
            Clear
          </Link>
        )}
      </form>
      {query.data === undefined ?
        <QueryFallback query={query} />
      : items.length === 0 ?
        <EmptyState title="No series found">
          <TextLink to="/requests/new">Request an addition</TextLink>
        </EmptyState>
      : <ul className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
          {items.map((series) => (
            <SeriesCard key={series.id} series={series} onList={onList.has(series.id)} />
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
