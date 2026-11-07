import { createFriendRequestSchema, type FriendEntry, type FriendRelation } from '@osusume/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createRoute } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { ConfirmButton } from '@/components/confirm-button';
import { Form, SubmitButton, TextField } from '@/components/form';
import { PageHeader, SectionHeading } from '@/components/page-header';
import { EmptyState, LoadMore, QueryFallback } from '@/components/states';
import { TextLink } from '@/components/text-link';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { request, toApiError } from '@/lib/api-request';
import { useForm, useFormRounds, type FormRounds } from '@/lib/form';
import { useCursorList } from '@/lib/pagination';
import { cn } from '@/lib/utils';
import { appRoute } from '@/routes/app';

const friendsKey = ['friends'] as const;

function useRefreshFriends() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: friendsKey });
}

function AddFriendForm({ rounds }: { rounds: FormRounds }) {
  const refresh = useRefreshFriends();
  const form = useForm({
    schema: createFriendRequestSchema,
    onSubmit: async ({ username }) => {
      rounds.start();
      await request(api.friends.requests.$post({ json: { username } }));
      await refresh();
      rounds.finish(`Friend request sent to ${username}.`);
    },
  });
  return (
    <Form form={form}>
      <TextField
        form={form}
        name="username"
        label="Username"
        hint="The exact username."
        autoComplete="off"
      />
      <div>
        <SubmitButton form={form}>Send friend request</SubmitButton>
      </div>
    </Form>
  );
}

function AddFriend() {
  const rounds = useFormRounds();
  return (
    <section className="lg:sticky lg:top-20 lg:col-start-2 lg:row-start-1 lg:self-start">
      <SectionHeading>Add a friend</SectionHeading>
      <AddFriendForm key={rounds.formKey} rounds={rounds} />
      {rounds.message !== null && (
        <p role="status" className="text-muted-foreground mt-2 text-sm wrap-anywhere">
          {rounds.message}
        </p>
      )}
    </section>
  );
}

function FriendRow({ entry }: { entry: FriendEntry }) {
  const refresh = useRefreshFriends();
  const { id, relation, username } = entry;
  const param = { id };
  const action = useMutation({
    mutationFn: async (call: () => Promise<unknown>) => {
      await call();
      await refresh();
    },
  });

  let actions: ReactNode;
  if (relation === 'incoming') {
    actions = (
      <>
        <Button
          disabled={action.isPending}
          onClick={() => {
            action.mutate(() => request(api.friends.requests[':id'].accept.$post({ param })));
          }}
        >
          Accept
        </Button>
        <Button
          variant="outline"
          disabled={action.isPending}
          onClick={() => {
            action.mutate(() => request(api.friends.requests[':id'].decline.$post({ param })));
          }}
        >
          Decline
        </Button>
      </>
    );
  } else if (relation === 'outgoing') {
    actions = (
      <Button
        size="sm"
        variant="outline"
        disabled={action.isPending}
        onClick={() => {
          action.mutate(() => request(api.friends.requests[':id'].$delete({ param })));
        }}
      >
        Cancel request
      </Button>
    );
  } else {
    actions = (
      <ConfirmButton
        label="Unfriend"
        title={`Unfriend ${username}?`}
        description="You will need to send a new friend request to be friends again."
        onConfirm={async () => {
          await request(api.friends[':id'].$delete({ param }));
          await refresh();
        }}
      />
    );
  }

  return (
    <li className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3">
      <div className="flex min-w-0 items-center gap-3">
        <span
          aria-hidden
          className="font-heading border-foreground/25 flex size-10 shrink-0 items-center justify-center rounded-full border text-lg uppercase"
        >
          {username.slice(0, 1)}
        </span>
        <TextLink
          to="/users/$username"
          params={{ username }}
          className="min-w-0 text-base wrap-anywhere"
        >
          {username}
        </TextLink>
      </div>
      <div className="flex flex-wrap gap-2">{actions}</div>
      {action.isError && (
        <p role="alert" className="text-destructive w-full text-sm">
          {toApiError(action.error).message}
        </p>
      )}
    </li>
  );
}

function FriendSection({
  relation,
  title,
  empty,
}: {
  relation: FriendRelation;
  title: string;
  /** Without this, the section only appears when it has something in it. */
  empty?: ReactNode;
}) {
  const { query, items } = useCursorList({
    queryKey: [...friendsKey, relation],
    fetchPage: (cursor) =>
      request(
        api.friends.$get({ query: { relation, ...(cursor === undefined ? {} : { cursor }) } }),
      ),
  });
  if (empty === undefined && !query.isError && items.length === 0) return null;
  return (
    <section
      className={cn(relation === 'incoming' && 'border-primary-edge bg-card rounded-lg border p-4')}
    >
      <SectionHeading>{title}</SectionHeading>
      {query.data === undefined ?
        <QueryFallback query={query} />
      : items.length === 0 ?
        empty
      : <ul className="divide-y">
          {items.map((entry) => (
            <FriendRow key={entry.id} entry={entry} />
          ))}
        </ul>
      }
      <LoadMore query={query} />
    </section>
  );
}

function FriendsPage() {
  return (
    <>
      <PageHeader title="Friends" description="Friends can see a list set to Friends." />
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_20rem] lg:gap-12">
        <AddFriend />
        <div className="flex min-w-0 flex-col gap-8 lg:col-start-1 lg:row-start-1">
          <FriendSection relation="incoming" title="Requests for you" />
          <FriendSection
            relation="friend"
            title="Friends"
            empty={
              <EmptyState title="No friends yet">
                Send a request to someone by their username. Once they accept, you can see each
                other's friends-only lists.
              </EmptyState>
            }
          />
          <FriendSection relation="outgoing" title="Requests you sent" />
        </div>
      </div>
    </>
  );
}

export const friendsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/friends',
  component: FriendsPage,
});
