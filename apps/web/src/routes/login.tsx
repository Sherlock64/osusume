import { useQueryClient } from '@tanstack/react-query';
import { createRoute, redirect, useRouter } from '@tanstack/react-router';
import { z } from 'zod';
import { Form, SubmitButton, TextField } from '@/components/form';
import { PublicCard } from '@/components/public-card';
import { TextLink } from '@/components/text-link';
import { authRequest } from '@/lib/api-request';
import { authClient } from '@/lib/auth-client';
import { useForm } from '@/lib/form';
import { safeRedirect } from '@/lib/guards';
import { sessionQuery, setupStatusQuery } from '@/lib/session';
import { PublicRouteError, rootRoute } from '@/routes/root';

// Only presence is checked: the rules for new credentials say nothing about existing ones.
const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

function LoginPage() {
  const { redirect: target } = loginRoute.useSearch();
  const queryClient = useQueryClient();
  const router = useRouter();
  const form = useForm({
    schema: loginSchema,
    onSubmit: async (values) => {
      await authRequest(authClient.signIn.username(values));
      queryClient.clear();
      await queryClient.query(sessionQuery);
      router.history.push(safeRedirect(target));
    },
  });

  return (
    <PublicCard
      title="Log in to Osusume"
      description="Invite only. Your anime list, your friends' lists, and the constellations between them."
    >
      <Form form={form}>
        <TextField form={form} name="username" label="Username" autoComplete="username" />
        <TextField
          form={form}
          name="password"
          label="Password"
          type="password"
          autoComplete="current-password"
        />
        <SubmitButton form={form}>Log in</SubmitButton>
      </Form>
      <TextLink to="/forgot-password">Forgot your password?</TextLink>
    </PublicCard>
  );
}

export const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  validateSearch: z.object({ redirect: z.string().optional().catch(undefined) }),
  beforeLoad: async ({ context: { queryClient }, search }) => {
    const user = await queryClient.query(sessionQuery);
    if (user) throw redirect({ href: safeRedirect(search.redirect) });
    const { open } = await queryClient.query(setupStatusQuery);
    if (open) throw redirect({ to: '/setup' });
  },
  component: LoginPage,
  errorComponent: PublicRouteError,
});
