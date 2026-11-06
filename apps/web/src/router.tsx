import { createRouter, useRouter } from '@tanstack/react-router';
import { ErrorState } from '@/components/states';
import { createQueryClient } from '@/lib/query-client';
import { sessionQuery } from '@/lib/session';
import { acceptInviteRoute } from '@/routes/accept-invite';
import { appRoute } from '@/routes/app';
import { adminIndexRoute, adminRoute } from '@/routes/app/admin';
import { adminCatalogRoute } from '@/routes/app/admin-catalog';
import { adminInvitesRoute } from '@/routes/app/admin-invites';
import { adminRequestsRoute } from '@/routes/app/admin-requests';
import { adminSeriesRoute } from '@/routes/app/admin-series';
import { adminTagsRoute } from '@/routes/app/admin-tags';
import { adminUsernameChangesRoute } from '@/routes/app/admin-username-changes';
import { adminUsersRoute } from '@/routes/app/admin-users';
import { catalogRoute } from '@/routes/app/catalog';
import { compareRoute } from '@/routes/app/compare';
import { memberCanvasRoute, ownCanvasRoute } from '@/routes/app/constellations';
import { friendsRoute } from '@/routes/app/friends';
import { homeRoute } from '@/routes/app/home';
import { invitesRoute } from '@/routes/app/invites';
import { memberListRoute } from '@/routes/app/member-list';
import { notFoundRoute } from '@/routes/app/not-found';
import { newRequestRoute } from '@/routes/app/new-request';
import { requestsRoute } from '@/routes/app/requests';
import { seasonRoute } from '@/routes/app/season';
import { seriesRoute } from '@/routes/app/series';
import { settingsRoute } from '@/routes/app/settings';
import { forgotPasswordRoute } from '@/routes/forgot-password';
import { loginRoute } from '@/routes/login';
import { publicListRoute } from '@/routes/public-list';
import { resetPasswordRoute } from '@/routes/reset-password';
import { rootRoute } from '@/routes/root';
import { setupRoute } from '@/routes/setup';
import { verifyChangeRoute, verifySetupRoute } from '@/routes/verify-email';

export const queryClient = createQueryClient(() => {
  queryClient.clear();
  queryClient.setQueryData(sessionQuery.queryKey, null);
  // Reruns the guards, which send the visitor to login.
  void router.invalidate();
});

/** Shown when a guard or route fails to load, such as with the api unreachable. */
function RouteError({ error }: { error: unknown }) {
  const router = useRouter();
  return <ErrorState error={error} onRetry={() => void router.invalidate()} />;
}

export const router = createRouter({
  routeTree: rootRoute.addChildren([
    setupRoute,
    loginRoute,
    forgotPasswordRoute,
    resetPasswordRoute,
    acceptInviteRoute,
    verifySetupRoute,
    verifyChangeRoute,
    publicListRoute,
    // Pages that need a login go here, and in `@/app/nav` if they get a menu entry.
    appRoute.addChildren([
      homeRoute,
      catalogRoute,
      seriesRoute,
      seasonRoute,
      requestsRoute,
      newRequestRoute,
      memberListRoute,
      ownCanvasRoute,
      memberCanvasRoute,
      friendsRoute,
      compareRoute,
      invitesRoute,
      settingsRoute,
      adminRoute.addChildren([
        adminIndexRoute,
        adminInvitesRoute,
        adminRequestsRoute,
        adminCatalogRoute,
        adminSeriesRoute,
        adminTagsRoute,
        adminUsersRoute,
        adminUsernameChangesRoute,
      ]),
      notFoundRoute,
    ]),
  ]),
  context: { queryClient },
  defaultErrorComponent: RouteError,
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
