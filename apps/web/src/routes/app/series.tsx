import { type Season, listStatuses } from '@osusume/shared';
import { useQuery } from '@tanstack/react-query';
import { createRoute, Link } from '@tanstack/react-router';
import { CoverImage } from '@/components/cover-image';
import { EntryDetails, StatusMenu } from '@/components/list-entry-editor';
import { PageHeader, SectionHeading } from '@/components/page-header';
import { EmptyState, LoadMore, QueryFallback } from '@/components/states';
import { StatusBadge } from '@/components/status-badge';
import { TagList } from '@/components/tag-list';
import { TextLink } from '@/components/text-link';
import { api } from '@/lib/api';
import { isNotFoundError, request } from '@/lib/api-request';
import { formatAired } from '@/lib/catalog-format';
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
    <section className="mt-10">
      <SectionHeading>Images</SectionHeading>
      {query.data === undefined ?
        <QueryFallback query={query} />
      : items.length === 0 ?
        <p className="text-muted-foreground text-sm">No images yet.</p>
      : <ul className="grid grid-cols-3 gap-3 sm:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8">
          {items.map((image, index) => (
            <li key={image.id}>
              <CoverImage cover={image} size="small" alt={`${title}, image ${String(index + 1)}`} title={title} />
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
    <li className="flex gap-4 py-4">
      <CoverImage cover={season.cover} size="small" alt="" title={season.title} className="w-14 shrink-0 self-start sm:w-20" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
          <div className="flex min-w-0 flex-1 basis-56 flex-col gap-1">
            <h3 className="text-base font-medium wrap-anywhere">
              <Link
                to="/seasons/$id"
                params={{ id: season.id }}
                className="text-foreground rounded-xs underline-offset-4 hover:underline"
              >
                {season.title}
              </Link>
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
          </div>
          {entries.data !== undefined && (
            <StatusMenu seasonId={season.id} status={entry?.status ?? null} title={season.title} />
          )}
        </div>
        {entry !== undefined && (
          <>
            {entry.note !== null && (
              <p className="text-muted-foreground mt-2 line-clamp-3 text-sm wrap-anywhere whitespace-pre-wrap">
                {entry.note}
              </p>
            )}
            <details className="mt-1 text-sm">
              <summary className="text-link w-fit cursor-pointer rounded-xs py-1.5">
                {entry.note === null ? 'Add a note or remove' : 'Edit note or remove'}
              </summary>
              <div className="mt-2 max-w-md">
                <EntryDetails seasonId={season.id} entry={entry} />
              </div>
            </details>
          </>
        )}
      </div>
    </li>
  );
}

/** How the user's list stands on this series, at a glance beside its title. */
function YourStatus({ seasons }: { seasons: readonly Season[] }) {
  const entries = useQuery(ownEntriesQuery);
  if (entries.isError) return <QueryFallback query={entries} />;
  if (entries.data === undefined || seasons.length === 0) return null;
  const listed = seasons.flatMap((season) => entries.data.get(season.id)?.status ?? []);
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-y py-3">
      <p className="eyebrow">Your status</p>
      {listStatuses
        .filter((status) => listed.includes(status))
        .map((status) => (
          <StatusBadge key={status} status={status} />
        ))}
      <p className="text-muted-foreground text-sm">
        {listed.length === 0 ?
          'Not on your list yet. Pick a status on a season below.'
        : `${String(listed.length)} of ${String(seasons.length)} ${seasons.length === 1 ? 'season' : 'seasons'} on your list`}
      </p>
    </div>
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
  const { title, altTitles, synopsis, cover, tags, seasons, firstYear, firstSeasonOfYear } = series.data;
  const aired = formatAired(firstYear, firstSeasonOfYear);

  return (
    <div className="grid gap-8 lg:grid-cols-[16rem_minmax(0,1fr)]">
      <CoverImage cover={cover} size="large" alt={title} title={title} className="w-40 self-start lg:w-full" />
      <div className="min-w-0">
        <PageHeader
          title={title}
          {...(aired === null ? {} : { eyebrow: aired })}
          {...(altTitles.length === 0 ? {} : { description: altTitles.join(' · ') })}
          className="mb-4"
        />
        <div className="flex flex-col gap-4">
          <TagList tags={tags} />
          <YourStatus seasons={seasons} />
          {synopsis !== null && (
            <p className="max-w-prose text-sm wrap-anywhere whitespace-pre-wrap">{synopsis}</p>
          )}
        </div>
        <section className="mt-10">
          <SectionHeading
            actions={
              <TextLink to="/requests/new" search={{ seriesId: id }} className="shrink-0">
                Request a season
              </TextLink>
            }
          >
            Seasons
          </SectionHeading>
          {seasons.length === 0 ?
            <p className="text-muted-foreground text-sm">No seasons yet.</p>
          : <ul className="divide-y">
              {seasons.map((season) => (
                <SeasonRow key={season.id} season={season} />
              ))}
            </ul>
          }
        </section>
        <ImageCatalog seriesId={id} title={title} />
      </div>
    </div>
  );
}

export const seriesRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/series/$id',
  component: SeriesPage,
});
