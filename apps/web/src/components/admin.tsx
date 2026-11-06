import { useMutation } from '@tanstack/react-query';
import { useId, type ComponentProps } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { toApiError } from '@/lib/api-request';

/** A queue's filter. An empty value means every status. */
export function StatusFilter<Status extends string>({
  value,
  labels,
  onChange,
}: {
  value: Status | '';
  labels: Readonly<Record<Status, string>>;
  onChange: (next: Status | '') => void;
}) {
  const id = useId();
  return (
    <div className="mb-4 flex flex-col gap-1.5">
      <Label htmlFor={id}>Status</Label>
      <NativeSelect
        id={id}
        className="w-48"
        value={value}
        onChange={(event) => {
          onChange(event.target.value as Status | '');
        }}
      >
        <NativeSelectOption value="">All</NativeSelectOption>
        {(Object.entries(labels) as [Status, string][]).map(([status, label]) => (
          <NativeSelectOption key={status} value={status}>
            {label}
          </NativeSelectOption>
        ))}
      </NativeSelect>
    </div>
  );
}

/**
 * A button for an action that needs no confirmation. Place it in a wrapping row: a failure shows
 * the api's reason on a line of its own.
 */
export function ActionButton({
  label,
  onAction,
  variant = 'outline',
}: {
  label: string;
  onAction: () => Promise<unknown>;
  variant?: ComponentProps<typeof Button>['variant'];
}) {
  const action = useMutation({ mutationFn: onAction });
  return (
    <>
      <Button
        type="button"
        size="sm"
        variant={variant}
        disabled={action.isPending}
        onClick={() => {
          action.mutate();
        }}
      >
        {label}
      </Button>
      {action.isError && (
        <p role="alert" className="text-destructive order-last w-full text-sm wrap-anywhere">
          {toApiError(action.error).message}
        </p>
      )}
    </>
  );
}
