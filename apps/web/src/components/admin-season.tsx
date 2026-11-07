import type { Cover, Season, SeriesSummary } from '@osusume/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check } from 'lucide-react';
import { useState } from 'react';
import { AdminPanel, AdminRow } from '@/components/admin';
import { useSeriesImages } from '@/components/admin-series-images';
import { ConfirmButton } from '@/components/confirm-button';
import { CoverImage } from '@/components/cover-image';
import { Form, SubmitButton, TextField } from '@/components/form';
import { SeasonFields } from '@/components/season-fields';
import { SeriesSearch } from '@/components/series-search';
import { QueryFallback } from '@/components/states';
import { TagList } from '@/components/tag-list';
import { TagPicker } from '@/components/tag-picker';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { request, toApiError } from '@/lib/api-request';
import { moveSeasonFormSchema, seasonFormSchema } from '@/lib/catalog-admin-form';
import { formatAired } from '@/lib/catalog-format';
import { useForm } from '@/lib/form';
import { cn } from '@/lib/utils';

/** Adds a season to the series, or edits the one given. */
export function SeasonForm({
  seriesId,
  season,
  onSaved,
}: {
  seriesId: string;
  season?: Season;
  onSaved: () => void;
}) {
  const queryClient = useQueryClient();
  const [tagIds, setTagIds] = useState(() => season?.ownTags.map((tag) => tag.id) ?? []);
  const form = useForm({
    schema: seasonFormSchema,
    fieldForCode: { ordinal_taken: 'ordinal' },
    onSubmit: async (fields) => {
      const json = { ...fields, tagIds };
      await (season === undefined ?
        request(api.seasons.$post({ json: { ...json, seriesId } }))
      : request(api.seasons[':id'].$patch({ param: { id: season.id }, json })));
      await queryClient.invalidateQueries();
      onSaved();
    },
  });
  return (
    <Form form={form}>
      <SeasonFields form={form} defaults={season} />
      <TagPicker
        label="This season's own tags (optional)"
        hint="On top of the series' tags, which every season has."
        selected={tagIds}
        onChange={setTagIds}
      />
      <div>
        <SubmitButton form={form}>{season === undefined ? 'Add season' : 'Save season'}</SubmitButton>
      </div>
    </Form>
  );
}

/** Picks an image from the series' catalog for a season, or none to use the series primary. */
function SeasonCover({ season }: { season: Season }) {
  const queryClient = useQueryClient();
  const images = useSeriesImages(season.seriesId);
  const choose = useMutation({
    mutationFn: async (coverImageId: string | null) => {
      await request(api.seasons[':id'].$patch({ param: { id: season.id }, json: { coverImageId } }));
      await queryClient.invalidateQueries();
    },
  });
  if (images.data === undefined) return <QueryFallback query={images} />;

  const primary = images.data.find((image) => image.isPrimary) ?? null;
  const choices: { id: string | null; label: string; cover: Cover | null }[] = [
    { id: null, label: 'Series primary', cover: primary },
    ...images.data.map((image, index) => ({
      id: image.id,
      label: `Image ${String(index + 1)}`,
      cover: image,
    })),
  ];
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-sm font-medium">Cover</h3>
      {images.data.length === 0 ?
        <p className="text-muted-foreground text-sm">
          This series has no images yet, so a placeholder shows. Upload one above to choose it here.
        </p>
      : <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-3 xl:grid-cols-4">
          {choices.map((choice) => (
            <li key={choice.id ?? 'primary'} className="min-w-0">
              <button
                type="button"
                aria-pressed={season.coverImageId === choice.id}
                disabled={choose.isPending}
                className={cn(
                  'hover:bg-accent flex w-full cursor-pointer flex-col gap-1 rounded-md border p-1 text-left text-xs transition-colors disabled:cursor-default disabled:opacity-60',
                  season.coverImageId === choice.id && 'border-primary-edge bg-accent border-2 p-[3px] font-medium',
                )}
                onClick={() => {
                  choose.mutate(choice.id);
                }}
              >
                <CoverImage cover={choice.cover} size="small" alt="" title={season.title} />
                <span className="flex items-center gap-1">
                  {season.coverImageId === choice.id && <Check className="size-3 shrink-0" aria-hidden />}
                  {choice.label}
                </span>
              </button>
            </li>
          ))}
        </ul>
      }
      {choose.isError && (
        <p role="alert" className="text-destructive text-sm">
          {toApiError(choose.error).message}
        </p>
      )}
    </section>
  );
}

