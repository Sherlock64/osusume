import { SEARCH_QUERY_MAX_LENGTH, seasonsOfYear, type CatalogProposal } from '@osusume/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { z } from 'zod';
import { Form, SelectField, SubmitButton, TextareaField, TextField } from '@/components/form';
import { EmptyState, QueryFallback } from '@/components/states';
import { TextLink } from '@/components/text-link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelectOption } from '@/components/ui/native-select';
import { api } from '@/lib/api';
import { isNotFoundError, request } from '@/lib/api-request';
import { seasonOfYearLabels } from '@/lib/catalog-format';
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

function SeasonFields({ form, prefix = '' }: { form: FormState; prefix?: string }) {
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-[8rem_1fr]">
        <TextField form={form} name={`${prefix}ordinal`} label="Season number" inputMode="numeric" />
        <TextField form={form} name={`${prefix}title`} label="Season title" />
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <TextField form={form} name={`${prefix}year`} label="Year (optional)" inputMode="numeric" />
        <SelectField form={form} name={`${prefix}seasonOfYear`} label="Time of year (optional)">
          <NativeSelectOption value="">Not known</NativeSelectOption>
          {seasonsOfYear.map((season) => (
            <NativeSelectOption key={season} value={season}>
              {seasonOfYearLabels[season]}
            </NativeSelectOption>
          ))}
        </SelectField>
        <TextField
          form={form}
          name={`${prefix}episodeCount`}
          label="Episodes (optional)"
          inputMode="numeric"
        />
      </div>
      <TextareaField
        form={form}
        name={`${prefix}altTitles`}
        label="Alternate titles (optional)"
        hint="One per line."
      />
      <TextareaField form={form} name={`${prefix}synopsis`} label="Synopsis (optional)" />
    </>
  );
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
  const [searched, setSearched] = useState('');
  const results = useQuery({
    queryKey: ['series', searched, '', 'picker'],
    enabled: searched !== '',
    queryFn: () => request(api.series.$get({ query: { q: searched } })),
  });

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
          <Label htmlFor="request-series">Which series?</Label>
          <Input id="request-series" name="q" type="search" maxLength={SEARCH_QUERY_MAX_LENGTH} />
        </div>
        <Button type="submit" variant="outline">
          Search
        </Button>
      </form>
      {searched !== '' &&
        (results.data === undefined ?
          <QueryFallback query={results} />
        : results.data.items.length === 0 ?
          <EmptyState title="No series found" />
        : <ul className="flex flex-col gap-1">
            {results.data.items.map((series) => (
              <li key={series.id}>
                <Button
                  variant="ghost"
                  className="h-auto w-full justify-start text-left whitespace-normal wrap-anywhere"
                  onClick={() => {
                    void navigate({ search: { seriesId: series.id } });
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
