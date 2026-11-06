import { describe, expect, it } from 'vitest';
import { visibleNavItems, type NavItem } from '../app/nav.ts';
import { anonymousTarget, safeRedirect } from './guards.ts';

describe('safeRedirect', () => {
  it.each(['/', '/friends', '/series/1?tab=seasons#top'])('keeps the local path %s', (target) => {
    expect(safeRedirect(target)).toBe(target);
  });

  it.each([
    undefined,
    '',
    'friends',
    'https://evil.example',
    '//evil.example',
    '/\\evil.example',
    '/\t/evil.example',
    'javascript:alert(1)',
  ])('sends %s home', (target) => {
    expect(safeRedirect(target)).toBe('/');
  });
});

describe('anonymousTarget', () => {
  it('goes to setup on a fresh install', () => {
    expect(anonymousTarget(true, '/friends')).toEqual({ to: '/setup' });
  });

  it('goes to login, keeping the destination', () => {
    expect(anonymousTarget(false, '/friends?a=1')).toEqual({
      to: '/login',
      search: { redirect: '/friends?a=1' },
    });
  });

  it('leaves the default destination out of the login link', () => {
    expect(anonymousTarget(false, '/')).toEqual({ to: '/login', search: {} });
  });
});

describe('visibleNavItems', () => {
  const items: NavItem[] = [
    { to: '/', label: 'Home' },
    { to: '/', label: 'Users', adminOnly: true },
  ];

  it('hides admin links from members', () => {
    expect(visibleNavItems(items, 'member').map((item) => item.label)).toEqual(['Home']);
  });

  it('shows admin links to admins', () => {
    expect(visibleNavItems(items, 'admin').map((item) => item.label)).toEqual(['Home', 'Users']);
  });
});
