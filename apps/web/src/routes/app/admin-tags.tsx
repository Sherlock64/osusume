import { createTagSchema, updateTagSchema, type Tag } from '@osusume/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { ConfirmButton } from '@/components/confirm-button';
import { Form, SubmitButton, TextField } from '@/components/form';
import { EmptyState, QueryFallback } from '@/components/states';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { request } from '@/lib/api-request';
import { tagsQuery } from '@/lib/catalog';
import { useForm, useFormRounds, type FormRounds } from '@/lib/form';
import { adminRoute } from '@/routes/app/admin';

function NewTagForm({ rounds }: { rounds: FormRounds }) {
  const queryClient = useQueryClient();
  const form = useForm({
    schema: createTagSchema,
    fieldForCode: { tag_name_taken: 'name' },
    onSubmit: async (json) => {
      rounds.start();
      const tag = await request(api.tags.$post({ json }));
      await queryClient.invalidateQueries({ queryKey: tagsQuery.queryKey });
      rounds.finish(`Added ${tag.name}.`);
    },
  });
  return (
    <Form form={form}>
      <TextField form={form} name="name" label="New tag" autoComplete="off" />
      <div>
        <SubmitButton form={form}>Add tag</SubmitButton>
      </div>
    </Form>
  );
}

function RenameForm({ tag, onDone }: { tag: Tag; onDone: () => void }) {
  const queryClient = useQueryClient();
  const form = useForm({
    schema: updateTagSchema,
    fieldForCode: { tag_name_taken: 'name' },
    onSubmit: async (json) => {
      await request(api.tags[':id'].$patch({ param: { id: tag.id }, json }));
      await queryClient.invalidateQueries();
      onDone();
    },
  });
  return (
    <Form form={form}>
      <TextField form={form} name="name" label="Name" defaultValue={tag.name} autoComplete="off" />
      <div className="flex flex-wrap gap-2">
        <SubmitButton form={form}>Save</SubmitButton>
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </Form>
  );
}

function TagRow({ tag }: { tag: Tag }) {
  const queryClient = useQueryClient();
  const [renaming, setRenaming] = useState(false);
  if (renaming) {
    return (
      <li className="py-3">
        <RenameForm
          tag={tag}
          onDone={() => {
            setRenaming(false);
          }}
        />
      </li>
    );
  }
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 py-3">
      <span className="min-w-0 wrap-anywhere">{tag.name}</span>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setRenaming(true);
          }}
        >
          Rename
        </Button>
        <ConfirmButton
          label="Delete"
          title={`Delete ${tag.name}?`}
          description="This detaches the tag from every series and season that uses it, and strips it from pending catalog requests. This can't be undone."
          onConfirm={async () => {
            await request(api.tags[':id'].$delete({ param: { id: tag.id } }));
            await queryClient.invalidateQueries();
          }}
        />
      </div>
    </li>
  );
}

function AdminTagsPage() {
  const rounds = useFormRounds();
  const tags = useQuery(tagsQuery);
  return (
    <>
      <h1 className="mb-4 text-xl font-semibold">Tags</h1>
      <div className="mb-6 max-w-md">
        {rounds.message !== null && (
          <Alert className="mb-4" role="status">
            <AlertDescription className="wrap-anywhere">{rounds.message}</AlertDescription>
          </Alert>
        )}
        <NewTagForm key={rounds.formKey} rounds={rounds} />
      </div>
      {tags.data === undefined ?
        <QueryFallback query={tags} />
      : tags.data.length === 0 ?
        <EmptyState title="No tags yet" />
      : <ul className="divide-y">
          {tags.data.map((tag) => (
            <TagRow key={tag.id} tag={tag} />
          ))}
        </ul>
      }
    </>
  );
}

export const adminTagsRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: 'tags',
  component: AdminTagsPage,
});
