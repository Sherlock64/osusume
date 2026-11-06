import {
  changeEmailSchema,
  createUsernameChangeRequestSchema,
  deleteAccountSchema,
  passwordSchema,
  PASSWORD_MAX_LENGTH,
  putListSettingsSchema,
  visibilityTiers,
  type ListSettings,
  type UsernameChangeRequestStatus,
  type VisibilityTier,
} from '@osusume/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createRoute, useNavigate } from '@tanstack/react-router';
import { useState, type ReactNode } from 'react';
import { z } from 'zod';
import { Form, SelectField, SubmitButton, TextField } from '@/components/form';
import { QueryFallback } from '@/components/states';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { NativeSelectOption } from '@/components/ui/native-select';
import { api } from '@/lib/api';
import { authRequest, request } from '@/lib/api-request';
import { authClient } from '@/lib/auth-client';
import { useForm, useFormRounds, type FormRounds } from '@/lib/form';
import { sessionQuery } from '@/lib/session';
import { appRoute } from '@/routes/app';

const listSettingsQueryKey = ['list-settings'];

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function Done({ children }: { children: ReactNode }) {
  return (
    <p role="status" className="text-muted-foreground text-sm wrap-anywhere">
      {children}
    </p>
  );
}

const visibilityLabels: Record<VisibilityTier, string> = {
  private: 'Only me',
  friends: 'Friends',
  members: 'All members',
  public: 'Anyone with the link',
};

function PublicLink({ slug }: { slug: string }) {
  const [copied, setCopied] = useState<'yes' | 'failed' | null>(null);
  const link = `${window.location.origin}/lists/${slug}`;
  return (
    <div className="mt-4 flex flex-col gap-2">
      <Input aria-label="Public link" readOnly value={link} />
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            navigator.clipboard.writeText(link).then(
              () => {
                setCopied('yes');
              },
              () => {
                setCopied('failed');
              },
            );
          }}
        >
          Copy public link
        </Button>
        {copied === 'yes' && <Done>Copied.</Done>}
        {copied === 'failed' && <Done>Couldn't copy. Select the link above instead.</Done>}
      </div>
    </div>
  );
}

function VisibilityForm({ settings }: { settings: ListSettings }) {
  const queryClient = useQueryClient();
  const [saved, setSaved] = useState(false);
  const form = useForm({
    schema: putListSettingsSchema,
    onSubmit: async (values) => {
      setSaved(false);
      const updated = await request(api.me['list-settings'].$put({ json: values }));
      queryClient.setQueryData(listSettingsQueryKey, updated);
      setSaved(true);
    },
  });
  return (
    <>
      <Form form={form}>
        <SelectField
          form={form}
          name="visibility"
          label="Who can see my list"
          hint="Leaving public ends the link. Going public again makes a new one."
          defaultValue={settings.visibility}
        >
          {visibilityTiers.map((tier) => (
            <NativeSelectOption key={tier} value={tier}>
              {visibilityLabels[tier]}
            </NativeSelectOption>
          ))}
        </SelectField>
        <div className="flex flex-wrap items-center gap-3">
          <SubmitButton form={form}>Save</SubmitButton>
          {saved && <Done>Saved.</Done>}
        </div>
      </Form>
      {settings.publicSlug !== null && <PublicLink slug={settings.publicSlug} />}
    </>
  );
}

function ListVisibility() {
  const settings = useQuery({
    queryKey: listSettingsQueryKey,
    queryFn: () => request(api.me['list-settings'].$get()),
  });
  if (settings.data === undefined) return <QueryFallback query={settings} />;
  return <VisibilityForm settings={settings.data} />;
}

const usernameStatusLabels: Record<UsernameChangeRequestStatus, string> = {
  pending: 'waiting for an admin',
  approved: 'approved',
  rejected: 'rejected',
};

const usernameChangesKey = ['username-changes', 'mine'];

function UsernameForm({ onSent }: { onSent: () => void }) {
  const queryClient = useQueryClient();
  const form = useForm({
    schema: createUsernameChangeRequestSchema,
    fieldForCode: { username_change_already_pending: 'username', username_taken: 'username' },
    onSubmit: async ({ username }) => {
      await request(api['username-change-requests'].$post({ json: { username } }));
      await queryClient.invalidateQueries({ queryKey: usernameChangesKey });
      onSent();
    },
  });
  return (
    <Form form={form}>
      <TextField
        form={form}
        name="username"
        label="New username"
        autoComplete="off"
        hint="3-30 letters, digits, underscores and dots. An admin approves the change."
      />
      <div>
        <SubmitButton form={form}>Request change</SubmitButton>
      </div>
    </Form>
  );
}

