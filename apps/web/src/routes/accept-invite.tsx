import { acceptInviteSchema } from '@osusume/shared';
import { useQuery } from '@tanstack/react-query';
import { createRoute } from '@tanstack/react-router';
import { useId, useState } from 'react';
import { Form, SubmitButton, TextField } from '@/components/form';
import { PublicCard } from '@/components/public-card';
import { ErrorState, LoadingState } from '@/components/states';
import { TextLink } from '@/components/text-link';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api } from '@/lib/api';
import { ApiError, request } from '@/lib/api-request';
import { useForm } from '@/lib/form';
import { rootRoute } from '@/routes/root';
import { tokenSearchSchema } from '@/routes/search';

function InvalidLink() {
  return <PublicCard title="This invite link isn't valid" description="Ask for a new invite." />;
}

function AcceptForm({ token, email }: { token: string; email: string }) {
  const emailId = useId();
  const [outcome, setOutcome] = useState<'done' | 'dead' | null>(null);
  const form = useForm({
    schema: acceptInviteSchema,
    fieldForCode: { username_taken: 'username' },
    onSubmit: async (values) => {
      try {
        await request(api.invites[':token'].accept.$post({ param: { token }, json: values }));
        setOutcome('done');
      } catch (error) {
        if (error instanceof ApiError && error.code === 'invite_invalid') {
          setOutcome('dead');
          return;
        }
        throw error;
      }
    },
  });

  if (outcome === 'dead') return <InvalidLink />;
  if (outcome === 'done') {
    return (
      <PublicCard title="Account created" description="Log in with your new username and password.">
        <TextLink to="/login">Log in</TextLink>
      </PublicCard>
    );
  }
  return (
    <PublicCard title="Join Osusume" description="Choose a username and password.">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={emailId}>Email</Label>
        <Input id={emailId} value={email} readOnly autoComplete="email" />
      </div>
      <Form form={form}>
        <TextField
          form={form}
          name="username"
          label="Username"
          autoComplete="username"
          hint="3-30 letters, digits, underscores and dots."
        />
        <TextField
          form={form}
          name="password"
          label="Password"
          type="password"
          autoComplete="new-password"
          hint="At least 12 characters."
        />
        <SubmitButton form={form}>Create account</SubmitButton>
      </Form>
    </PublicCard>
  );
}

function InvitePreview({ token }: { token: string }) {
  const preview = useQuery({
    queryKey: ['invite-preview', token],
    queryFn: () => request(api.invites[':token'].$get({ param: { token } })),
    // Stays put once shown: a refetch after accepting would swap the success for "invalid".
    staleTime: Infinity,
    gcTime: 0,
  });

  if (preview.isPending) {
    return (
      <PublicCard title="Join Osusume">
        <LoadingState />
      </PublicCard>
    );
  }
  if (preview.isError) {
    if (preview.error instanceof ApiError && preview.error.status === 400) return <InvalidLink />;
    return (
      <PublicCard title="Join Osusume">
        <ErrorState error={preview.error} onRetry={() => void preview.refetch()} />
      </PublicCard>
    );
  }
  if (!preview.data.valid || preview.data.email === null) return <InvalidLink />;
  return <AcceptForm token={token} email={preview.data.email} />;
}

function AcceptInvitePage() {
  const { token } = acceptInviteRoute.useSearch();
  return token === undefined ? <InvalidLink /> : <InvitePreview token={token} />;
}

export const acceptInviteRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/invites/accept',
  validateSearch: tokenSearchSchema,
  component: AcceptInvitePage,
});
