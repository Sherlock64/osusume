import type { CatalogProposal } from '@osusume/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { z } from 'zod';
import { Form, SubmitButton, TextareaField, TextField } from '@/components/form';
import { SeasonFields } from '@/components/season-fields';
import { SeriesSearch } from '@/components/series-search';
import { EmptyState, QueryFallback } from '@/components/states';
import { TextLink } from '@/components/text-link';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { isNotFoundError, request } from '@/lib/api-request';
import { addSeasonFormSchema, newSeriesFormSchema } from '@/lib/catalog-request-form';
import { useForm, type FormState } from '@/lib/form';
import { appRoute } from '@/routes/app';

/** Files a proposal, then shows it in the list of the user's requests. */
function useFileRequest() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  return async (proposal: CatalogProposal) => {
    await request(api['catalog-requests'].$post({ json: proposal }));
    await queryClient.invalidateQueries({ queryKey: ['catalog-requests'] });
    await navigate({ to: '/requests' });
  };
}

function SuggestedTagsField({ form }: { form: FormState }) {
  return (
    <TextField
      form={form}
      name="suggestedTags"
      label="Suggested tags (optional)"
      hint="Separate with commas. An admin decides whether to use them."
    />
  );
}

function NewSeriesForm() {
  const fileRequest = useFileRequest();
  const form = useForm({ schema: newSeriesFormSchema, onSubmit: fileRequest });
  // Stable keys, so that removing a season keeps what was typed in the others.
  const [seasonKeys, setSeasonKeys] = useState<number[]>([]);
  const [nextKey, setNextKey] = useState(0);

  return (
    <Form form={form}>
      <TextField form={form} name="title" label="Series title" />
      <TextareaField form={form} name="altTitles" label="Alternate titles (optional)" hint="One per line." />
      <TextareaField form={form} name="synopsis" label="Synopsis (optional)" />
      <SuggestedTagsField form={form} />
      {seasonKeys.map((key, index) => (
        <fieldset key={key} className="flex flex-col gap-4 rounded-md border p-3">
          <legend className="px-1 text-sm font-medium">Season</legend>
          <SeasonFields form={form} prefix={`seasons.${String(index)}.`} />
          <div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setSeasonKeys((keys) => keys.filter((other) => other !== key));
              }}
            >
              Remove this season
            </Button>
          </div>
        </fieldset>
      ))}
      <div>
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            setSeasonKeys((keys) => [...keys, nextKey]);
            setNextKey(nextKey + 1);
          }}
        >
          Add a season
        </Button>
      </div>
      <SubmitButton form={form}>Send request</SubmitButton>
    </Form>
  );
}

function AddSeasonForm({ seriesId }: { seriesId: string }) {
  const fileRequest = useFileRequest();
  const form = useForm({
    schema: addSeasonFormSchema(seriesId),
    onSubmit: fileRequest,
    fieldForCode: { ordinal_taken: 'ordinal' },
  });
  return (
    <Form form={form}>
      <SeasonFields form={form} />
      <SuggestedTagsField form={form} />
      <SubmitButton form={form}>Send request</SubmitButton>
    </Form>
  );
}

/** Finds the series to add a season to. */
function SeriesPicker() {
  const navigate = useNavigate({ from: '/requests/new' });
  return (
    <SeriesSearch
      label="Which series?"
      onPick={(series) => {
        void navigate({ search: { seriesId: series.id } });
      }}
    />
  );
}

function AddSeason({ seriesId }: { seriesId: string }) {
  const series = useQuery({
    queryKey: ['series-detail', seriesId],
    queryFn: () => request(api.series[':id'].$get({ param: { id: seriesId } })),
  });
  if (series.isError && isNotFoundError(series.error)) return <EmptyState title="Series not found" />;
  if (series.data === undefined) return <QueryFallback query={series} />;
  const taken = series.data.seasons.map((season) => String(season.ordinal));
  return (
    <div className="flex flex-col gap-4">
      <div className="text-sm wrap-anywhere">
        <p>
          Adding a season to <span className="font-medium">{series.data.title}</span>.{' '}
          <TextLink to="/requests/new" search={{ kind: 'season' }}>
            Choose another series
          </TextLink>
        </p>
        {taken.length > 0 && (
          <p className="text-muted-foreground mt-1">Season numbers in use: {taken.join(', ')}</p>
        )}
      </div>
      <AddSeasonForm seriesId={seriesId} />
    </div>
  );
}

function NewRequestPage() {
  const { kind, seriesId } = newRequestRoute.useSearch();
  const addingSeason = kind === 'season' || seriesId !== undefined;
  return (
    <div className="max-w-2xl">
      <h1 className="mb-4 text-xl font-semibold">Request an addition</h1>
      <nav aria-label="What to request" className="mb-4 flex flex-wrap gap-2">
        <Button asChild size="sm" variant={addingSeason ? 'outline' : 'default'}>
          <TextLink
            to="/requests/new"
            search={{}}
            aria-current={addingSeason ? undefined : 'true'}
            className="no-underline"
          >
            New series
          </TextLink>
        </Button>
        <Button asChild size="sm" variant={addingSeason ? 'default' : 'outline'}>
          <TextLink
            to="/requests/new"
            search={{ kind: 'season' }}
            aria-current={addingSeason ? 'true' : undefined}
            className="no-underline"
          >
            Season of an existing series
          </TextLink>
        </Button>
      </nav>
      {!addingSeason ?
        <NewSeriesForm />
      : seriesId === undefined ?
        <SeriesPicker />
      : <AddSeason key={seriesId} seriesId={seriesId} />}
    </div>
  );
}

export const newRequestRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/requests/new',
  validateSearch: z.object({
    kind: z.literal('season').optional().catch(undefined),
    seriesId: z.uuid().optional().catch(undefined),
  }),
  component: NewRequestPage,
});
