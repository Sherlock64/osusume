import { LIST_NOTE_MAX_LENGTH, listStatuses, listStatusLabels, type ListStatus } from '@osusume/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ChevronDown, Plus } from 'lucide-react';
import { useState } from 'react';
import { z } from 'zod';
import { ConfirmButton } from '@/components/confirm-button';
import { Form, SubmitButton, TextareaField } from '@/components/form';
import { QueryFallback } from '@/components/states';
import { StatusBadge } from '@/components/status-badge';
import { buttonVariants } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { api } from '@/lib/api';
import { request, toApiError } from '@/lib/api-request';
import { useForm } from '@/lib/form';
import { ownEntriesQuery, ownListKey, type OwnEntry } from '@/lib/own-list';

/** Sets a season's status, or adds it to the list, in one choice. `title` names it to screen readers. */
export function StatusMenu({
  seasonId,
  status,
  title,
}: {
  seasonId: string;
  status: ListStatus | null;
  title: string;
}) {
  const queryClient = useQueryClient();
  const change = useMutation({
    // Leaving out the note keeps the one already saved.
    mutationFn: async (next: ListStatus) => {
      await request(api.me.list[':seasonId'].$put({ param: { seasonId }, json: { status: next } }));
      await queryClient.invalidateQueries({ queryKey: ownListKey });
    },
  });
  const shown = change.isPending ? change.variables : status;

  return (
    <div className="flex min-w-0 flex-col items-start gap-1">
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={`${shown === null ? 'Add to list' : listStatusLabels[shown]}: ${title}`}
          aria-busy={change.isPending}
          className={buttonVariants({ variant: shown === null ? 'default' : 'outline' })}
        >
          {shown === null ?
            <>
              <Plus aria-hidden />
              Add to list
            </>
          : <StatusBadge status={shown} className="border-0 bg-transparent px-0" />}
          <ChevronDown className="opacity-60" aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          {listStatuses.map((option) => (
            <DropdownMenuItem
              key={option}
              disabled={change.isPending}
              aria-current={option === shown ? 'true' : undefined}
              className="min-h-11 justify-between gap-4 md:min-h-9"
              onSelect={() => {
                if (option !== status) change.mutate(option);
              }}
            >
              <StatusBadge status={option} className="border-0 bg-transparent px-0" />
              {option === shown && <Check className="size-4" aria-hidden />}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <span role="status" className="sr-only">
        {change.isSuccess ? `${title}: ${listStatusLabels[change.variables]}` : ''}
      </span>
      {change.isError && (
        <p role="alert" className="text-destructive text-sm">
          {toApiError(change.error).message}
        </p>
      )}
    </div>
  );
}

const noteFormSchema = z.object({ note: z.string().trim().max(LIST_NOTE_MAX_LENGTH) });

function NoteForm({
  seasonId,
  entry,
  saved,
  onSaved,
}: {
  seasonId: string;
  entry: OwnEntry;
  saved: boolean;
  onSaved: (saved: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const form = useForm({
    schema: noteFormSchema,
    onSubmit: async ({ note }) => {
      onSaved(false);
      await request(
        api.me.list[':seasonId'].$put({
          param: { seasonId },
          json: { status: entry.status, note: note || null },
        }),
      );
      await queryClient.invalidateQueries({ queryKey: ownListKey });
      onSaved(true);
    },
  });

  return (
    <Form form={form}>
      <TextareaField
        form={form}
        name="note"
        label="Note"
        hint="Only you can see this."
        defaultValue={entry.note ?? ''}
      />
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton form={form} variant="outline">
          Save note
        </SubmitButton>
        {saved && (
          <p role="status" className="text-muted-foreground text-sm">
            Saved.
          </p>
        )}
      </div>
    </Form>
  );
}

/** The private note on a listed season, and taking the season off the list. */
export function EntryDetails({ seasonId, entry }: { seasonId: string; entry: OwnEntry }) {
  const queryClient = useQueryClient();
  const [saved, setSaved] = useState(false);
  return (
    <div className="flex flex-col gap-4">
      {/* Keyed on the note, not the entry: changing the status must not wipe a note being typed. */}
      <NoteForm key={entry.note ?? ''} seasonId={seasonId} entry={entry} saved={saved} onSaved={setSaved} />
      <div>
        <ConfirmButton
          label="Remove from list"
          title="Remove this season from your list?"
          description="Its status and note will be deleted."
          confirmLabel="Remove"
          onConfirm={async () => {
            await request(api.me.list[':seasonId'].$delete({ param: { seasonId } }));
            await queryClient.invalidateQueries({ queryKey: ownListKey });
            setSaved(false);
          }}
        />
      </div>
    </div>
  );
}

/** Everything about one season on the user's list: its status, note and removal. */
export function ListEntryEditor({ seasonId, title }: { seasonId: string; title: string }) {
  const entries = useQuery(ownEntriesQuery);
  if (entries.data === undefined) return <QueryFallback query={entries} />;
  const entry = entries.data.get(seasonId);
  return (
    <div className="flex flex-col gap-4">
      <StatusMenu seasonId={seasonId} status={entry?.status ?? null} title={title} />
      {entry !== undefined && <EntryDetails seasonId={seasonId} entry={entry} />}
    </div>
  );
}
