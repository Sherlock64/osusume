import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useRouter } from '@tanstack/react-router';
import { Menu, X } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { navItems, visibleNavItems, type NavItem } from '@/app/nav';
import { Button } from '@/components/ui/button';
import { authRequest, toApiError } from '@/lib/api-request';
import { authClient } from '@/lib/auth-client';
import { sessionQuery, type SessionUser } from '@/lib/session';

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

export function AppShell({ user, children }: { user: SessionUser; children: ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const logout = useLogout();

  const visible = visibleNavItems(navItems, user.role);
  const toLink = (item: NavItem) => (
    <Link
      key={item.label}
      to={item.to}
      activeOptions={{ exact: item.to === '/' }}
      activeProps={{ className: 'bg-muted' }}
      className="hover:bg-muted rounded-md px-3 py-2 text-sm font-medium"
      onClick={() => {
        setMenuOpen(false);
      }}
    >
      {item.label}
    </Link>
  );
  const links = visible.filter((item) => item.adminOnly !== true).map(toLink);
  const adminLinks = visible.filter((item) => item.adminOnly === true).map(toLink);

  return (
    <div className="min-h-svh">
      <header className="border-b">
        <div className="mx-auto flex max-w-5xl items-center gap-2 px-4 py-2">
          <Link to="/" className="font-semibold">
            Osusume
          </Link>
          <nav aria-label="Main" className="ml-4 hidden flex-wrap gap-1 md:flex">
            {links}
          </nav>
          <div className="ml-auto flex min-w-0 items-center gap-2">
            <span className="text-muted-foreground truncate text-sm">{user.username}</span>
            <Button
              variant="outline"
              size="sm"
              disabled={logout.isPending}
              onClick={() => {
                logout.mutate();
              }}
            >
              Log out
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="md:hidden"
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
        {adminLinks.length > 0 && (
          <nav
            aria-label="Admin"
            className="mx-auto hidden max-w-5xl flex-wrap items-center gap-1 px-4 pb-2 md:flex"
          >
            <span className="text-muted-foreground mr-2 text-sm">Admin</span>
            {adminLinks}
          </nav>
        )}
        {menuOpen && (
          <div className="border-t px-4 py-2 md:hidden">
            <nav aria-label="Main" className="flex flex-col gap-1">
              {links}
            </nav>
            {adminLinks.length > 0 && (
              <nav aria-label="Admin" className="mt-2 flex flex-col gap-1 border-t pt-2">
                <span className="text-muted-foreground px-3 text-sm">Admin</span>
                {adminLinks}
              </nav>
            )}
          </div>
        )}
        {logout.isError && (
          <p role="alert" className="text-destructive px-4 pb-2 text-right text-sm">
            {toApiError(logout.error).message}
          </p>
        )}
      </header>
      <main className="mx-auto max-w-5xl p-4">{children}</main>
    </div>
  );
}
