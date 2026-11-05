import { useQuery } from '@tanstack/react-query';
import { createRootRoute, createRoute, createRouter, Outlet } from '@tanstack/react-router';
import { api } from '@/lib/api';

const rootRoute = createRootRoute({ component: Outlet });

function Placeholder() {
  const health = useQuery({
    queryKey: ['health'],
    queryFn: async () => {
      const response = await api.health.$get();
      return response.json();
    },
  });

  return (
    <main className="mx-auto max-w-xl p-6">
      <h1 className="text-2xl font-semibold">Osusume</h1>
      <p className="text-muted-foreground mt-2 text-sm">
        API: {health.data?.status ?? (health.isError ? 'unreachable' : 'checking')}
      </p>
    </main>
  );
}

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: Placeholder,
});

export const router = createRouter({
  routeTree: rootRoute.addChildren([indexRoute]),
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
