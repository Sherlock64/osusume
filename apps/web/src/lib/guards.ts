/**
 * Where a post-login redirect may go: only a path on this site. Anything else, such as
 * `//evil.example` or a full URL in a crafted login link, goes home.
 */
export function safeRedirect(target: string | undefined): string {
  if (target === undefined || !target.startsWith('/')) return '/';
  const base = 'http://osusume.invalid';
  try {
    return new URL(target, base).origin === base ? target : '/';
  } catch {
    return '/';
  }
}

/** Where to send an anonymous visitor from a page that needs a login. */
export function anonymousTarget(
  setupOpen: boolean,
  href: string,
): { to: '/setup' } | { to: '/login'; search: { redirect?: string } } {
  if (setupOpen) return { to: '/setup' };
  return { to: '/login', search: href === '/' ? {} : { redirect: href } };
}
