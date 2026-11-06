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

/** Every page of a cursor-paginated endpoint, for what a screen needs whole, like a dropdown. */
export async function fetchAllPages<Item>(
  fetchPage: (cursor: string | undefined) => Promise<Page<Item>>,
): Promise<Item[]> {
  const items: Item[] = [];
  let cursor: string | undefined;
  do {
    const page = await fetchPage(cursor);
    items.push(...page.items);
    cursor = page.nextCursor ?? undefined;
  } while (cursor !== undefined);
  return items;
}
