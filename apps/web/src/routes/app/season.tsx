import { useQuery } from '@tanstack/react-query';
import { createRoute } from '@tanstack/react-router';
import { CoverImage } from '@/components/cover-image';
import { ListEntryEditor } from '@/components/list-entry-editor';
import { EmptyState, QueryFallback } from '@/components/states';
import { TagList } from '@/components/tag-list';
import { TextLink } from '@/components/text-link';
import { api } from '@/lib/api';
import { isNotFoundError, request } from '@/lib/api-request';
import { formatAired } from '@/lib/catalog-format';
import { appRoute } from '@/routes/app';

function SeasonPage() {
  const { id } = seasonRoute.useParams();
  const season = useQuery({
    queryKey: ['season-detail', id],
    queryFn: () => request(api.seasons[':id'].$get({ param: { id } })),
  });

  if (season.isError && isNotFoundError(season.error)) return <EmptyState title="Season not found" />;
  if (season.data === undefined) return <QueryFallback query={season} />;
  const { title, series, ordinal, year, seasonOfYear, episodeCount, altTitles, synopsis, cover } =
    season.data;
  const aired = formatAired(year, seasonOfYear);

  return (
    <div className="flex flex-col gap-4 sm:flex-row">
      <CoverImage cover={cover} size="medium" alt={title} className="w-40 shrink-0" />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <TextLink to="/series/$id" params={{ id: series.id }} className="wrap-anywhere">
          {series.title}
        </TextLink>
        <h1 className="text-xl font-semibold wrap-anywhere">{title}</h1>
        <p className="text-muted-foreground text-sm">
          {[
            `Season ${String(ordinal)}`,
            aired,
            episodeCount === null ? null : `${String(episodeCount)} episodes`,
          ]
            .filter((part) => part !== null)
            .join(' · ')}
        </p>
        {altTitles.length > 0 && (
          <p className="text-muted-foreground text-sm wrap-anywhere">{altTitles.join(' · ')}</p>
        )}
        <TagList tags={season.data.effectiveTags} />
        {synopsis !== null && <p className="text-sm wrap-anywhere whitespace-pre-wrap">{synopsis}</p>}
        <section className="mt-4 max-w-md">
          <h2 className="mb-2 font-medium">My list</h2>
          <ListEntryEditor seasonId={id} />
        </section>
      </div>
    </div>
  );
}

export const seasonRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/seasons/$id',
  component: SeasonPage,
});
