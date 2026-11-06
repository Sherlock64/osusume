import { LIST_NOTE_MAX_LENGTH, listStatuses, listStatusSchema } from '@osusume/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { z } from 'zod';
import { ConfirmButton } from '@/components/confirm-button';
import { Form, SelectField, SubmitButton, TextareaField } from '@/components/form';
import { QueryFallback } from '@/components/states';
import { NativeSelectOption } from '@/components/ui/native-select';
import { api } from '@/lib/api';
import { request } from '@/lib/api-request';
import { useForm } from '@/lib/form';
import { listStatusLabels } from '@/lib/list-status';
import { ownEntriesQuery, ownListKey, type OwnEntry } from '@/lib/own-list';

const entryFormSchema = z.object({
  status: listStatusSchema.or(z.literal('')).refine((status) => status !== '', {
    error: 'Choose a status.',
  }),
  note: z.string().trim().max(LIST_NOTE_MAX_LENGTH),
});

function EntryForm({
  seasonId,
  entry,
  saved,
  onSaved,
}: {
  seasonId: string;
  entry: OwnEntry | null;
  saved: boolean;
  onSaved: (saved: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: ownListKey });
  const form = useForm({
    schema: entryFormSchema,
    onSubmit: async ({ status, note }) => {
      onSaved(false);
      await request(
        api.me.list[':seasonId'].$put({ param: { seasonId }, json: { status, note: note || null } }),
      );
      await refresh();
      onSaved(true);
    },
  });

  return (
    <div className="flex flex-col gap-3">
      <Form form={form}>
        <SelectField form={form} name="status" label="Status" defaultValue={entry?.status ?? ''}>
          {entry === null && <NativeSelectOption value="">Not on your list</NativeSelectOption>}
          {listStatuses.map((status) => (
            <NativeSelectOption key={status} value={status}>
              {listStatusLabels[status]}
            </NativeSelectOption>
          ))}
        </SelectField>
        <TextareaField
          form={form}
          name="note"
          label="Note"
          hint="Only you can see this."
          defaultValue={entry?.note ?? ''}
        />
        <div className="flex flex-wrap items-center gap-3">
          <SubmitButton form={form}>Save</SubmitButton>
          {saved && (
            <p role="status" className="text-muted-foreground text-sm">
              Saved.
            </p>
          )}
        </div>
      </Form>
      {entry !== null && (
        <div>
          <ConfirmButton
            label="Remove from list"
            title="Remove this season from your list?"
            description="Its status and note will be deleted."
            confirmLabel="Remove"
            onConfirm={async () => {
              await request(api.me.list[':seasonId'].$delete({ param: { seasonId } }));
              await refresh();
              onSaved(false);
            }}
          />
        </div>
      )}
    </div>
  );
}

/** Sets or removes the user's status and note for a season. */
export function ListEntryEditor({ seasonId }: { seasonId: string }) {
  const entries = useQuery(ownEntriesQuery);
  const [saved, setSaved] = useState(false);
  if (entries.data === undefined) return <QueryFallback query={entries} />;
  const entry = entries.data.get(seasonId) ?? null;
  return (
    <EntryForm
      // The form's fields start from the entry, so a changed entry starts them over.
      key={entry?.updatedAt ?? 'none'}
      seasonId={seasonId}
      entry={entry}
      saved={saved}
      onSaved={setSaved}
    />
  );
}
