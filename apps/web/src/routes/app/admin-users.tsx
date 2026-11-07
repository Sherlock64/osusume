import type { AdminUser } from '@osusume/shared';
import { useQueryClient } from '@tanstack/react-query';
import { createRoute, useNavigate } from '@tanstack/react-router';
import { ActionButton, AdminRow } from '@/components/admin';
import { ConfirmButton } from '@/components/confirm-button';
import { PageHeader } from '@/components/page-header';
import { EmptyState, LoadMore, QueryFallback } from '@/components/states';
import { Badge } from '@/components/ui/badge';
import { api } from '@/lib/api';
import { request } from '@/lib/api-request';
import { useCursorList } from '@/lib/pagination';
import { sessionQuery } from '@/lib/session';
import { appRoute } from '@/routes/app';
import { adminRoute } from '@/routes/app/admin';

function UserActions({ target, isSelf }: { target: AdminUser; isSelf: boolean }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const param = { id: target.id };
  const route = api.admin.users[':id'];
  const name = isSelf ? 'your account' : target.username;
  const forSelf = (note: string) => (isSelf ? ` ${note}` : '');

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });

  /** Disabling or removing yourself ends your session, and the api has cleared its cookie. */
  const afterAccessEnds = async () => {
    if (!isSelf) return refresh();
    queryClient.clear();
    queryClient.setQueryData(sessionQuery.queryKey, null);
    await navigate({ to: '/login' });
  };

  /** Demoting yourself takes away the page you're on, and everything cached for it. */
  const afterRoleChange = async () => {
    if (!isSelf) return refresh();
    queryClient.removeQueries({ queryKey: ['admin'] });
    await queryClient.invalidateQueries({ queryKey: sessionQuery.queryKey });
    await navigate({ to: '/' });
  };

  return (
    <>
      {target.role === 'member' ?
        <ConfirmButton
          label="Promote"
          variant="outline"
          title={`Make ${name} an admin?`}
          description="Admins can approve invites and requests, change the catalog, and act on other accounts, including other admins."
          onConfirm={async () => {
            await request(route.promote.$post({ param }));
            await afterRoleChange();
          }}
        />
      : <ConfirmButton
          label="Demote"
          variant="outline"
          title={`Make ${name} a member?`}
          description={`This takes away every admin screen and action.${forSelf('You lose them straight away, and only another admin can promote you again.')}`}
          onConfirm={async () => {
            await request(route.demote.$post({ param }));
            await afterRoleChange();
          }}
        />
      }
      {target.disabledAt === null ?
        <ConfirmButton
          label="Disable"
          variant="outline"
          title={`Disable ${name}?`}
          description={`The account is signed out immediately and can't log in, and its list is hidden, including any public link. An admin can re-enable it.${forSelf('You will be signed out now, and only another admin can let you back in.')}`}
          onConfirm={async () => {
            await request(route.disable.$post({ param }));
            await afterAccessEnds();
          }}
        />
      : <ActionButton
          label="Re-enable"
          onAction={async () => {
            await request(route.enable.$post({ param }));
            await refresh();
          }}
        />
      }
      <ConfirmButton
        label="Remove"
        title={`Remove ${name}?`}
        description={`This permanently deletes the account with its list, settings, friendships and pending requests. Catalog content stays, with the name blanked from its history. The email can be invited again. This can't be undone.${forSelf('You will be signed out now.')}`}
        onConfirm={async () => {
          await request(route.remove.$post({ param }));
          await afterAccessEnds();
        }}
      />
      <ConfirmButton
        label="Ban"
        title={`Ban ${name}?`}
        description={`This does everything removing does, and also blocks ${target.email} from being invited again. This can't be undone.${forSelf('You will be signed out now.')}`}
        onConfirm={async () => {
          await request(route.ban.$post({ param }));
          await afterAccessEnds();
        }}
      />
    </>
  );
}

function UserRow({ target, isSelf }: { target: AdminUser; isSelf: boolean }) {
  return (
    <AdminRow
      title={
        <>
          {target.username}
          {isSelf && <span className="text-muted-foreground font-normal"> (you)</span>}
        </>
      }
      badges={
        <>
          <Badge variant="secondary">{target.role === 'admin' ? 'Admin' : 'Member'}</Badge>
          {target.isFirstAdmin && <Badge variant="secondary">First admin</Badge>}
          {target.disabledAt !== null && <Badge variant="destructive">Disabled</Badge>}
        </>
      }
      meta={
        <>
          <p>
            {target.email} · joined {new Date(target.createdAt).toLocaleDateString()}
          </p>
          {target.isFirstAdmin && <p>The first admin is permanent and can't be changed.</p>}
        </>
      }
      actions={!target.isFirstAdmin && <UserActions target={target} isSelf={isSelf} />}
    />
  );
}

function AdminUsersPage() {
  const { user } = appRoute.useRouteContext();
  const { query, items } = useCursorList({
    queryKey: ['admin', 'users'],
    fetchPage: (cursor) =>
      request(api.admin.users.$get({ query: cursor === undefined ? {} : { cursor } })),
  });

  return (
    <>
      <PageHeader
        className="mb-0"
        eyebrow="Admin"
        title="Users"
        description="Everyone with an account. Disabling can be reversed. Removing and banning can't."
      />
      {query.data === undefined ?
        <QueryFallback query={query} />
      : items.length === 0 ?
        <EmptyState title="No users" />
      : <ul className="divide-y border-b">
          {items.map((target) => (
            <UserRow key={target.id} target={target} isSelf={target.id === user.id} />
          ))}
        </ul>
      }
      <LoadMore query={query} />
    </>
  );
}

export const adminUsersRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: 'users',
  component: AdminUsersPage,
});
