import type { CatalogProposal } from '@osusume/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createRoute, Link, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { z } from 'zod';
import { Form, SubmitButton, TextareaField, TextField } from '@/components/form';
import { PageHeader } from '@/components/page-header';
import { SeasonFields, SeasonList } from '@/components/season-fields';
import { SeriesSearch } from '@/components/series-search';
import { EmptyState, QueryFallback } from '@/components/states';
import { TextLink } from '@/components/text-link';
import { Button, buttonVariants } from '@/components/ui/button';
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
  const [seasonKeys, setSeasonKeys] = useState<number[]>([]);

  return (
    <Form form={form}>
      <TextField form={form} name="title" label="Series title" />
      <TextareaField form={form} name="altTitles" label="Alternate titles (optional)" hint="One per line." />
      <TextareaField form={form} name="synopsis" label="Synopsis (optional)" />
      <SuggestedTagsField form={form} />
      <SeasonList form={form} seasonKeys={seasonKeys} onChange={setSeasonKeys} />
      <div>
        <SubmitButton form={form}>Send request</SubmitButton>
      </div>
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
      <div>
        <SubmitButton form={form}>Send request</SubmitButton>
      </div>
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
    <>
      <PageHeader
        title="Request an addition"
        description="Ask for a series or a season the catalog is missing."
        actions={
          <Link to="/requests" className={buttonVariants({ variant: 'outline' })}>
            My requests
          </Link>
        }
      />
      <div className="grid gap-8 lg:grid-cols-[minmax(0,36rem)_18rem] lg:justify-between">
        <div className="min-w-0">
          <nav aria-label="What to request" className="mb-6 flex flex-wrap gap-2">
            <Button asChild size="sm" variant={addingSeason ? 'outline' : 'default'}>
              <Link to="/requests/new" search={{}} aria-current={addingSeason ? undefined : 'true'}>
                New series
              </Link>
            </Button>
            <Button asChild size="sm" variant={addingSeason ? 'default' : 'outline'}>
              <Link
                to="/requests/new"
                search={{ kind: 'season' }}
                aria-current={addingSeason ? 'true' : undefined}
              >
                Season of an existing series
              </Link>
            </Button>
          </nav>
          {!addingSeason ?
            <NewSeriesForm />
          : seriesId === undefined ?
            <SeriesPicker />
          : <AddSeason key={seriesId} seriesId={seriesId} />}
        </div>
        <aside className="text-muted-foreground border-t pt-4 text-sm lg:border-t-0 lg:border-l lg:pt-0 lg:pl-6">
          <p className="eyebrow mb-2">How it works</p>
          <p>
            Check the <TextLink to="/catalog">catalog</TextLink> first. An admin reviews each
            request, may adjust it, and adds cover images once it's approved. You can follow it
            under <TextLink to="/requests">My requests</TextLink>.
          </p>
        </aside>
      </div>
    </>
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
