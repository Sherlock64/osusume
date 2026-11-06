import { createInviteRequestSchema } from '@osusume/shared';
import { createRoute } from '@tanstack/react-router';
import { Form, SubmitButton, TextField } from '@/components/form';
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
  return (
    <div className="max-w-md">
      <h1 className="mb-4 text-xl font-semibold">Invite someone</h1>
      {rounds.message !== null && (
        <Alert className="mb-4" role="status">
          <AlertDescription>{rounds.message}</AlertDescription>
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
