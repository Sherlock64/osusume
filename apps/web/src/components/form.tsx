import { useId, type ComponentProps, type ReactNode } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
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

interface FieldProps {
  form: FormState;
  name: string;
  label: string;
  hint?: string;
}

interface FieldControlProps {
  id: string;
  name: string;
  'aria-invalid': boolean;
  'aria-describedby': string | undefined;
}

function Field({
  form,
  name,
  label,
  hint,
  control,
}: FieldProps & { control: (props: FieldControlProps) => ReactNode }) {
  const id = useId();
  const error = form.errors.fields[name];
  const message = error ?? hint;
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {control({
        id,
        name,
        'aria-invalid': error !== undefined,
        'aria-describedby': message === undefined ? undefined : `${id}-message`,
      })}
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

type TextFieldProps = FieldProps & Omit<ComponentProps<typeof Input>, 'form' | 'name'>;

export function TextField({ form, name, label, hint, ...input }: TextFieldProps) {
  return (
    <Field
      form={form}
      name={name}
      label={label}
      {...(hint === undefined ? {} : { hint })}
      control={(props) => <Input {...props} {...input} />}
    />
  );
}

type TextareaFieldProps = FieldProps & Omit<ComponentProps<typeof Textarea>, 'form' | 'name'>;

export function TextareaField({ form, name, label, hint, ...input }: TextareaFieldProps) {
  return (
    <Field
      form={form}
      name={name}
      label={label}
      {...(hint === undefined ? {} : { hint })}
      control={(props) => <Textarea {...props} {...input} />}
    />
  );
}

type SelectFieldProps = FieldProps & Omit<ComponentProps<typeof NativeSelect>, 'form' | 'name'>;

/** Holds `NativeSelectOption`s. */
export function SelectField({ form, name, label, hint, className, ...input }: SelectFieldProps) {
  return (
    <Field
      form={form}
      name={name}
      label={label}
      {...(hint === undefined ? {} : { hint })}
      control={(props) => <NativeSelect className={className ?? 'w-full'} {...props} {...input} />}
    />
  );
}

export function SubmitButton({
  form,
  children,
  variant,
}: {
  form: FormState;
  children: ReactNode;
  variant?: ComponentProps<typeof Button>['variant'];
}) {
  return (
    <Button type="submit" disabled={form.pending} {...(variant === undefined ? {} : { variant })}>
      {children}
    </Button>
  );
}
