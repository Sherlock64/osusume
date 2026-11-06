import { createFriendRequestSchema, type FriendEntry, type FriendRelation } from '@osusume/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createRoute } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { ConfirmButton } from '@/components/confirm-button';
import { Form, SubmitButton, TextField } from '@/components/form';
import { LoadMore, QueryFallback } from '@/components/states';
import { TextLink } from '@/components/text-link';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { request, toApiError } from '@/lib/api-request';
import { useForm, useFormRounds, type FormRounds } from '@/lib/form';
import { useCursorList } from '@/lib/pagination';
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
    <section className="mb-6 max-w-md">
      <h2 className="mb-2 font-medium">Add a friend</h2>
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
          size="sm"
          disabled={action.isPending}
          onClick={() => {
            action.mutate(() => request(api.friends.requests[':id'].accept.$post({ param })));
          }}
        >
          Accept
        </Button>
        <Button
          size="sm"
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
    <li className="flex flex-wrap items-center justify-between gap-2 py-2">
      <TextLink to="/users/$username" params={{ username }} className="min-w-0 wrap-anywhere">
        {username}
      </TextLink>
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
  empty: string;
}) {
  const { query, items } = useCursorList({
    queryKey: [...friendsKey, relation],
    fetchPage: (cursor) =>
      request(
        api.friends.$get({ query: { relation, ...(cursor === undefined ? {} : { cursor }) } }),
      ),
  });
  return (
    <section className="mb-6">
      <h2 className="mb-1 font-medium">{title}</h2>
      {query.data === undefined ?
        <QueryFallback query={query} />
      : items.length === 0 ?
        <p className="text-muted-foreground text-sm">{empty}</p>
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
      <h1 className="mb-4 text-xl font-semibold">Friends</h1>
      <AddFriend />
      <FriendSection relation="incoming" title="Requests for you" empty="No requests for you." />
      <FriendSection relation="outgoing" title="Requests you sent" empty="No requests waiting." />
      <FriendSection relation="friend" title="Friends" empty="No friends yet." />
    </>
  );
}

export const friendsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/friends',
  component: FriendsPage,
});
