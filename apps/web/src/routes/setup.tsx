import { setupRequestSchema } from '@osusume/shared';
import { useQueryClient } from '@tanstack/react-query';
import { createRoute, redirect, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { Form, SubmitButton, TextField } from '@/components/form';
import { PublicCard } from '@/components/public-card';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { ApiError, request } from '@/lib/api-request';
import { useForm } from '@/lib/form';
import { sessionQuery, setupStatusQuery } from '@/lib/session';
import { rootRoute } from '@/routes/root';

function SetupPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [sentTo, setSentTo] = useState<string | null>(null);
  const form = useForm({
    schema: setupRequestSchema,
    onSubmit: async (values) => {
      try {
        await request(api.setup.$post({ json: values }));
        setSentTo(values.email);
      } catch (error) {
        if (error instanceof ApiError && error.code === 'setup_closed') {
          queryClient.setQueryData(setupStatusQuery.queryKey, { open: false });
          await navigate({ to: '/login' });
          return;
        }
        throw error;
      }
    },
  });

  if (sentTo !== null) {
    return (
      <PublicCard
        title="Check your email"
        description={`We sent a link to ${sentTo}. The admin account is created when you use it. The link works for 24 hours.`}
      >
        <Button
          variant="outline"
          onClick={() => {
            setSentTo(null);
          }}
        >
          Start again with different details
        </Button>
      </PublicCard>
    );
  }

  return (
    <PublicCard
      title="Set up Osusume"
      description="Create the first admin account. This account is permanent."
    >
      <Form form={form}>
        <TextField
          form={form}
          name="username"
          label="Username"
          autoComplete="username"
          hint="3-30 letters, digits, underscores and dots."
        />
        <TextField form={form} name="email" label="Email" type="email" autoComplete="email" />
        <TextField
          form={form}
          name="password"
          label="Password"
          type="password"
          autoComplete="new-password"
          hint="At least 12 characters."
        />
        <SubmitButton form={form}>Send verification link</SubmitButton>
      </Form>
    </PublicCard>
  );
}

export const setupRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/setup',
  beforeLoad: async ({ context: { queryClient } }) => {
    const { open } = await queryClient.query(setupStatusQuery);
    if (open) return;
    const user = await queryClient.query(sessionQuery);
    throw redirect({ to: user ? '/' : '/login' });
  },
  component: SetupPage,
});
