import type { Season } from '@osusume/shared';
import { useQuery } from '@tanstack/react-query';
import { createRoute } from '@tanstack/react-router';
import { CoverImage } from '@/components/cover-image';
import { ListEntryEditor } from '@/components/list-entry-editor';
import { EmptyState, LoadMore, QueryFallback } from '@/components/states';
import { TagList } from '@/components/tag-list';
import { TextLink } from '@/components/text-link';
import { api } from '@/lib/api';
import { isNotFoundError, request } from '@/lib/api-request';
import { formatAired } from '@/lib/catalog-format';
import { listStatusLabels } from '@/lib/list-status';
import { ownEntriesQuery } from '@/lib/own-list';
import { useCursorList } from '@/lib/pagination';
import { appRoute } from '@/routes/app';

function ImageCatalog({ seriesId, title }: { seriesId: string; title: string }) {
  const { query, items } = useCursorList({
    queryKey: ['series-images', seriesId],
    fetchPage: (cursor) =>
      request(
        api.series[':id'].images.$get({
          param: { id: seriesId },
          query: cursor === undefined ? {} : { cursor },
        }),
      ),
  });
  return (
    <section className="mt-6">
      <h2 className="mb-2 font-medium">Images</h2>
      {query.data === undefined ?
        <QueryFallback query={query} />
      : items.length === 0 ?
        <p className="text-muted-foreground text-sm">No images yet.</p>
      : <ul className="grid grid-cols-3 gap-2 sm:grid-cols-5 md:grid-cols-6">
          {items.map((image, index) => (
            <li key={image.id}>
              <CoverImage cover={image} size="small" alt={`${title}, image ${String(index + 1)}`} />
              {image.isPrimary && <p className="text-muted-foreground mt-1 text-xs">Primary</p>}
            </li>
          ))}
        </ul>
      }
      <LoadMore query={query} />
    </section>
  );
}

function SeasonRow({ season }: { season: Season }) {
  const entries = useQuery(ownEntriesQuery);
  const aired = formatAired(season.year, season.seasonOfYear);
  const entry = entries.data?.get(season.id);
  return (
    <li className="flex gap-3 py-3">
      <CoverImage cover={season.cover} size="small" alt="" className="w-16 shrink-0" />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <h3 className="font-medium wrap-anywhere">
          <TextLink to="/seasons/$id" params={{ id: season.id }} className="text-base">
            {season.title}
          </TextLink>
        </h3>
        <p className="text-muted-foreground text-sm">
          {[
            `Season ${String(season.ordinal)}`,
            aired,
            season.episodeCount === null ? null : `${String(season.episodeCount)} episodes`,
          ]
            .filter((part) => part !== null)
            .join(' · ')}
        </p>
        <TagList tags={season.effectiveTags} />
        <details className="mt-1 text-sm">
          <summary className="cursor-pointer">
            {entry === undefined ? 'Add to my list' : `On my list: ${listStatusLabels[entry.status]}`}
          </summary>
          <div className="mt-2">
            <ListEntryEditor seasonId={season.id} />
          </div>
        </details>
      </div>
    </li>
  );
}

function SeriesPage() {
  const { id } = seriesRoute.useParams();
  const series = useQuery({
    queryKey: ['series-detail', id],
    queryFn: () => request(api.series[':id'].$get({ param: { id } })),
  });

  if (series.isError && isNotFoundError(series.error)) return <EmptyState title="Series not found" />;
  if (series.data === undefined) return <QueryFallback query={series} />;
  const { title, altTitles, synopsis, cover, tags, seasons } = series.data;

  return (
    <>
      <div className="flex flex-col gap-4 sm:flex-row">
        <CoverImage cover={cover} size="medium" alt={title} className="w-40 shrink-0" />
        <div className="flex min-w-0 flex-col gap-2">
          <h1 className="text-xl font-semibold wrap-anywhere">{title}</h1>
          {altTitles.length > 0 && (
            <p className="text-muted-foreground text-sm wrap-anywhere">{altTitles.join(' · ')}</p>
          )}
          <TagList tags={tags} />
          {synopsis !== null && <p className="text-sm wrap-anywhere whitespace-pre-wrap">{synopsis}</p>}
        </div>
      </div>
      <section className="mt-6">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4">
          <h2 className="font-medium">Seasons</h2>
          <TextLink to="/requests/new" search={{ seriesId: id }}>
            Request a season
          </TextLink>
        </div>
        {seasons.length === 0 ?
          <p className="text-muted-foreground mt-2 text-sm">No seasons yet.</p>
        : <ul className="divide-y">
            {seasons.map((season) => (
              <SeasonRow key={season.id} season={season} />
            ))}
          </ul>
        }
      </section>
      <ImageCatalog seriesId={id} title={title} />
    </>
  );
}

export const seriesRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/series/$id',
  component: SeriesPage,
});
