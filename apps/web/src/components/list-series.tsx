import { type Cover, type ListStatus, type SeasonOfYear } from '@osusume/shared';
import { Link } from '@tanstack/react-router';
import { CoverImage } from '@/components/cover-image';
import { StatusMenu } from '@/components/list-entry-editor';
import { StatusBadge } from '@/components/status-badge';
import { formatAired } from '@/lib/catalog-format';
import { cn } from '@/lib/utils';

interface ListedSeries {
  seriesId: string;
  title: string;
  cover: Cover | null;
  seriesStatus: { label: string };
  seasons: {
    seasonId: string;
    title: string;
    year: number | null;
    seasonOfYear: SeasonOfYear | null;
    status: ListStatus;
    matched: boolean;
    /** Only the owner's own list has notes, and only the owner can change a status. */
    note?: string | null;
  }[];
}

/** A series on a member's list: its cover, derived status and the seasons listed. */
export function ListSeries({ series }: { series: ListedSeries }) {
  const seriesLink = { to: '/series/$id', params: { id: series.seriesId } } as const;
  return (
    <li className="flex gap-4 py-4">
      {/* The title below is the same link, so this one stays out of the tab order. */}
      <Link
        {...seriesLink}
        tabIndex={-1}
        aria-hidden
        className="w-24 shrink-0 self-start transition-opacity hover:opacity-85 sm:w-28"
      >
        <CoverImage cover={series.cover} size="medium" alt="" title={series.title} />
      </Link>
      <div className="min-w-0 flex-1">
        <h2 className="text-base leading-snug font-medium wrap-anywhere">
          <Link {...seriesLink} className="text-foreground rounded-xs underline-offset-4 hover:underline">
            {series.title}
          </Link>
        </h2>
        <p className="text-muted-foreground text-sm">{series.seriesStatus.label}</p>
        <ul className="mt-2 flex flex-col gap-1.5">
          {series.seasons.map((season) => {
            const aired = formatAired(season.year, season.seasonOfYear);
            return (
              <li
                key={season.seasonId}
                className={cn(
                  'flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-md text-sm',
                  season.matched && 'bg-accent text-accent-foreground -mx-2 px-2 py-1 font-medium',
                )}
              >
                <span className="min-w-0 wrap-anywhere">
                  <Link
                    to="/seasons/$id"
                    params={{ id: season.seasonId }}
                    className="text-foreground rounded-xs underline-offset-4 hover:underline"
                  >
                    {season.title}
                  </Link>
                  {aired !== null && <span className="text-muted-foreground"> · {aired}</span>}
                  {season.matched && <span className="sr-only"> (matches the filter)</span>}
                </span>
                {season.note === undefined ?
                  <StatusBadge status={season.status} />
                : <StatusMenu seasonId={season.seasonId} status={season.status} title={season.title} />}
                {season.note != null && (
                  <p className="text-muted-foreground line-clamp-3 basis-full font-normal wrap-anywhere whitespace-pre-wrap">
                    {season.note}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </li>
  );
}

/** A member's list as a grid. */
export function ListSeriesGrid({ series }: { series: ListedSeries[] }) {
  return (
    // A row on phones and in a plain list; here, from md up, the cover leads over its text.
    <ul className="grid gap-x-6 md:grid-cols-3 md:gap-y-6 lg:grid-cols-4 xl:grid-cols-5 [&>li]:border-b md:[&>li]:flex-col md:[&>li]:border-0 md:[&>li]:py-0 md:[&>li>a]:w-full">
      {series.map((item) => (
        <ListSeries key={item.seriesId} series={item} />
      ))}
    </ul>
  );
}
