import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useLocation, useRouter } from '@tanstack/react-router';
import { ChevronDown, Menu, X } from 'lucide-react';
import { useRef, useState, type ReactNode } from 'react';
import { navItems, visibleNavItems, type NavItem } from '@/app/nav';
import { LogoLockup } from '@/components/logo-mark';
import { ThemeToggle } from '@/components/theme-toggle';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { authRequest, toApiError } from '@/lib/api-request';
import { authClient } from '@/lib/auth-client';
import { sessionQuery, type SessionUser } from '@/lib/session';
import { cn } from '@/lib/utils';

function useLogout() {
  const queryClient = useQueryClient();
  const router = useRouter();
  return useMutation({
    mutationFn: () => authRequest(authClient.signOut()),
    onSuccess: async () => {
      // Nothing cached for this user may outlive the session.
      queryClient.clear();
      queryClient.setQueryData(sessionQuery.queryKey, null);
      await router.navigate({ to: '/login' });
    },
  });
}

// A short rule under the current page: a shape, so it isn't told by colour alone.
const barLink =
  'relative inline-flex h-9 items-center rounded-sm px-2.5 text-sm font-medium whitespace-nowrap text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground aria-[current=page]:text-foreground aria-[current=page]:after:absolute aria-[current=page]:after:inset-x-2.5 aria-[current=page]:after:-bottom-[11px] aria-[current=page]:after:h-0.5 aria-[current=page]:after:bg-link';
const panelLink =
  'flex min-h-11 items-center rounded-sm border-l-2 border-transparent px-3 text-sm font-medium hover:bg-accent aria-[current=page]:border-link aria-[current=page]:bg-accent';

export function AppShell({ user, children }: { user: SessionUser; children: ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const logout = useLogout();
  const onAdminPage = useLocation({ select: (location) => location.pathname.startsWith('/admin') });

  const visible = visibleNavItems(navItems, user.role);
  // Settings belongs with the account, beside the username and log out.
  const mainItems = visible.filter((item) => item.adminOnly !== true && item.to !== '/settings');
  const adminItems = visible.filter((item) => item.adminOnly === true);
  const closeMenu = () => {
    setMenuOpen(false);
  };

  const toLink = (item: NavItem, className: string) => (
    <Link
      key={item.label}
      to={item.to}
      activeOptions={{ exact: item.to === '/' }}
      className={className}
      onClick={closeMenu}
    >
      {item.label}
    </Link>
  );
  const logoutButton = (
    <Button
      variant="outline"
      disabled={logout.isPending}
      onClick={() => {
        logout.mutate();
      }}
    >
      Log out
    </Button>
  );

  return (
    <div className="min-h-svh">
      <a
        href="#main"
        className="bg-primary text-primary-foreground sr-only z-50 rounded-sm px-3 py-2 text-sm focus:not-sr-only focus:absolute focus:top-2 focus:left-2"
      >
        Skip to content
      </a>
      <header
        className="bg-background sticky top-0 z-40 border-b"
        onKeyDown={(event) => {
          if (event.key === 'Escape' && menuOpen) {
            closeMenu();
            menuButton.current?.focus();
          }
        }}
      >
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-4 px-4 sm:px-6">
          <Link to="/" aria-label="Osusume, my list" className="shrink-0 rounded-sm" onClick={closeMenu}>
            <LogoLockup />
          </Link>
          <nav aria-label="Main" className="hidden min-w-0 items-center gap-0.5 lg:flex">
            {mainItems.map((item) => toLink(item, barLink))}
          </nav>
          <div className="ml-auto flex min-w-0 items-center gap-1">
            {adminItems.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger
                  aria-current={onAdminPage ? 'page' : undefined}
                  className={cn(barLink, 'hidden gap-1 lg:inline-flex')}
                >
                  Admin
                  <ChevronDown className="size-3.5" aria-hidden />
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  {adminItems.map((item) => (
                    <DropdownMenuItem key={item.label} asChild>
                      <Link to={item.to}>{item.label}</Link>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            <ThemeToggle />
            <DropdownMenu>
              <DropdownMenuTrigger className={cn(barLink, 'hidden max-w-44 gap-1 lg:inline-flex')}>
                <span className="truncate">{user.username}</span>
                <ChevronDown className="size-3.5 shrink-0" aria-hidden />
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuLabel className="wrap-anywhere normal-case">{user.username}</DropdownMenuLabel>
                <DropdownMenuItem asChild>
                  <Link to="/settings">Settings</Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  disabled={logout.isPending}
                  onSelect={() => {
                    logout.mutate();
                  }}
                >
                  Log out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              ref={menuButton}
              variant="ghost"
              size="icon"
              className="lg:hidden"
              aria-label={menuOpen ? 'Close menu' : 'Open menu'}
              aria-expanded={menuOpen}
              onClick={() => {
                setMenuOpen((open) => !open);
              }}
            >
              {menuOpen ? <X /> : <Menu />}
            </Button>
          </div>
        </div>
        {menuOpen && (
          <div className="max-h-[calc(100svh-3.5rem)] overflow-y-auto border-t px-4 py-3 sm:px-6 lg:hidden">
            <nav aria-label="Main" className="grid grid-cols-2 gap-1 sm:grid-cols-3">
              {mainItems.map((item) => toLink(item, panelLink))}
            </nav>
            {adminItems.length > 0 && (
              <nav aria-label="Admin" className="mt-3 border-t pt-3">
                <p className="eyebrow mb-1 px-3">Admin</p>
                <div className="grid grid-cols-2 gap-1 sm:grid-cols-3">
                  {adminItems.map((item) => toLink(item, panelLink))}
                </div>
              </nav>
            )}
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t pt-3">
              <span className="text-muted-foreground min-w-0 truncate px-3 text-sm">{user.username}</span>
              <div className="flex items-center gap-2">
                <Button variant="ghost" asChild>
                  <Link to="/settings" onClick={closeMenu}>
                    Settings
                  </Link>
                </Button>
                {logoutButton}
              </div>
            </div>
          </div>
        )}
        {logout.isError && (
          <p role="alert" className="text-destructive px-4 pb-2 text-right text-sm sm:px-6">
            {toApiError(logout.error).message}
          </p>
        )}
      </header>
      <main id="main" className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:py-8">
        {children}
      </main>
    </div>
  );
}
