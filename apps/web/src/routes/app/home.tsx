import { createRoute } from '@tanstack/react-router';
import { EmptyState } from '@/components/states';
import { appRoute } from '@/routes/app';

/** A stand-in for the my list screen. */
function HomePage() {
  const { user } = appRoute.useRouteContext();
  return <EmptyState title={`Welcome, ${user.username}`} />;
}

export const homeRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/',
  component: HomePage,
});
