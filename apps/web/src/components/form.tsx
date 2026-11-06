import { useId, type ComponentProps, type ReactNode } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { FormState } from '@/lib/form';

/** Pair with `useForm`. Uses its own validation, so that errors read the same in every browser. */
export function Form({ form, children }: { form: FormState; children: ReactNode }) {
  return (
    <form noValidate onSubmit={form.handleSubmit} className="flex flex-col gap-4">
      {form.errors.form !== null && (
        <Alert variant="destructive">
          <AlertDescription>{form.errors.form}</AlertDescription>
        </Alert>
      )}
      {children}
    </form>
  );
}

interface TextFieldProps extends Omit<ComponentProps<typeof Input>, 'form'> {
  form: FormState;
  name: string;
  label: string;
  hint?: string;
}

export function TextField({ form, name, label, hint, ...input }: TextFieldProps) {
  const id = useId();
  const error = form.errors.fields[name];
  const message = error ?? hint;
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        name={name}
        aria-invalid={error !== undefined}
        aria-describedby={message === undefined ? undefined : `${id}-message`}
        {...input}
      />
      {message !== undefined && (
        <p
          id={`${id}-message`}
          className={error === undefined ? 'text-muted-foreground text-sm' : 'text-destructive text-sm'}
        >
          {message}
        </p>
      )}
    </div>
  );
}

export function SubmitButton({ form, children }: { form: FormState; children: ReactNode }) {
  return (
    <Button type="submit" disabled={form.pending}>
      {children}
    </Button>
  );
}
