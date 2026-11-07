import type { ListStatus } from '@osusume/shared';
import { queryOptions } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { request } from '@/lib/api-request';
import { fetchAllPages } from '@/lib/pagination';

/** The prefix of every query holding the user's own list. Invalidate it after changing an entry. */
export const ownListKey = ['own-list'] as const;

export interface OwnEntry {
  status: ListStatus;
  note: string | null;
  updatedAt: string;
}

const fetchOwnList = () =>
  fetchAllPages((cursor) =>
    request(api.me.list.$get({ query: { limit: '100', ...(cursor === undefined ? {} : { cursor }) } })),
  );

/** The series with any season on the user's list, at any status. */
export const ownSeriesIdsQuery = queryOptions({
  queryKey: [...ownListKey, 'series-ids'],
  queryFn: async () => new Set((await fetchOwnList()).map(({ seriesId }) => seriesId)),
});

/**
 * The user's entry for each season they have listed. The api has no way to ask for one season's
 * entry, so a detail page reads the whole list.
 */
export const ownEntriesQuery = queryOptions({
  queryKey: [...ownListKey, 'entries'],
  queryFn: async () => {
    const series = await fetchOwnList();
    return new Map<string, OwnEntry>(
      series.flatMap(({ seasons }) =>
        seasons.map(({ seasonId, status, note, updatedAt }) => [seasonId, { status, note, updatedAt }]),
      ),
    );
  },
});
