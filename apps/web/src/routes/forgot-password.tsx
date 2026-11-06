import { emailSchema } from '@osusume/shared';
import { createRoute, redirect } from '@tanstack/react-router';
import { useState } from 'react';
import { z } from 'zod';
import { Form, SubmitButton, TextField } from '@/components/form';
import { PublicCard } from '@/components/public-card';
import { TextLink } from '@/components/text-link';
import { authRequest } from '@/lib/api-request';
import { authClient } from '@/lib/auth-client';
import { useForm } from '@/lib/form';
import { setupStatusQuery } from '@/lib/session';
import { rootRoute } from '@/routes/root';

function ForgotPasswordPage() {
  const [sent, setSent] = useState(false);
  const form = useForm({
    schema: z.object({ email: emailSchema }),
    onSubmit: async ({ email }) => {
      await authRequest(authClient.requestPasswordReset({ email }));
      setSent(true);
    },
  });

  if (sent) {
    return (
      <PublicCard
        title="Check your email"
        description="If an account uses that address, we sent it a link to set a new password. The link works for 1 hour."
      >
        <TextLink to="/login">Back to log in</TextLink>
      </PublicCard>
    );
  }

  return (
    <PublicCard title="Forgot your password?" description="We'll email you a link to set a new one.">
      <Form form={form}>
        <TextField form={form} name="email" label="Email" type="email" autoComplete="email" />
        <SubmitButton form={form}>Send link</SubmitButton>
      </Form>
      <TextLink to="/login">Back to log in</TextLink>
    </PublicCard>
  );
}

export const forgotPasswordRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/forgot-password',
  beforeLoad: async ({ context: { queryClient } }) => {
    const { open } = await queryClient.query(setupStatusQuery);
    if (open) throw redirect({ to: '/setup' });
  },
  component: ForgotPasswordPage,
});
