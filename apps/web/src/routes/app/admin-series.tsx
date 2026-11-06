import type { SeriesDetail } from '@osusume/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { SeasonForm, SeasonRow } from '@/components/admin-season';
import { SeriesForm } from '@/components/admin-series-form';
import { SeriesImages } from '@/components/admin-series-images';
import { ConfirmButton } from '@/components/confirm-button';
import { EmptyState, QueryFallback } from '@/components/states';
import { TextLink } from '@/components/text-link';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { isNotFoundError, request } from '@/lib/api-request';
import { useFormRounds } from '@/lib/form';
import { adminRoute } from '@/routes/app/admin';

function SeriesDetails({ series }: { series: SeriesDetail }) {
  const queryClient = useQueryClient();
  const rounds = useFormRounds();
  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold">Details</h2>
      {rounds.message !== null && (
        <Alert role="status">
          <AlertDescription>{rounds.message}</AlertDescription>
        </Alert>
      )}
      <SeriesForm
        key={rounds.formKey}
        series={series}
        submitLabel="Save series"
        onSubmit={async (json) => {
          rounds.start();
          await request(api.series[':id'].$patch({ param: { id: series.id }, json }));
          // Before the form starts over, so that it starts from what was saved.
          await queryClient.invalidateQueries();
          rounds.finish('Saved.');
        }}
      />
    </section>
  );
}

function SeriesSeasons({ series }: { series: SeriesDetail }) {
  const [adding, setAdding] = useState(false);
  const [moved, setMoved] = useState<string | null>(null);
  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">Seasons</h2>
        <Button
          variant="outline"
          aria-expanded={adding}
          onClick={() => {
            setAdding((open) => !open);
          }}
        >
          {adding ? 'Close' : 'New season'}
        </Button>
      </div>
      {moved !== null && (
        <Alert role="status">
          <AlertDescription className="wrap-anywhere">{moved}</AlertDescription>
        </Alert>
      )}
      {adding && (
        <div className="rounded-md border p-3">
          <SeasonForm
            seriesId={series.id}
            onSaved={() => {
              setAdding(false);
            }}
          />
        </div>
      )}
      {series.seasons.length === 0 ?
        <p className="text-muted-foreground text-sm">No seasons yet.</p>
      : <ul className="divide-y">
          {series.seasons.map((season) => (
            <SeasonRow key={season.id} season={season} onMoved={setMoved} />
          ))}
        </ul>
      }
    </section>
  );
}

function AdminSeriesPage() {
  const { id } = adminSeriesRoute.useParams();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const series = useQuery({
    queryKey: ['series-detail', id],
    queryFn: () => request(api.series[':id'].$get({ param: { id } })),
  });
  if (series.isError && isNotFoundError(series.error)) {
    return (
      <EmptyState title="Series not found">
        <TextLink to="/admin/catalog">Back to the catalog</TextLink>
      </EmptyState>
    );
  }
  if (series.data === undefined) return <QueryFallback query={series} />;

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-1">
        <p className="text-sm">
          <TextLink to="/admin/catalog">Manage catalog</TextLink>
        </p>
        <h1 className="text-xl font-semibold wrap-anywhere">{series.data.title}</h1>
        <p className="text-sm">
          <TextLink to="/series/$id" params={{ id }}>
            See what members see
          </TextLink>
        </p>
      </div>
      <SeriesDetails series={series.data} />
      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold">Images</h2>
        <SeriesImages seriesId={id} />
      </section>
      <SeriesSeasons series={series.data} />
      <section className="flex flex-col items-start gap-2 border-t pt-4">
        <ConfirmButton
          label="Delete series"
          title={`Delete ${series.data.title}?`}
          description="Its image catalog and files are deleted and its pending add-season requests are rejected. A series that still has seasons can't be deleted. This can't be undone."
          onConfirm={async () => {
            await request(api.series[':id'].$delete({ param: { id } }));
            await navigate({ to: '/admin/catalog' });
            await queryClient.invalidateQueries();
          }}
        />
      </section>
    </div>
  );
}

export const adminSeriesRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: 'catalog/$id',
  component: AdminSeriesPage,
});
