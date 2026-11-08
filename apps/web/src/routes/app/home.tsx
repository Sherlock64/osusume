import {
  listStatuses,
  listStatusSchema,
  type ListStatus,
  listStatusLabels,
  SEARCH_QUERY_MAX_LENGTH,
  SERIES_RATING_MAX,
  type SeriesRating,
  seriesRatingSchema,
} from '@osusume/shared';
import { createRoute, Link, useNavigate } from '@tanstack/react-router';
import { Search } from 'lucide-react';
import { z } from 'zod';
import { ListSeriesGrid } from '@/components/list-series';
import { PageHeader } from '@/components/page-header';
import { EmptyState, LoadMore, QueryFallback } from '@/components/states';
import { ratingText, Star } from '@/components/star-rating';
import { StatusBadge } from '@/components/status-badge';
import { TextLink } from '@/components/text-link';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api } from '@/lib/api';
import { request } from '@/lib/api-request';
import { ownListKey } from '@/lib/own-list';
import { useCursorList } from '@/lib/pagination';
import { cn } from '@/lib/utils';
import { appRoute } from '@/routes/app';

function ListSearch({ q }: { q: string | undefined }) {
  const navigate = useNavigate({ from: '/' });
  return (
    <form
      role="search"
      className="mb-4 flex flex-wrap items-end gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        const searched = new FormData(event.currentTarget).get('q');
        const next = typeof searched === 'string' ? searched.trim() : '';
        void navigate({ search: (prev) => ({ ...prev, q: next || undefined }) });
      }}
    >
      <div className="flex min-w-48 flex-1 flex-col gap-1.5">
        <Label htmlFor="list-search">Search</Label>
        <div className="relative">
          <Search
            className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
            aria-hidden
          />
          <Input
            // Follows the address, such as when going back.
            key={q ?? ''}
            id="list-search"
            name="q"
            type="search"
            maxLength={SEARCH_QUERY_MAX_LENGTH}
            defaultValue={q ?? ''}
            placeholder="Titles and alternate titles"
            className="pl-9"
          />
        </div>
      </div>
      <Button type="submit">Search</Button>
      {q !== undefined && (
        <Link to="/" search={(prev) => ({ ...prev, q: undefined })} className={buttonVariants({ variant: 'ghost' })}>
          Clear
        </Link>
      )}
    </form>
  );
}

function StatusFilter({ current }: { current: ListStatus | undefined }) {
  return (
    <nav aria-label="Filter by status" className="mb-3 flex flex-wrap gap-2">
      {[undefined, ...listStatuses].map((status) => (
        <Link
          key={status ?? 'all'}
          to="/"
          search={(prev) => ({ ...prev, status })}
          aria-current={status === current ? 'true' : undefined}
          className={buttonVariants({ variant: status === current ? 'default' : 'outline', size: 'sm' })}
        >
          {status === undefined ?
            'All'
          : <StatusBadge
              status={status}
              // Gold is a fill for dark text, so the chosen chip drops the status colour; its icon stays.
              className={cn('border-0 bg-transparent px-0', status === current && 'text-primary-foreground')}
            />
          }
        </Link>
      ))}
    </nav>
  );
}

const RATINGS = Array.from({ length: SERIES_RATING_MAX + 1 }, (_, index) => index);

function RatingFilter({ current }: { current: SeriesRating | undefined }) {
  return (
    <nav aria-label="Filter by rating" className="mb-6 flex flex-wrap gap-2">
      {[undefined, ...RATINGS].map((rating) => (
        <Link
          key={rating ?? 'any'}
          to="/"
          search={(prev) => ({ ...prev, rating })}
          aria-current={rating === current ? 'true' : undefined}
          className={buttonVariants({ variant: rating === current ? 'default' : 'outline', size: 'sm' })}
        >
          {rating === undefined ?
            'Any rating'
          : <span role="img" aria-label={ratingText(rating)} className="inline-flex items-center gap-0.5 tabular-nums">
              {rating}
              {/* Gold is the chosen chip's fill, so its star turns dark like the status icons. */}
              <Star lit className={cn('size-3.5', rating === current && '[&_path]:fill-primary-foreground')} />
            </span>
          }
        </Link>
      ))}
    </nav>
  );
}

function MyListPage() {
  const { q, status, rating } = homeRoute.useSearch();
  const { query, items } = useCursorList({
    queryKey: [...ownListKey, 'page', status ?? 'all', rating ?? 'any', q ?? ''],
    fetchPage: (cursor) =>
      request(
        api.me.list.$get({
          query: {
            ...(cursor === undefined ? {} : { cursor }),
            ...(status === undefined ? {} : { status }),
            ...(rating === undefined ? {} : { rating: String(rating) }),
            ...(q === undefined ? {} : { q }),
          },
        }),
      ),
  });

  return (
    <>
      <PageHeader
        title="My list"
        className="mb-4"
        actions={
          <Link to="/catalog" className={buttonVariants({ variant: 'outline' })}>
            Browse the catalog
          </Link>
        }
      />
      <ListSearch q={q} />
      <StatusFilter current={status} />
      <RatingFilter current={rating} />
      {query.data === undefined ?
        <QueryFallback query={query} />
      : items.length === 0 ?
        q !== undefined ?
          <EmptyState title="Nothing on your list matches">
            <TextLink to="/">Show the whole list</TextLink>
          </EmptyState>
        : status === undefined && rating === undefined ?
          <EmptyState title="Your list is empty">
            <TextLink to="/catalog">Find something in the catalog</TextLink>
          </EmptyState>
        : status === undefined || rating !== undefined ?
          <EmptyState title="Nothing on your list matches these filters">
            <TextLink to="/">Show the whole list</TextLink>
          </EmptyState>
        : <EmptyState title={`Nothing is marked ${listStatusLabels[status].toLowerCase()}`}>
            <TextLink to="/">Show the whole list</TextLink>
          </EmptyState>
      : <ListSeriesGrid series={items} />
      }
      <LoadMore query={query} />
    </>
  );
}

export const homeRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/',
  validateSearch: z.object({
    q: z.string().max(SEARCH_QUERY_MAX_LENGTH).optional().catch(undefined),
    status: listStatusSchema.optional().catch(undefined),
    rating: seriesRatingSchema.optional().catch(undefined),
  }),
  component: MyListPage,
});
