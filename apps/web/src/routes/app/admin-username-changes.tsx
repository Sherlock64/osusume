import type { AdminUsernameChangeRequest, UsernameChangeRequestStatus } from '@osusume/shared';
import { useQueryClient } from '@tanstack/react-query';
import { createRoute, useRouter } from '@tanstack/react-router';
import { useState } from 'react';
import { ActionButton, StatusFilter } from '@/components/admin';
import { ConfirmButton } from '@/components/confirm-button';
import { EmptyState, LoadMore, QueryFallback } from '@/components/states';
import { Badge } from '@/components/ui/badge';
import { api } from '@/lib/api';
import { request } from '@/lib/api-request';
import { useCursorList } from '@/lib/pagination';
import { appRoute } from '@/routes/app';
import { adminRoute } from '@/routes/app/admin';

const statusLabels: Record<UsernameChangeRequestStatus, string> = {
  pending: 'Pending',
  approved: 'Approved',
  rejected: 'Rejected',
};

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
    <li className="flex flex-col gap-2 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4">
        <h2 className="min-w-0 font-medium wrap-anywhere">
          {change.status === 'pending' ?
            `${change.currentUsername} → ${change.requestedUsername}`
          : change.requestedUsername}
        </h2>
        <Badge variant={change.status === 'rejected' ? 'destructive' : 'secondary'}>
          {statusLabels[change.status]}
        </Badge>
      </div>
      <p className="text-muted-foreground text-sm">
        Requested on {new Date(change.createdAt).toLocaleDateString()}
        {change.status !== 'pending' && ` · account now named ${change.currentUsername}`}
      </p>
      {change.status === 'pending' && (
        <div className="flex flex-wrap gap-2">
          <ActionButton label="Approve" variant="default" onAction={() => decide('approve')} />
          <ConfirmButton
            label="Reject"
            title={`Reject ${change.requestedUsername}?`}
            description={`${change.currentUsername} keeps their current username, and can request another.`}
            onConfirm={() => decide('reject')}
          />
        </div>
      )}
    </li>
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
      <h1 className="mb-4 text-xl font-semibold">Username changes</h1>
      <StatusFilter value={status} labels={statusLabels} onChange={setStatus} />
      {query.data === undefined ?
        <QueryFallback query={query} />
      : items.length === 0 ?
        <EmptyState title="No username changes here" />
      : <ul className="divide-y">
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
