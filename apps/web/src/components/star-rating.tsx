import { SERIES_RATING_MAX, seriesRatingLabels, type SeriesRating } from '@osusume/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { request, toApiError } from '@/lib/api-request';
import { ownListKey } from '@/lib/own-list';
import { cn } from '@/lib/utils';

/** The four-point star of the canvas, centred on 0 0 in a 12 unit box. */
export const STAR = 'M0-6 1.3-1.3 6 0 1.3 1.3 0 6-1.3 1.3-6 0-1.3-1.3Z';

const STEPS = Array.from({ length: SERIES_RATING_MAX }, (_, index) => index + 1);

export function Star({ lit, className }: { lit: boolean; className?: string }) {
  return (
    <svg viewBox="-6 -6 12 12" aria-hidden className={cn('size-4', className)}>
      <path d={STAR} className={lit ? 'fill-star' : 'fill-none stroke-muted-foreground'} strokeWidth={0.8} />
    </svg>
  );
}

export const ratingText = (rating: SeriesRating) => `${String(rating)} of ${String(SERIES_RATING_MAX)} stars`;

/** A rating as a row of stars, lit up to the rating. */
export function RatingStars({ rating, className }: { rating: SeriesRating; className?: string }) {
  return (
    <span role="img" aria-label={ratingText(rating)} className={cn('inline-flex gap-0.5', className)}>
      {STEPS.map((step) => (
        <Star key={step} lit={step <= rating} className="size-3.5" />
      ))}
    </span>
  );
}

/** Rates a series 0 to 5 stars. `title` names it to screen readers. */
export function RatingPicker({ seriesId, rating, title }: { seriesId: string; rating: SeriesRating; title: string }) {
  const queryClient = useQueryClient();
  const change = useMutation({
    mutationFn: async (next: SeriesRating) => {
      await request(api.me.ratings[':seriesId'].$put({ param: { seriesId }, json: { rating: next } }));
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ownListKey }),
        queryClient.invalidateQueries({ queryKey: ['canvas'] }),
      ]);
    },
  });
  const shown = change.isPending ? change.variables : rating;

  return (
    <fieldset className="mt-2 flex min-w-0 flex-col gap-1" aria-busy={change.isPending}>
      <legend className="sr-only">Rating: {title}</legend>
      <div className="flex items-center">
        {STEPS.map((step) => (
          <label
            key={step}
            className="has-focus-visible:ring-ring flex size-7 cursor-pointer items-center justify-center rounded-sm has-focus-visible:ring-2"
          >
            <input
              type="radio"
              name={`rating-${seriesId}`}
              className="sr-only"
              checked={shown === step}
              disabled={change.isPending}
              // Choosing the top lit star again is how a series goes down to 0 stars.
              onClick={() => {
                change.mutate(step === shown ? 0 : step);
              }}
              onChange={() => undefined}
              aria-label={ratingText(step)}
            />
            <Star lit={step <= shown} className="size-5" />
          </label>
        ))}
      </div>
      <p className="text-muted-foreground text-xs">{seriesRatingLabels[shown]}</p>
      {change.isError && (
        <p role="alert" className="text-destructive text-sm">
          {toApiError(change.error).message}
        </p>
      )}
    </fieldset>
  );
}
