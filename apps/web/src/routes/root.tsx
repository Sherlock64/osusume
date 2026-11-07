import type { QueryClient } from '@tanstack/react-query';
import {
  createRootRouteWithContext,
  Outlet,
  useRouter,
  type ErrorComponentProps,
} from '@tanstack/react-router';
import { PublicCard } from '@/components/public-card';
import { ErrorState } from '@/components/states';

export interface RouterContext {
  queryClient: QueryClient;
}

export const rootRoute = createRootRouteWithContext<RouterContext>()({ component: Outlet });

/** For a logged-out route whose guard fails, such as with the api unreachable. */
export function PublicRouteError({ error }: ErrorComponentProps) {
  const router = useRouter();
  return (
    <PublicCard title="This page didn't load">
      <ErrorState error={error} onRetry={() => void router.invalidate()} />
    </PublicCard>
  );
}
