import { useQueryClient } from '@tanstack/react-query';
import { createRoute } from '@tanstack/react-router';
import { useEffect } from 'react';
import { PublicCard } from '@/components/public-card';
import { ErrorState, LoadingState } from '@/components/states';
import { TextLink } from '@/components/text-link';
import { api } from '@/lib/api';
import { request, type ApiError } from '@/lib/api-request';
import { sessionQuery, setupStatusQuery } from '@/lib/session';
import { useSubmitToken } from '@/lib/submit-once';
import { rootRoute } from '@/routes/root';
import { tokenSearchSchema } from '@/routes/search';

function canRetry(error: ApiError): boolean {
  return error.status === 0 || error.status >= 500;
}

function Pending() {
  return (
    <PublicCard title="Checking your link">
      <LoadingState />
    </PublicCard>
  );
}

function DeadLink() {
  return (
    <PublicCard
      title="This link isn't valid"
      description="It may have expired or already been used."
    />
  );
}

const verifySetup = (token: string) => request(api.setup.verify.$post({ json: { token } }));

function VerifySetupPage() {
  const { token } = verifySetupRoute.useSearch();
  const queryClient = useQueryClient();
  const { outcome, retry } = useSubmitToken('setup', token, verifySetup);
  const succeeded = outcome?.data !== undefined;

  useEffect(() => {
    if (succeeded) queryClient.setQueryData(setupStatusQuery.queryKey, { open: false });
  }, [succeeded, queryClient]);

  if (token === undefined || outcome?.error?.code === 'token_invalid') return <DeadLink />;
  if (outcome === undefined) return <Pending />;
  if (outcome.error?.code === 'setup_closed') {
    return (
      <PublicCard title="Setup is closed" description="An admin account already exists.">
        <TextLink to="/login">Log in</TextLink>
      </PublicCard>
    );
  }
  if (outcome.error) {
    return (
      <PublicCard title="Setup not finished">
        <ErrorState error={outcome.error} onRetry={canRetry(outcome.error) ? retry : undefined} />
      </PublicCard>
    );
  }
  return (
    <PublicCard title="Admin account created" description="Log in with the details you chose.">
      <TextLink to="/login">Log in</TextLink>
    </PublicCard>
  );
}

const verifyChange = (token: string) => request(api.me.email.verify.$post({ json: { token } }));

function VerifyChangePage() {
  const { token } = verifyChangeRoute.useSearch();
  const queryClient = useQueryClient();
  const { outcome, retry } = useSubmitToken('email-change', token, verifyChange);
  const succeeded = outcome?.data !== undefined;

  useEffect(() => {
    if (succeeded) void queryClient.invalidateQueries(sessionQuery);
  }, [succeeded, queryClient]);

  if (token === undefined) return <DeadLink />;
  if (outcome === undefined) return <Pending />;
  // Only admins get a specific refusal. Everyone else gets this one answer, whatever happened, so
  // it must not claim the address changed.
  if (outcome.error) {
    return (
      <PublicCard title="Email not changed">
        <ErrorState error={outcome.error} onRetry={canRetry(outcome.error) ? retry : undefined} />
      </PublicCard>
    );
  }
  return (
    <PublicCard title={outcome.data.message}>
      <TextLink to="/">Go to Osusume</TextLink>
    </PublicCard>
  );
}

export const verifySetupRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/verify-email/setup',
  validateSearch: tokenSearchSchema,
  component: VerifySetupPage,
});

export const verifyChangeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/verify-email/change',
  validateSearch: tokenSearchSchema,
  component: VerifyChangePage,
});
