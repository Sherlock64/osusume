import { queryOptions } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { request } from '@/lib/api-request';
import { fetchAllPages } from '@/lib/pagination';

/** The whole tag vocabulary, for filtering. */
export const tagsQuery = queryOptions({
  queryKey: ['tags'],
  queryFn: () =>
    fetchAllPages((cursor) =>
      request(api.tags.$get({ query: { limit: '100', ...(cursor === undefined ? {} : { cursor }) } })),
    ),
});
