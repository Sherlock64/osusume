import { inviteRequestStatuses, type AdminInviteRequest, type InviteRequestStatus } from '@osusume/shared';
import { useQueryClient } from '@tanstack/react-query';
import { createRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { ActionButton, AdminRow, QueueBadge, StatusFilter } from '@/components/admin';
import { ConfirmButton } from '@/components/confirm-button';
import { PageHeader } from '@/components/page-header';
import { EmptyState, LoadMore, QueryFallback } from '@/components/states';
import { api } from '@/lib/api';
import { request } from '@/lib/api-request';
import { useCursorList } from '@/lib/pagination';
import { adminRoute } from '@/routes/app/admin';

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
    <AdminRow
      title={invite.inviteeEmail}
      badges={<QueueBadge state={expired ? 'expired' : invite.status} />}
      meta={
        <p>
          Requested by {invite.requesterUsername ?? 'a removed user'} on{' '}
          {new Date(invite.createdAt).toLocaleDateString()}
          {invite.status === 'approved' &&
            invite.expiresAt !== null &&
            ` · ${expired ? 'expired' : 'expires'} ${new Date(invite.expiresAt).toLocaleDateString()}`}
        </p>
      }
      actions={
        (invite.status === 'pending' || (invite.status === 'approved' && !expired)) && (
          <>
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
          </>
        )
      }
    />
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
      <PageHeader
        eyebrow="Admin"
        title="Invite queue"
        description="Addresses members have asked to invite. Approving emails them a link."
      />
      <StatusFilter value={status} statuses={inviteRequestStatuses} onChange={setStatus} />
      {query.data === undefined ?
        <QueryFallback query={query} />
      : items.length === 0 ?
        <EmptyState title={status === 'pending' ? 'No invites are waiting' : 'No invites here'} />
      : <ul className="divide-y border-b">
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
