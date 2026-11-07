import { createTagSchema, updateTagSchema, type Tag } from '@osusume/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { AdminPanel } from '@/components/admin';
import { ConfirmButton } from '@/components/confirm-button';
import { Form, SubmitButton, TextField } from '@/components/form';
import { PageHeader } from '@/components/page-header';
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
      {/* The Rename button it replaces had the focus. */}
      <TextField form={form} name="name" label="Name" defaultValue={tag.name} autoComplete="off" autoFocus />
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
  // Set once a rename closes, so the Rename button it replaced takes the focus back.
  const [renamed, setRenamed] = useState(false);
  if (renaming) {
    return (
      <li className="border-b py-3">
        <AdminPanel>
          <RenameForm
            tag={tag}
            onDone={() => {
              setRenaming(false);
              setRenamed(true);
            }}
          />
        </AdminPanel>
      </li>
    );
  }
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 border-b py-2">
      <span className="min-w-0 text-sm font-medium wrap-anywhere">{tag.name}</span>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          autoFocus={renamed}
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
      <PageHeader
        eyebrow="Admin"
        title="Tags"
        description="The words members can filter by. A change reaches every series using the tag."
      />
      <div className="grid gap-8 lg:grid-cols-[18rem_minmax(0,1fr)] lg:gap-10">
        <div className="min-w-0">
          {rounds.message !== null && (
            <Alert className="mb-4" role="status">
              <AlertDescription className="wrap-anywhere">{rounds.message}</AlertDescription>
            </Alert>
          )}
          <NewTagForm key={rounds.formKey} rounds={rounds} />
        </div>
        <div className="min-w-0">
          {tags.data === undefined ?
            <QueryFallback query={tags} />
          : tags.data.length === 0 ?
            <EmptyState title="No tags yet" />
          : <ul className="grid gap-x-8 md:grid-cols-2">
              {tags.data.map((tag) => (
                <TagRow key={tag.id} tag={tag} />
              ))}
            </ul>
          }
        </div>
      </div>
    </>
  );
}

export const adminTagsRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: 'tags',
  component: AdminTagsPage,
});
