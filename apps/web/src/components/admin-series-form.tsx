import type { SeriesDetail } from '@osusume/shared';
import { useState } from 'react';
import { Form, SubmitButton, TextareaField, TextField } from '@/components/form';
import { TagPicker } from '@/components/tag-picker';
import { seriesFormSchema } from '@/lib/catalog-admin-form';
import { useForm } from '@/lib/form';
import type { z } from 'zod';

export type SeriesFields = z.output<typeof seriesFormSchema> & { tagIds: string[] };

/** Creates a series, or edits one if given. Starts over when the caller changes its `key`. */
export function SeriesForm({
  series,
  submitLabel,
  onSubmit,
}: {
  series?: SeriesDetail;
  submitLabel: string;
  onSubmit: (fields: SeriesFields) => Promise<unknown>;
}) {
  const [tagIds, setTagIds] = useState(() => series?.tags.map((tag) => tag.id) ?? []);
  const form = useForm({
    schema: seriesFormSchema,
    onSubmit: (fields) => onSubmit({ ...fields, tagIds }),
  });
  return (
    <Form form={form}>
      <TextField form={form} name="title" label="Series title" defaultValue={series?.title} />
      <TextareaField
        form={form}
        name="altTitles"
        label="Alternate titles (optional)"
        hint="One per line."
        className="min-h-16"
        defaultValue={series?.altTitles.join('\n')}
      />
      <TextareaField
        form={form}
        name="synopsis"
        label="Synopsis (optional)"
        defaultValue={series?.synopsis ?? undefined}
      />
      <TagPicker
        label="Tags (optional)"
        hint="These apply to every season of the series."
        selected={tagIds}
        onChange={setTagIds}
      />
      <div>
        <SubmitButton form={form}>{submitLabel}</SubmitButton>
      </div>
    </Form>
  );
}
