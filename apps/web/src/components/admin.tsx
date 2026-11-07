import { useMutation } from '@tanstack/react-query';
import { useEffect, useRef, type ComponentProps, type ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { toApiError } from '@/lib/api-request';
import { cn } from '@/lib/utils';

/** Every state an admin queue's item can be in. An expired invite has no status of its own. */
const queueStates = {
  pending: { label: 'Pending', variant: 'warning' },
  approved: { label: 'Approved', variant: 'success' },
  accepted: { label: 'Accepted', variant: 'success' },
  rejected: { label: 'Rejected', variant: 'destructive' },
  revoked: { label: 'Revoked', variant: 'destructive' },
  expired: { label: 'Expired', variant: 'destructive' },
} as const;

type QueueState = keyof typeof queueStates;

export function QueueBadge({ state }: { state: QueueState }) {
  const { label, variant } = queueStates[state];
  return <Badge variant={variant}>{label}</Badge>;
}

/** A queue's filter. An empty value means every status. */
export function StatusFilter<Status extends QueueState>({
  value,
  statuses,
  onChange,
}: {
  value: Status | '';
  statuses: readonly Status[];
  onChange: (next: Status | '') => void;
}) {
  const options = [
    { status: '' as const, label: 'All' },
    ...statuses.map((status) => ({ status, label: queueStates[status].label })),
  ];
  return (
    <div role="group" aria-label="Filter by status" className="mb-2 flex flex-wrap gap-2">
      {options.map(({ status, label }) => (
        <Button
          key={label}
          type="button"
          size="sm"
          variant={status === value ? 'default' : 'outline'}
          aria-pressed={status === value}
          onClick={() => {
            onChange(status);
          }}
        >
          {label}
        </Button>
      ))}
    </div>
  );
}

/**
 * One item of an admin list: what it is on the left, what can be done to it on the right, stacked on
 * a phone. `children` opens below at full width.
 */
export function AdminRow({
  heading: Heading = 'h2',
  title,
  badges,
  meta,
  leading,
  actions,
  children,
}: {
  heading?: 'h2' | 'h3';
  title: ReactNode;
  badges?: ReactNode;
  meta?: ReactNode;
  leading?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <li className="flex flex-col gap-3 py-3">
      <div className="flex gap-3">
        {leading}
        <div className="flex min-w-0 flex-1 flex-col gap-3 md:flex-row md:items-center md:justify-between md:gap-6">
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <Heading className="min-w-0 font-sans text-base font-medium tracking-normal wrap-anywhere">
                {title}
              </Heading>
              {badges}
            </div>
            {meta !== undefined && (
              <div className="text-muted-foreground flex flex-col gap-1 text-sm wrap-anywhere">{meta}</div>
            )}
          </div>
          {actions !== undefined && actions !== false && (
            <div className="flex flex-wrap gap-2 md:max-w-sm md:shrink-0 md:justify-end">
              {actions}
            </div>
          )}
        </div>
      </div>
      {children}
    </li>
  );
}

/**
 * A form or tool opened in place, marked off by a rule. `aside` is a second column on wide screens.
 * It brings itself into view as it opens.
 */
export function AdminPanel({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    panel.current?.scrollIntoView({ block: 'nearest', behavior: still ? 'auto' : 'smooth' });
  }, []);
  return (
    <div
      ref={panel}
      className={cn(
        // The margins clear the sticky header and leave a little air below.
        'border-primary-edge animate-in fade-in slide-in-from-top-1 grid scroll-mt-20 scroll-mb-6 gap-6 border-l-2 pl-3 duration-150 md:pl-4',
        aside === undefined ? 'max-w-3xl' : 'lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:gap-10',
      )}
    >
      <div className="min-w-0">{children}</div>
      {aside !== undefined && (
        <div className="flex min-w-0 flex-col gap-6 border-t pt-4 lg:border-t-0 lg:pt-0">{aside}</div>
      )}
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
