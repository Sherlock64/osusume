import { createRouter, useRouter } from '@tanstack/react-router';
import { ErrorState } from '@/components/states';
import { createQueryClient } from '@/lib/query-client';
import { sessionQuery } from '@/lib/session';
import { acceptInviteRoute } from '@/routes/accept-invite';
import { appRoute } from '@/routes/app';
import { homeRoute } from '@/routes/app/home';
import { notFoundRoute } from '@/routes/app/not-found';
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
    appRoute.addChildren([homeRoute, notFoundRoute]),
  ]),
  context: { queryClient },
  defaultErrorComponent: RouteError,
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
