import { type ListStatus, type SeasonOfYear, listStatusLabels } from '@osusume/shared';
import { TextLink } from '@/components/text-link';
import { formatAired } from '@/lib/catalog-format';
import { cn } from '@/lib/utils';

interface ListSeriesProps {
  series: {
    seriesId: string;
    title: string;
    seriesStatus: { label: string };
    seasons: {
      seasonId: string;
      title: string;
      year: number | null;
      seasonOfYear: SeasonOfYear | null;
      status: ListStatus;
      matched: boolean;
      /** Only the owner's own list has notes. */
      note?: string | null;
    }[];
  };
}

/** A series on a member's list, with its derived status and the seasons listed. */
export function ListSeries({ series }: ListSeriesProps) {
  return (
    <li className="py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4">
        <h2 className="min-w-0 font-medium wrap-anywhere">
          <TextLink to="/series/$id" params={{ id: series.seriesId }} className="text-base">
            {series.title}
          </TextLink>
        </h2>
        <p className="text-muted-foreground text-sm">{series.seriesStatus.label}</p>
      </div>
      <ul className="mt-1 flex flex-col gap-1">
        {series.seasons.map((season) => {
          const aired = formatAired(season.year, season.seasonOfYear);
          return (
            <li
              key={season.seasonId}
              className={cn('rounded-md px-2 py-1 text-sm', season.matched && 'bg-accent font-medium')}
            >
              <div className="flex flex-wrap justify-between gap-x-4">
                <span className="min-w-0 wrap-anywhere">
                  <TextLink to="/seasons/$id" params={{ id: season.seasonId }}>
                    {season.title}
                  </TextLink>
                  {aired !== null && <span className="text-muted-foreground"> · {aired}</span>}
                  {season.matched && <span className="sr-only"> (matches the filter)</span>}
                </span>
                <span className={season.matched ? undefined : 'text-muted-foreground'}>
                  {listStatusLabels[season.status]}
                </span>
              </div>
              {season.note != null && (
                <p className="text-muted-foreground mt-1 font-normal wrap-anywhere whitespace-pre-wrap">
                  {season.note}
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </li>
  );
}
