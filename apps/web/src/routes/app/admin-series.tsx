import type { SeriesDetail } from '@osusume/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createRoute, Link, useNavigate } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';
import { useState } from 'react';
import { AdminPanel } from '@/components/admin';
import { SeasonForm, SeasonRow } from '@/components/admin-season';
import { SeriesForm } from '@/components/admin-series-form';
import { SeriesImages } from '@/components/admin-series-images';
import { ConfirmButton } from '@/components/confirm-button';
import { PageHeader, SectionHeading } from '@/components/page-header';
import { EmptyState, QueryFallback } from '@/components/states';
import { TextLink } from '@/components/text-link';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button, buttonVariants } from '@/components/ui/button';
import { api } from '@/lib/api';
import { isNotFoundError, request } from '@/lib/api-request';
import { useFormRounds } from '@/lib/form';
import { adminRoute } from '@/routes/app/admin';

function SeriesDetails({ series }: { series: SeriesDetail }) {
  const queryClient = useQueryClient();
  const rounds = useFormRounds();
  return (
    <section className="flex min-w-0 flex-col">
      <SectionHeading>Details</SectionHeading>
      {rounds.message !== null && (
        <Alert role="status" className="mb-4">
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
    <section className="flex flex-col">
      <SectionHeading
        actions={
          <Button
            variant="outline"
            aria-expanded={adding}
            onClick={() => {
              setAdding((open) => !open);
            }}
          >
            {adding ? 'Close' : 'New season'}
          </Button>
        }
      >
        Seasons
      </SectionHeading>
      {moved !== null && (
        <Alert role="status" className="mb-4">
          <AlertDescription className="wrap-anywhere">{moved}</AlertDescription>
        </Alert>
      )}
      {adding && (
        <div className="mb-4">
          <AdminPanel>
            <SeasonForm
              seriesId={series.id}
              onSaved={() => {
                setAdding(false);
              }}
            />
          </AdminPanel>
        </div>
      )}
      {series.seasons.length === 0 ?
        <p className="text-muted-foreground text-sm">No seasons yet.</p>
      : <ul className="divide-y border-b">
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
    <>
      <PageHeader
        eyebrow={
          <TextLink to="/admin/catalog" className="inline-flex items-center gap-1 tracking-normal normal-case">
            <ArrowLeft className="size-3.5" aria-hidden />
            Manage catalog
          </TextLink>
        }
        title={series.data.title}
        actions={
          <Link to="/series/$id" params={{ id }} className={buttonVariants({ variant: 'outline' })}>
            See what members see
          </Link>
        }
      />
      <div className="flex flex-col gap-10">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <SeriesDetails series={series.data} />
          <section className="flex min-w-0 flex-col">
            <SectionHeading>Images</SectionHeading>
            <SeriesImages seriesId={id} seriesTitle={series.data.title} />
          </section>
        </div>
        <SeriesSeasons series={series.data} />
        <section className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
          <div className="min-w-0">
            <h2 className="font-sans text-base font-medium tracking-normal">Delete this series</h2>
            <p className="text-muted-foreground text-sm">
              Its images go with it. A series that still has seasons can't be deleted.
            </p>
          </div>
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
    </>
  );
}

export const adminSeriesRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: 'catalog/$id',
  component: AdminSeriesPage,
});
