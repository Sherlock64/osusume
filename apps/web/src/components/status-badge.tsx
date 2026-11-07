import { type ListStatus, listStatusLabels } from '@osusume/shared';
import { Bookmark, Check, Pause, Play, X, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

const styles: Record<ListStatus, { Icon: LucideIcon; className: string }> = {
  plan_to_watch: {
    Icon: Bookmark,
    className: 'text-status-plan bg-status-plan/14 border-status-plan/40',
  },
  watching: {
    Icon: Play,
    className: 'text-status-watching bg-status-watching/14 border-status-watching/40',
  },
  completed: {
    Icon: Check,
    className: 'text-status-completed bg-status-completed/14 border-status-completed/40',
  },
  on_hold: {
    Icon: Pause,
    className: 'text-status-hold bg-status-hold/14 border-status-hold/40',
  },
  dropped: {
    Icon: X,
    className: 'text-status-dropped bg-status-dropped/14 border-status-dropped/40',
  },
};

/** A list status: the same icon, colour and words everywhere. */
export function StatusBadge({ status, className }: { status: ListStatus; className?: string }) {
  const { Icon, className: colours } = styles[status];
  return (
    <span
      className={cn(
        'inline-flex h-6 w-fit shrink-0 items-center gap-1 rounded-sm border px-1.5 text-xs font-medium whitespace-nowrap',
        colours,
        className,
      )}
    >
      <Icon className="size-3" aria-hidden />
      {listStatusLabels[status]}
    </span>
  );
}
