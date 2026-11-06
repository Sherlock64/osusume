import { createRoute, Navigate, Outlet } from '@tanstack/react-router';
import { appRoute } from '@/routes/app';
import { PageNotFound } from '@/routes/app/not-found';

/**
 * Parent of every admin page. To anyone else these addresses don't exist, and because the pages
 * do their loading when they render, nothing is even requested.
 */
export const adminRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/admin',
  component: function AdminLayout() {
    const { user } = appRoute.useRouteContext();
    return user.role === 'admin' ? <Outlet /> : <PageNotFound />;
  },
});

export const adminIndexRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: '/',
  component: () => <Navigate to="/admin/invites" replace />,
});
