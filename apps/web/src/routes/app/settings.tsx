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
import { ChevronDown } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { z } from 'zod';
import { Form, SelectField, SubmitButton, TextField } from '@/components/form';
import { PageHeader, SectionHeading } from '@/components/page-header';
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
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelectOption } from '@/components/ui/native-select';
import { api } from '@/lib/api';
import { authRequest, request } from '@/lib/api-request';
import { authClient } from '@/lib/auth-client';
import { useForm, useFormRounds, type FormRounds } from '@/lib/form';
import { sessionQuery } from '@/lib/session';
import { cn } from '@/lib/utils';
import { appRoute } from '@/routes/app';

const listSettingsQueryKey = ['list-settings'];

/** One setting: what it is on the left, its value and controls on the right. */
function Setting({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-x-8 gap-y-3 py-5 md:grid-cols-[13rem_minmax(0,1fr)]">
      <div>
        <h3 className="font-medium">{title}</h3>
        {description !== undefined && (
          <p className="text-muted-foreground mt-0.5 text-sm">{description}</p>
        )}
      </div>
      <div className="flex max-w-md min-w-0 flex-col gap-3">{children}</div>
    </div>
  );
}

/** A form that stays out of the way until asked for, so the page reads as values, not fields. */
function ChangeForm({ label, children }: { label: string; children: ReactNode }) {
  return (
    <details className="group">
      <summary
        className={cn(
          buttonVariants({ variant: 'outline' }),
          'w-fit cursor-pointer list-none [&::-webkit-details-marker]:hidden',
        )}
      >
        {label}
        <ChevronDown className="transition-transform group-open:rotate-180" aria-hidden />
      </summary>
      <div className="mt-4 flex flex-col gap-3">{children}</div>
    </details>
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
    <div className="flex flex-col gap-2 border-t pt-4">
      <Label htmlFor="public-link">Public link</Label>
      <Input
        id="public-link"
        readOnly
        value={link}
        onFocus={(event) => {
          event.target.select();
        }}
      />
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            // Browsers offer the clipboard only on HTTPS and localhost.
            const clipboard = navigator.clipboard as Clipboard | undefined;
            if (clipboard === undefined) {
              setCopied('failed');
              return;
            }
            clipboard.writeText(link).then(
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

const usernameStatuses: Record<
  UsernameChangeRequestStatus,
  { label: string; variant: 'warning' | 'success' | 'destructive' }
> = {
  pending: { label: 'Waiting for an admin', variant: 'warning' },
  approved: { label: 'Approved', variant: 'success' },
  rejected: { label: 'Rejected', variant: 'destructive' },
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
    <>
      <p className="font-medium wrap-anywhere">{user.username}</p>
      {latestRequest !== undefined && (
        <div role="status" className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted-foreground wrap-anywhere">
            Latest request: {latestRequest.requestedUsername}
          </span>
          <Badge variant={usernameStatuses[latestRequest.status].variant}>
            {usernameStatuses[latestRequest.status].label}
          </Badge>
        </div>
      )}
      {latestRequest?.status === 'pending' ?
        <p className="text-muted-foreground text-sm">
          You can ask for another change once an admin has decided this one.
        </p>
      : <ChangeForm label="Change username">
          <UsernameForm
            key={sent}
            onSent={() => {
              setSent(sent + 1);
            }}
          />
        </ChangeForm>
      }
    </>
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
    <>
      <ChangeForm label="Change password">
        <PasswordForm key={rounds.formKey} rounds={rounds} />
      </ChangeForm>
      {rounds.message !== null && <Done>{rounds.message}</Done>}
    </>
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
    <>
      <p className="font-medium wrap-anywhere">{user.email}</p>
      <ChangeForm label="Change email">
        <EmailForm key={rounds.formKey} rounds={rounds} />
      </ChangeForm>
      {rounds.message !== null && <Done>{rounds.message}</Done>}
    </>
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
      <AlertDialogTrigger asChild>
        <Button variant="destructive" className="w-fit">
          Delete account
        </Button>
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

function SettingsGroup({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-20">
      <SectionHeading>{title}</SectionHeading>
      <div className="divide-y">{children}</div>
    </section>
  );
}

function SettingsPage() {
  const { user } = appRoute.useRouteContext();
  const groups = [
    ['list', 'My list'],
    ['account', 'Account'],
    ['security', 'Security'],
    ...(user.isFirstAdmin ? [] : [['danger', 'Danger zone']]),
  ];
  return (
    <>
      <PageHeader title="Settings" description="Who sees your list, and how you log in." />
      <div className="grid gap-x-12 gap-y-6 lg:grid-cols-[11rem_minmax(0,1fr)]">
        <nav aria-label="Settings sections" className="lg:sticky lg:top-20 lg:self-start">
          <ul className="flex flex-wrap gap-x-1 lg:flex-col">
            {groups.map(([id, title]) => (
              <li key={id}>
                <a
                  href={`#${String(id)}`}
                  className="hover:bg-accent text-muted-foreground hover:text-accent-foreground flex h-11 items-center rounded-md px-3 text-sm md:h-9"
                >
                  {title}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <div className="flex max-w-3xl min-w-0 flex-col gap-10">
          <SettingsGroup id="list" title="My list">
            <Setting
              title="Visibility"
              description="Leaving public ends the link. Going public again makes a new one."
            >
              <ListVisibility />
            </Setting>
          </SettingsGroup>
          <SettingsGroup id="account" title="Account">
            <Setting title="Username" description="Friends find you by it.">
              <UsernameChange />
            </Setting>
            <Setting title="Email" description="Where account links are sent.">
              <EmailChange />
            </Setting>
          </SettingsGroup>
          <SettingsGroup id="security" title="Security">
            <Setting
              title="Password"
              description="Changing it logs out your other devices."
            >
              <PasswordChange />
            </Setting>
          </SettingsGroup>
          {!user.isFirstAdmin && (
            <SettingsGroup id="danger" title="Danger zone">
              <Setting
                title="Delete account"
                description="Your list, settings, friends and pending requests are deleted for good."
              >
                <DeleteAccount />
              </Setting>
            </SettingsGroup>
          )}
        </div>
      </div>
    </>
  );
}

export const settingsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/settings',
  component: SettingsPage,
});
