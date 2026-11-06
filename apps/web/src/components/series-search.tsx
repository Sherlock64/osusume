import { SEARCH_QUERY_MAX_LENGTH, type SeriesSummary } from '@osusume/shared';
import { useQuery } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { EmptyState, QueryFallback } from '@/components/states';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api } from '@/lib/api';
import { request } from '@/lib/api-request';

/** Finds a series by title. `excludeId` is a series that can't be chosen. */
export function SeriesSearch({
  label,
  excludeId,
  onPick,
}: {
  label: string;
  excludeId?: string;
  onPick: (series: SeriesSummary) => void;
}) {
  const inputId = useId();
  const [searched, setSearched] = useState('');
  const results = useQuery({
    queryKey: ['series', searched, '', 'picker'],
    enabled: searched !== '',
    queryFn: () => request(api.series.$get({ query: { q: searched } })),
  });
  const items = results.data?.items.filter((series) => series.id !== excludeId);

  return (
    <div className="flex flex-col gap-3">
      <form
        role="search"
        className="flex flex-wrap items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          const value = new FormData(event.currentTarget).get('q');
          setSearched(typeof value === 'string' ? value.trim() : '');
        }}
      >
        <div className="flex min-w-48 flex-1 flex-col gap-1.5">
          <Label htmlFor={inputId}>{label}</Label>
          <Input id={inputId} name="q" type="search" maxLength={SEARCH_QUERY_MAX_LENGTH} />
        </div>
        <Button type="submit" variant="outline">
          Search
        </Button>
      </form>
      {searched !== '' &&
        (items === undefined ?
          <QueryFallback query={results} />
        : items.length === 0 ?
          <EmptyState title="No series found" />
        : <ul className="flex flex-col gap-1">
            {items.map((series) => (
              <li key={series.id}>
                <Button
                  variant="ghost"
                  className="h-auto w-full justify-start text-left whitespace-normal wrap-anywhere"
                  onClick={() => {
                    onPick(series);
                  }}
                >
                  {series.title}
                </Button>
              </li>
            ))}
          </ul>)}
    </div>
  );
}
