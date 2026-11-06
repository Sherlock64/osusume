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

/**
 * The user's entry for each season they have listed. The api has no way to ask for one season's
 * entry, so a detail page reads the whole list.
 */
export const ownEntriesQuery = queryOptions({
  queryKey: [...ownListKey, 'entries'],
  queryFn: async () => {
    const series = await fetchAllPages((cursor) =>
      request(api.me.list.$get({ query: { limit: '100', ...(cursor === undefined ? {} : { cursor }) } })),
    );
    return new Map<string, OwnEntry>(
      series.flatMap(({ seasons }) =>
        seasons.map(({ seasonId, status, note, updatedAt }) => [seasonId, { status, note, updatedAt }]),
      ),
    );
  },
});
