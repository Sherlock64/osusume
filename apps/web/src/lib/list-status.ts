import type { ListStatus } from '@osusume/shared';

export const listStatusLabels: Record<ListStatus, string> = {
  plan_to_watch: 'Plan to watch',
  watching: 'Watching',
  completed: 'Completed',
  on_hold: 'On hold',
  dropped: 'Dropped',
};
