import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useRouter } from '@tanstack/react-router';
import { Menu, X } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { navItems, visibleNavItems } from '@/app/nav';
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

  const links = visibleNavItems(navItems, user.role).map((item) => (
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
  ));

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
        {menuOpen && (
          <nav aria-label="Main" className="flex flex-col gap-1 border-t px-4 py-2 md:hidden">
            {links}
          </nav>
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
