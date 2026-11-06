import { seasonsOfYear, type SeasonOfYear } from '@osusume/shared';
import { SelectField, TextareaField, TextField } from '@/components/form';
import { NativeSelectOption } from '@/components/ui/native-select';
import { seasonOfYearLabels } from '@/lib/catalog-format';
import type { FormState } from '@/lib/form';

/** What the inputs start with, when editing a season or a proposed one. */
export interface SeasonFieldDefaults {
  ordinal: number;
  title: string;
  altTitles?: string[] | undefined;
  year?: number | null | undefined;
  seasonOfYear?: SeasonOfYear | null | undefined;
  episodeCount?: number | null | undefined;
  synopsis?: string | null | undefined;
}

export function SeasonFields({
  form,
  prefix = '',
  defaults,
}: {
  form: FormState;
  prefix?: string;
  defaults?: SeasonFieldDefaults | undefined;
}) {
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-[8rem_1fr]">
        <TextField
          form={form}
          name={`${prefix}ordinal`}
          label="Season number"
          inputMode="numeric"
          defaultValue={defaults?.ordinal}
        />
        <TextField form={form} name={`${prefix}title`} label="Season title" defaultValue={defaults?.title} />
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <TextField
          form={form}
          name={`${prefix}year`}
          label="Year (optional)"
          inputMode="numeric"
          defaultValue={defaults?.year ?? undefined}
        />
        <SelectField
          form={form}
          name={`${prefix}seasonOfYear`}
          label="Time of year (optional)"
          defaultValue={defaults?.seasonOfYear ?? ''}
        >
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
          defaultValue={defaults?.episodeCount ?? undefined}
        />
      </div>
      <TextareaField
        form={form}
        name={`${prefix}altTitles`}
        label="Alternate titles (optional)"
        hint="One per line."
        defaultValue={defaults?.altTitles?.join('\n')}
      />
      <TextareaField
        form={form}
        name={`${prefix}synopsis`}
        label="Synopsis (optional)"
        defaultValue={defaults?.synopsis ?? undefined}
      />
    </>
  );
}