function UsernameChange() {
  const { user } = appRoute.useRouteContext();
  const [sent, setSent] = useState(0);
  const latest = useQuery({
    queryKey: usernameChangesKey,
    queryFn: () =>
      request(api['username-change-requests'].$get({ query: { mine: 'true', limit: '1' } })),
  });
  const latestRequest = latest.data?.items[0];
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm wrap-anywhere">Your username is {user.username}.</p>
      {latestRequest !== undefined && (
        <Done>
          Latest request: {latestRequest.requestedUsername},{' '}
          {usernameStatusLabels[latestRequest.status]}.
        </Done>
      )}
      <UsernameForm
        key={sent}
        onSent={() => {
          setSent(sent + 1);
        }}
      />
    </div>
  );
}

const currentPasswordField = z.string().min(1).max(PASSWORD_MAX_LENGTH);

function PasswordForm({ rounds }: { rounds: FormRounds }) {
  const form = useForm({
    schema: z.object({ currentPassword: currentPasswordField, newPassword: passwordSchema }),
    fieldForCode: { INVALID_PASSWORD: 'currentPassword' },
    onSubmit: async ({ currentPassword, newPassword }) => {
      rounds.start();
      await authRequest(
        authClient.changePassword({ currentPassword, newPassword, revokeOtherSessions: true }),
      );
      rounds.finish('Password changed. Your other devices have been logged out.');
    },
  });
  return (
    <Form form={form}>
      <TextField
        form={form}
        name="currentPassword"
        label="Current password"
        type="password"
        autoComplete="current-password"
      />
      <TextField
        form={form}
        name="newPassword"
        label="New password"
        type="password"
        autoComplete="new-password"
        hint="At least 12 characters."
      />
      <div>
        <SubmitButton form={form}>Change password</SubmitButton>
      </div>
    </Form>
  );
}

function PasswordChange() {
  const rounds = useFormRounds();
  return (
    <div className="flex flex-col gap-3">
      <PasswordForm key={rounds.formKey} rounds={rounds} />
      {rounds.message !== null && <Done>{rounds.message}</Done>}
    </div>
  );
}

function EmailForm({ rounds }: { rounds: FormRounds }) {
  const form = useForm({
    schema: changeEmailSchema,
    fieldForCode: { invalid_password: 'currentPassword', email_in_use: 'newEmail' },
    onSubmit: async (values) => {
      rounds.start();
      const { message } = await request(api.me.email.$post({ json: values }));
      rounds.finish(message);
    },
  });
  return (
    <Form form={form}>
      <TextField form={form} name="newEmail" label="New email" type="email" autoComplete="off" />
      <TextField
        form={form}
        name="currentPassword"
        label="Current password"
        type="password"
        autoComplete="current-password"
      />
      <div>
        <SubmitButton form={form}>Change email</SubmitButton>
      </div>
    </Form>
  );
}

/** The answer is the api's, word for word: to a non-admin, it says nothing about the address. */
function EmailChange() {
  const { user } = appRoute.useRouteContext();
  const rounds = useFormRounds();
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm wrap-anywhere">Your email is {user.email}.</p>
      <EmailForm key={rounds.formKey} rounds={rounds} />
      {rounds.message !== null && <Done>{rounds.message}</Done>}
    </div>
  );
}

function DeleteAccount() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const form = useForm({
    schema: deleteAccountSchema,
    fieldForCode: { invalid_password: 'currentPassword' },
    onSubmit: async (values) => {
      await request(api.me.$delete({ json: values }));
      // Nothing cached for this user may outlive the account.
      queryClient.clear();
      queryClient.setQueryData(sessionQuery.queryKey, null);
      await navigate({ to: '/login' });
    },
  });
  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!form.pending) setOpen(next);
      }}
    >
      <p className="text-muted-foreground mb-3 text-sm">
        Your list, settings, friends and pending requests are deleted for good.
      </p>
      <AlertDialogTrigger asChild>
        <Button variant="destructive">Delete account</Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete your account?</AlertDialogTitle>
          <AlertDialogDescription>
            This can't be undone. Enter your current password to confirm.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <Form form={form}>
          <TextField
            form={form}
            name="currentPassword"
            label="Current password"
            type="password"
            autoComplete="current-password"
          />
          <AlertDialogFooter>
            <AlertDialogCancel disabled={form.pending}>Cancel</AlertDialogCancel>
            <SubmitButton form={form} variant="destructive">
              Delete account
            </SubmitButton>
          </AlertDialogFooter>
        </Form>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function SettingsPage() {
  const { user } = appRoute.useRouteContext();
  return (
    <div className="flex max-w-xl flex-col gap-4">
      <h1 className="text-xl font-semibold">Settings</h1>
      <Section title="List visibility">
        <ListVisibility />
      </Section>
      <Section title="Username">
        <UsernameChange />
      </Section>
      <Section title="Password">
        <PasswordChange />
      </Section>
      <Section title="Email">
        <EmailChange />
      </Section>
      {!user.isFirstAdmin && (
        <Section title="Delete account">
          <DeleteAccount />
        </Section>
      )}
    </div>
  );
}

export const settingsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/settings',
  component: SettingsPage,
});
