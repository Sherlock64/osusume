import { useInfiniteQuery, type QueryKey } from '@tanstack/react-query';

interface Page<Item> {
  items: Item[];
  nextCursor: string | null;
}

/**
 * A cursor-paginated list endpoint as one growing list. `query` holds the loading and error
 * state; pass it to `LoadMore`.
 */
export function useCursorList<Item>(options: {
  queryKey: QueryKey;
  fetchPage: (cursor: string | undefined) => Promise<Page<Item>>;
}) {
  const query = useInfiniteQuery({
    queryKey: options.queryKey,
    queryFn: ({ pageParam }) => options.fetchPage(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });
  return { query, items: query.data?.pages.flatMap((page) => page.items) ?? [] };
}