function MoveForm({
  season,
  target,
  onMoved,
}: {
  season: Season;
  target: SeriesSummary;
  onMoved: (message: string) => void;
}) {
  const queryClient = useQueryClient();
  const form = useForm({
    schema: moveSeasonFormSchema,
    fieldForCode: { ordinal_taken: 'ordinal' },
    onSubmit: async ({ ordinal }) => {
      await request(
        api.seasons[':id'].$patch({ param: { id: season.id }, json: { seriesId: target.id, ordinal } }),
      );
      onMoved(`Moved ${season.title} to ${target.title}.`);
      await queryClient.invalidateQueries();
    },
  });
  return (
    <Form form={form}>
      <p className="text-sm wrap-anywhere">
        Moving to <span className="font-medium">{target.title}</span>. List entries follow the season.
        {season.coverImageId !== null && " This season's own cover is cleared, as it belongs to this series."}
      </p>
      <TextField
        form={form}
        name="ordinal"
        label="Season number there"
        inputMode="numeric"
        defaultValue={season.ordinal}
      />
      <div>
        <SubmitButton form={form}>Move season</SubmitButton>
      </div>
    </Form>
  );
}

function SeasonMove({ season, onMoved }: { season: Season; onMoved: (message: string) => void }) {
  const [target, setTarget] = useState<SeriesSummary | null>(null);
  return (
    <section className="flex flex-col gap-3 border-t pt-4">
      <h3 className="text-sm font-medium">Move to another series</h3>
      <SeriesSearch label="Which series?" excludeId={season.seriesId} onPick={setTarget} />
      {target !== null && <MoveForm key={target.id} season={season} target={target} onMoved={onMoved} />}
    </section>
  );
}

export function SeasonRow({ season, onMoved }: { season: Season; onMoved: (message: string) => void }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const details = [
    formatAired(season.year, season.seasonOfYear),
    season.episodeCount === null ? null : `${String(season.episodeCount)} episodes`,
  ].filter((part) => part !== null);

  return (
    <AdminRow
      heading="h3"
      leading={<CoverImage cover={season.cover} size="small" alt="" title={season.title} className="w-12 shrink-0 self-start" />}
      title={`Season ${String(season.ordinal)}: ${season.title}`}
      meta={
        <>
          {details.length > 0 && <p>{details.join(' · ')}</p>}
          <TagList tags={season.ownTags} />
        </>
      }
      actions={
        <>
          <Button
            variant="outline"
            size="sm"
            aria-expanded={open}
            onClick={() => {
              setOpen((next) => !next);
            }}
          >
            {open ? 'Close' : 'Edit'}
          </Button>
          <ConfirmButton
            label="Delete"
            title={`Delete ${season.title}?`}
            description="This can't be undone. A season on anyone's list can't be deleted."
            onConfirm={async () => {
              await request(api.seasons[':id'].$delete({ param: { id: season.id } }));
              await queryClient.invalidateQueries();
            }}
          />
        </>
      }
    >
      {open && (
        <AdminPanel
          aside={
            <>
              <SeasonCover season={season} />
              <SeasonMove season={season} onMoved={onMoved} />
            </>
          }
        >
          <SeasonForm
            seriesId={season.seriesId}
            season={season}
            onSaved={() => {
              setOpen(false);
            }}
          />
        </AdminPanel>
      )}
    </AdminRow>
  );
}
