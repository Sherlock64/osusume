import { useMutation } from '@tanstack/react-query';
import { useState, type SyntheticEvent } from 'react';
import type { z } from 'zod';
import { toApiError, validationFieldErrors } from '@/lib/api-request';

export interface FormErrors {
  fields: Record<string, string>;
  form: string | null;
}

const noErrors: FormErrors = { fields: {}, form: null };

/** Wording for the shared schemas' limits. A message set on a schema itself takes precedence. */
function issueMessage(issue: z.core.$ZodRawIssue): string | undefined {
  if (issue.code === 'too_small') {
    const minimum = String(issue.minimum);
    return minimum === '1' ? 'Required.' : `Must be at least ${minimum} characters.`;
  }
  if (issue.code === 'too_big') return `Must be at most ${String(issue.maximum)} characters.`;
  if (issue.code === 'invalid_format' && issue.format === 'email') {
    return 'Enter a valid email address.';
  }
  return undefined;
}

/** Checks values against a schema, keeping the first problem with each field. */
export function validate<S extends z.ZodType>(
  schema: S,
  values: unknown,
): { data: z.output<S> } | { errors: FormErrors } {
  const result = schema.safeParse(values, { error: issueMessage });
  if (result.success) return { data: result.data };
  const fields: Record<string, string> = {};
  for (const issue of result.error.issues) fields[issue.path.join('.')] ??= issue.message;
  return { errors: { fields, form: null } };
}

/**
 * Places a failed submit: on a field if the api's error code or validation message names one the
 * form has, otherwise on the form.
 */
export function submitErrors(
  error: unknown,
  fieldNames: readonly string[],
  fieldForCode: Readonly<Record<string, string>> = {},
): FormErrors {
  const apiError = toApiError(error);
  const field = fieldForCode[apiError.code];
  if (field !== undefined) return { fields: { [field]: apiError.message }, form: null };
  const named = Object.entries(validationFieldErrors(apiError)).filter(([name]) =>
    fieldNames.includes(name),
  );
  if (named.length === 0) return { fields: {}, form: apiError.message };
  return { fields: Object.fromEntries(named), form: null };
}

interface UseFormOptions<S extends z.ZodType> {
  /** Fields are read from the form's named inputs, so a schema can coerce and transform them. */
  schema: S;
  onSubmit: (values: z.output<S>) => Promise<unknown>;
  /** Api error codes to show on a field, such as `{ username_taken: 'username' }`. */
  fieldForCode?: Readonly<Record<string, string>>;
}

export interface FormState {
  errors: FormErrors;
  handleSubmit: (event: SyntheticEvent<HTMLFormElement>) => void;
  pending: boolean;
}

/** Validation, field errors and pending state for a form. Render it with `@/components/form`. */
export function useForm<S extends z.ZodType>({
  schema,
  onSubmit,
  fieldForCode,
}: UseFormOptions<S>): FormState {
  const [errors, setErrors] = useState<FormErrors>(noErrors);
  const mutation = useMutation({ mutationFn: onSubmit });

  const handleSubmit = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (mutation.isPending) return;
    const values = Object.fromEntries(new FormData(event.currentTarget));
    const checked = validate(schema, values);
    if ('errors' in checked) {
      setErrors(checked.errors);
      return;
    }
    setErrors(noErrors);
    mutation.mutate(checked.data, {
      onError: (error) => {
        setErrors(submitErrors(error, Object.keys(values), fieldForCode));
      },
    });
  };

  return { errors, handleSubmit, pending: mutation.isPending };
}
