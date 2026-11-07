import { useQuery } from '@tanstack/react-query';
import { createRoute } from '@tanstack/react-router';
import { CoverImage } from '@/components/cover-image';
import { ListEntryEditor } from '@/components/list-entry-editor';
import { PageHeader, SectionHeading } from '@/components/page-header';
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
    <div className="grid gap-8 lg:grid-cols-[16rem_minmax(0,1fr)] xl:grid-cols-[16rem_minmax(0,1fr)_20rem]">
      <CoverImage cover={cover} size="large" alt={title} title={title} className="w-40 self-start lg:w-full" />
      <div className="flex min-w-0 flex-col gap-3">
        <PageHeader
          eyebrow={
            <TextLink to="/series/$id" params={{ id: series.id }} className="wrap-anywhere">
              {series.title}
            </TextLink>
          }
          title={title}
          description={[
            `Season ${String(ordinal)}`,
            aired,
            episodeCount === null ? null : `${String(episodeCount)} episodes`,
          ]
            .filter((part) => part !== null)
            .join(' · ')}
          className="mb-1"
        />
        {altTitles.length > 0 && (
          <p className="text-muted-foreground text-sm wrap-anywhere">{altTitles.join(' · ')}</p>
        )}
        <TagList tags={season.data.effectiveTags} />
        {synopsis !== null && (
          <p className="mt-2 max-w-prose text-sm wrap-anywhere whitespace-pre-wrap">{synopsis}</p>
        )}
      </div>
      <section className="min-w-0 lg:col-start-2 xl:col-start-3 xl:row-start-1 xl:border-l xl:pl-8">
        <SectionHeading>My list</SectionHeading>
        <ListEntryEditor seasonId={id} title={title} />
      </section>
    </div>
  );
}

export const seasonRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/seasons/$id',
  component: SeasonPage,
});
