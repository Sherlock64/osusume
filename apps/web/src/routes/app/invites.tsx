import { createInviteRequestSchema } from '@osusume/shared';
import { createRoute } from '@tanstack/react-router';
import { Form, SubmitButton, TextField } from '@/components/form';
import { PageHeader } from '@/components/page-header';
import { TextLink } from '@/components/text-link';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { api } from '@/lib/api';
import { request } from '@/lib/api-request';
import { useForm, useFormRounds, type FormRounds } from '@/lib/form';
import { appRoute } from '@/routes/app';

function InviteForm({ rounds }: { rounds: FormRounds }) {
  const form = useForm({
    schema: createInviteRequestSchema,
    onSubmit: async ({ email }) => {
      rounds.start();
      const { message } = await request(api['invite-requests'].$post({ json: { email } }));
      rounds.finish(message);
    },
  });
  return (
    <Form form={form}>
      <TextField form={form} name="email" label="Email" type="email" autoComplete="off" />
      <div>
        <SubmitButton form={form}>Request invite</SubmitButton>
      </div>
    </Form>
  );
}

function InvitesPage() {
  const rounds = useFormRounds();
  const { user } = appRoute.useRouteContext();
  return (
    <div className="max-w-xl">
      <PageHeader title="Invite someone" />
      {rounds.message !== null && (
        <Alert className="mb-4" role="status">
          {/* The api tells everyone the admins have it, which for an admin means their own queue. */}
          <AlertDescription>
            {user.role === 'admin' ?
              <>
                <p>The request is waiting for your approval.</p>
                <TextLink to="/admin/invites">Review it in the invite queue</TextLink>
              </>
            : rounds.message}
          </AlertDescription>
        </Alert>
      )}
      <InviteForm key={rounds.formKey} rounds={rounds} />
    </div>
  );
}

export const invitesRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/invites',
  component: InvitesPage,
});
