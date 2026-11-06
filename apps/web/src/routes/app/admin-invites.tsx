import type { AdminInviteRequest, InviteRequestStatus } from '@osusume/shared';
import { useQueryClient } from '@tanstack/react-query';
import { createRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { ActionButton, StatusFilter } from '@/components/admin';
import { ConfirmButton } from '@/components/confirm-button';
import { EmptyState, LoadMore, QueryFallback } from '@/components/states';
import { Badge } from '@/components/ui/badge';
import { api } from '@/lib/api';
import { request } from '@/lib/api-request';
import { useCursorList } from '@/lib/pagination';
import { adminRoute } from '@/routes/app/admin';

const statusLabels: Record<InviteRequestStatus, string> = {
  pending: 'Pending',
  approved: 'Approved',
  rejected: 'Rejected',
  accepted: 'Accepted',
  revoked: 'Revoked',
};

/** An approved invite past its date no longer works, though its status stays the same. */
function hasExpired(invite: AdminInviteRequest): boolean {
  return (
    invite.status === 'approved' &&
    invite.expiresAt !== null &&
    new Date(invite.expiresAt).getTime() <= Date.now()
  );
}

function InviteRow({ invite }: { invite: AdminInviteRequest }) {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['admin', 'invites'] });
  const decide = async (decision: 'approve' | 'reject') => {
    await request(
      api.admin['invite-requests'][':id'].decision.$post({ param: { id: invite.id }, json: { decision } }),
    );
    await refresh();
  };
  const expired = hasExpired(invite);

  return (
    <li className="flex flex-col gap-2 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4">
        <h2 className="min-w-0 font-medium wrap-anywhere">{invite.inviteeEmail}</h2>
        <Badge variant={invite.status === 'rejected' || expired ? 'destructive' : 'secondary'}>
          {expired ? 'Expired' : statusLabels[invite.status]}
        </Badge>
      </div>
      <p className="text-muted-foreground text-sm wrap-anywhere">
        Requested by {invite.requesterUsername ?? 'a removed user'} on{' '}
        {new Date(invite.createdAt).toLocaleDateString()}
        {invite.status === 'approved' &&
          invite.expiresAt !== null &&
          ` · ${expired ? 'expired' : 'expires'} ${new Date(invite.expiresAt).toLocaleDateString()}`}
      </p>
      <div className="flex flex-wrap gap-2">
        {invite.status === 'pending' && (
          <>
            <ActionButton label="Approve" variant="default" onAction={() => decide('approve')} />
            <ConfirmButton
              label="Reject"
              title={`Reject the invite for ${invite.inviteeEmail}?`}
              description="No email is sent, and this can't be undone. The address can be requested again."
              onConfirm={() => decide('reject')}
            />
          </>
        )}
        {invite.status === 'approved' && !expired && (
          <ConfirmButton
            label="Revoke"
            title={`Revoke the invite for ${invite.inviteeEmail}?`}
            description="The emailed link stops working straight away. The address can be requested again."
            onConfirm={async () => {
              await request(api.admin['invite-requests'][':id'].revoke.$post({ param: { id: invite.id } }));
              await refresh();
            }}
          />
        )}
      </div>
    </li>
  );
}

function AdminInvitesPage() {
  const [status, setStatus] = useState<InviteRequestStatus | ''>('pending');
  const { query, items } = useCursorList({
    queryKey: ['admin', 'invites', status],
    fetchPage: (cursor) =>
      request(
        api.admin['invite-requests'].$get({
          query: {
            ...(status === '' ? {} : { status }),
            ...(cursor === undefined ? {} : { cursor }),
          },
        }),
      ),
  });

  return (
    <>
      <h1 className="mb-4 text-xl font-semibold">Invite queue</h1>
      <StatusFilter value={status} labels={statusLabels} onChange={setStatus} />
      {query.data === undefined ?
        <QueryFallback query={query} />
      : items.length === 0 ?
        <EmptyState title="No invites here" />
      : <ul className="divide-y">
          {items.map((invite) => (
            <InviteRow key={invite.id} invite={invite} />
          ))}
        </ul>
      }
      <LoadMore query={query} />
    </>
  );
}

export const adminInvitesRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: 'invites',
  component: AdminInvitesPage,
});
