import {
  usernameChangeRequestStatuses,
  type AdminUsernameChangeRequest,
  type UsernameChangeRequestStatus,
} from '@osusume/shared';
import { useQueryClient } from '@tanstack/react-query';
import { createRoute, useRouter } from '@tanstack/react-router';
import { useState } from 'react';
import { ActionButton, AdminRow, QueueBadge, StatusFilter } from '@/components/admin';
import { ConfirmButton } from '@/components/confirm-button';
import { PageHeader } from '@/components/page-header';
import { EmptyState, LoadMore, QueryFallback } from '@/components/states';
import { api } from '@/lib/api';
import { request } from '@/lib/api-request';
import { useCursorList } from '@/lib/pagination';
import { appRoute } from '@/routes/app';
import { adminRoute } from '@/routes/app/admin';

function ChangeRow({ change }: { change: AdminUsernameChangeRequest }) {
  const { user } = appRoute.useRouteContext();
  const queryClient = useQueryClient();
  const router = useRouter();
  const decide = async (decision: 'approve' | 'reject') => {
    await request(
      api.admin['username-change-requests'][':id'].decision.$post({
        param: { id: change.id },
        json: { decision },
      }),
    );
    // A name appears throughout the app. Their own also sits in the shell, via the route context.
    await queryClient.invalidateQueries();
    if (change.userId === user.id) await router.invalidate();
  };

  return (
    <AdminRow
      title={
        change.status === 'pending' ?
          `${change.currentUsername} → ${change.requestedUsername}`
        : change.requestedUsername
      }
      badges={<QueueBadge state={change.status} />}
      meta={
        <p>
          Requested on {new Date(change.createdAt).toLocaleDateString()}
          {change.status !== 'pending' && ` · account now named ${change.currentUsername}`}
        </p>
      }
      actions={
        change.status === 'pending' && (
          <>
            <ActionButton label="Approve" variant="default" onAction={() => decide('approve')} />
            <ConfirmButton
              label="Reject"
              title={`Reject ${change.requestedUsername}?`}
              description={`${change.currentUsername} keeps their current username, and can request another.`}
              onConfirm={() => decide('reject')}
            />
          </>
        )
      }
    />
  );
}

function AdminUsernameChangesPage() {
  const [status, setStatus] = useState<UsernameChangeRequestStatus | ''>('pending');
  const { query, items } = useCursorList({
    queryKey: ['admin', 'username-changes', status],
    fetchPage: (cursor) =>
      request(
        api.admin['username-change-requests'].$get({
          query: {
            ...(status === '' ? {} : { status }),
            ...(cursor === undefined ? {} : { cursor }),
          },
        }),
      ),
  });

  return (
    <>
      <PageHeader
        eyebrow="Admin"
        title="Username changes"
        description="Names members have asked to switch to. Approving renames the account straight away."
      />
      <StatusFilter value={status} statuses={usernameChangeRequestStatuses} onChange={setStatus} />
      {query.data === undefined ?
        <QueryFallback query={query} />
      : items.length === 0 ?
        <EmptyState title={status === 'pending' ? 'No username changes are waiting' : 'No username changes here'} />
      : <ul className="divide-y border-b">
          {items.map((change) => (
            <ChangeRow key={change.id} change={change} />
          ))}
        </ul>
      }
      <LoadMore query={query} />
    </>
  );
}

export const adminUsernameChangesRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: 'username-changes',
  component: AdminUsernameChangesPage,
});
