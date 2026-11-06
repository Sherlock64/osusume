import { createRoute } from '@tanstack/react-router';
import { EmptyState } from '@/components/states';
import { TextLink } from '@/components/text-link';
import { appRoute } from '@/routes/app';

/** A catch-all under the guard, so anonymous visitors to an unknown path go to login. */
export const notFoundRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '$',
  component: function NotFoundPage() {
    return (
      <EmptyState title="Page not found">
        <TextLink to="/">Go home</TextLink>
      </EmptyState>
    );
  },
});
