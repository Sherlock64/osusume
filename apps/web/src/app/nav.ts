import type { UserRole } from '@osusume/shared';
import type { LinkProps } from '@tanstack/react-router';

export interface NavItem {
  to: LinkProps['to'];
  label: string;
  adminOnly?: boolean;
}

/**
 * The shell's navigation. When a screen lands, add its route in `@/router` and its entry here, with
 * `adminOnly: true` for an admin screen. Add nothing until its route exists.
 */
export const navItems: NavItem[] = [{ to: '/', label: 'Home' }];

export function visibleNavItems(items: readonly NavItem[], role: UserRole): NavItem[] {
  return items.filter((item) => role === 'admin' || item.adminOnly !== true);
}
