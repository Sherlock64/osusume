import { passwordSchema } from '@osusume/shared';
import { useQueryClient } from '@tanstack/react-query';
import { createRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { z } from 'zod';
import { Form, SubmitButton, TextField } from '@/components/form';
import { PublicCard } from '@/components/public-card';
import { TextLink } from '@/components/text-link';
import { ApiError, authRequest } from '@/lib/api-request';
import { authClient } from '@/lib/auth-client';
import { useForm } from '@/lib/form';
import { rootRoute } from '@/routes/root';
import { tokenSearchSchema } from '@/routes/search';

function DeadLink() {
  return (
    <PublicCard
      title="This link isn't valid"
      description="It may have expired or already been used."
    >
      <TextLink to="/forgot-password">Request a new link</TextLink>
    </PublicCard>
  );
}

function ResetForm({ token }: { token: string }) {
  const queryClient = useQueryClient();
  const [outcome, setOutcome] = useState<'done' | 'dead' | null>(null);
  const form = useForm({
    schema: z.object({ newPassword: passwordSchema }),
    onSubmit: async ({ newPassword }) => {
      try {
        await authRequest(authClient.resetPassword({ newPassword, token }));
        // A reset signs out every session, including any in this browser.
        queryClient.clear();
        setOutcome('done');
      } catch (error) {
        if (error instanceof ApiError && error.code === 'INVALID_TOKEN') {
          setOutcome('dead');
          return;
        }
        throw error;
      }
    },
  });

  if (outcome === 'dead') return <DeadLink />;
  if (outcome === 'done') {
    return (
      <PublicCard title="Password changed" description="Log in with your new password.">
        <TextLink to="/login">Log in</TextLink>
      </PublicCard>
    );
  }
  return (
    <PublicCard title="Set a new password">
      <Form form={form}>
        <TextField
          form={form}
          name="newPassword"
          label="New password"
          type="password"
          autoComplete="new-password"
          hint="At least 12 characters."
        />
        <SubmitButton form={form}>Set password</SubmitButton>
      </Form>
    </PublicCard>
  );
}

function ResetPasswordPage() {
  const { token } = resetPasswordRoute.useSearch();
  return token === undefined ? <DeadLink /> : <ResetForm token={token} />;
}

export const resetPasswordRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/reset-password',
  validateSearch: tokenSearchSchema,
  component: ResetPasswordPage,
});
