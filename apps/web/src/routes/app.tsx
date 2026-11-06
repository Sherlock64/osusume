import { createRoute, Outlet, redirect } from '@tanstack/react-router';
import { AppShell } from '@/components/app-shell';
import { anonymousTarget } from '@/lib/guards';
import { sessionQuery, setupStatusQuery } from '@/lib/session';
import { rootRoute } from '@/routes/root';

/**
 * Parent of every page that needs a login: it guards them and draws the shell. Children read the
 * user with `appRoute.useRouteContext()`.
 */
export const appRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'app',
  beforeLoad: async ({ context: { queryClient }, location }) => {
    const user = await queryClient.query(sessionQuery);
    if (user) return { user };
    const { open } = await queryClient.query(setupStatusQuery);
    throw redirect(anonymousTarget(open, location.href));
  },
  component: function AppLayout() {
    const { user } = appRoute.useRouteContext();
    return (
      <AppShell user={user}>
        <Outlet />
      </AppShell>
    );
  },
});
