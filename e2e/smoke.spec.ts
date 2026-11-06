import { randomBytes } from 'node:crypto';
import { type APIRequestContext, expect, type Page, test } from '@playwright/test';
import { noisePng } from './png.ts';

// See "Smoke tests" in the README for what each variable turns on.
const mailpitUrl = process.env.SMOKE_MAILPIT_URL;
const admin = {
  username: process.env.SMOKE_ADMIN_USERNAME ?? 'smoke_admin',
  email: process.env.SMOKE_ADMIN_EMAIL ?? 'smoke-admin@example.test',
  password: process.env.SMOKE_ADMIN_PASSWORD ?? randomBytes(18).toString('base64url'),
};
const adminPasswordKnown = process.env.SMOKE_ADMIN_PASSWORD !== undefined;

/** Set once this run has an admin who can log in. */
let adminReady = adminPasswordKnown;

async function setupIsOpen(request: APIRequestContext): Promise<boolean> {
  const response = await request.get('/api/v1/setup/status');
  expect(response.ok()).toBe(true);
  return ((await response.json()) as { open: boolean }).open;
}

async function setupLinkFromMailpit(): Promise<string> {
  const query = new URLSearchParams({ query: `to:"${admin.email}"` });
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const found = await fetch(`${String(mailpitUrl)}/api/v1/search?${query.toString()}`);
    const { messages } = (await found.json()) as { messages: { ID: string }[] };
    const newest = messages[0];
    if (newest !== undefined) {
      const message = await fetch(`${String(mailpitUrl)}/api/v1/message/${newest.ID}`);
      const { Text: text } = (await message.json()) as { Text: string };
      const link = /https?:\/\/\S+/.exec(text)?.[0];
      if (link !== undefined) return link;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`No setup email for ${admin.email} in Mailpit`);
}

async function logIn(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Username').fill(admin.username);
  await page.getByLabel('Password').fill(admin.password);
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

test('robots.txt is served at the site root', async ({ request }) => {
  const response = await request.get('/robots.txt');
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toContain('text/plain');
  const body = await response.text();
  expect(body).toContain('Disallow: /lists/');
  expect(body).toContain('Disallow: /api/v1/lists/');
});

test('the api is ready and the app loads for an anonymous visitor', async ({ page, request }) => {
  expect((await request.get('/api/v1/health/ready')).status()).toBe(200);
  const open = await setupIsOpen(request);
  await page.goto('/');
  await expect(page).toHaveURL(open ? /\/setup/ : /\/login/);
  await expect(page.getByRole('button', { name: open ? 'Send verification' : 'Log in' })).toBeVisible();
});

test('first-run setup works through the browser, with the link from Mailpit', async ({
  page,
  request,
}) => {
  test.skip(mailpitUrl === undefined, 'SMOKE_MAILPIT_URL is not set');
  test.skip(!(await setupIsOpen(request)), 'setup is already closed');

  await page.goto('/setup');
  await page.getByLabel('Username').fill(admin.username);
  await page.getByLabel('Email').fill(admin.email);
  await page.getByLabel('Password').fill(admin.password);
  await page.getByRole('button', { name: 'Send verification link' }).click();
  await expect(page.getByText('Check your email')).toBeVisible();

  const link = await setupLinkFromMailpit();
  expect(new URL(link).origin).toBe(new URL(page.url()).origin);
  await page.goto(link);
  await expect(page.getByRole('link', { name: 'Log in' })).toBeVisible();
  expect(await setupIsOpen(request)).toBe(false);
  adminReady = true;
});

test('a session cookie is set at this address and survives a reload', async ({ page, context }) => {
  test.skip(!adminReady, 'needs an admin: set SMOKE_ADMIN_USERNAME and SMOKE_ADMIN_PASSWORD');

  await logIn(page);
  const cookies = await context.cookies();
  const session = cookies.find((cookie) => cookie.name.endsWith('better-auth.session_token'));
  expect(session?.httpOnly).toBe(true);
  await page.reload();
  await expect(page).not.toHaveURL(/\/login/);
  const me = await page.request.get('/api/auth/get-session');
  expect(((await me.json()) as { user: { username: string } }).user.username).toBe(admin.username);
});

test('an image of nearly 10 MB uploads, is served, and an oversize one is refused', async ({
  page,
}) => {
  test.skip(!adminReady, 'needs an admin: set SMOKE_ADMIN_USERNAME and SMOKE_ADMIN_PASSWORD');

  await logIn(page);
  const created = await page.request.post('/api/v1/series', {
    data: { title: `Smoke test ${randomBytes(4).toString('hex')}` },
  });
  expect(created.status()).toBe(201);
  const { id } = (await created.json()) as { id: string };
  try {
    const upload = (buffer: Buffer) =>
      page.request.post(`/api/v1/series/${id}/images`, {
        multipart: { file: { name: 'smoke.png', mimeType: 'image/png', buffer } },
      });

    const near = noisePng(1860);
    expect(near.length).toBeGreaterThan(10_000_000);
    const added = await upload(near);
    expect(added.status(), await added.text()).toBe(201);
    const { id: imageId } = (await added.json()) as { id: string };
    const served = await page.request.get(`/api/v1/images/${imageId}/small`);
    expect(served.status()).toBe(200);
    expect(served.headers()['content-type']).toBe('image/webp');

    // Over 10 MiB and under the proxy's limit, so the api's own error comes back.
    const refused = await upload(noisePng(1900));
    expect(refused.status()).toBe(413);
    expect(await refused.text()).toContain('image_too_large');
  } finally {
    const removed = await page.request.delete(`/api/v1/series/${id}`);
    expect(removed.ok()).toBe(true);
  }
});

test('an oversized JSON body is refused, without logging in', async ({ request }) => {
  const response = await request.post('/api/v1/setup', {
    headers: { 'Content-Type': 'application/json' },
    data: JSON.stringify({ username: 'x'.repeat(2 * 1024 * 1024) }),
  });
  expect(response.status()).toBe(413);
});

// Last, because it uses up this address's login attempts for the next 10 seconds.
test('a client-set X-Forwarded-For does not get around the login rate limit', async ({
  request,
  baseURL,
}) => {
  const statuses: number[] = [];
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const response = await request.post('/api/auth/sign-in/username', {
      headers: {
        Origin: String(baseURL),
        'X-Forwarded-For': `203.0.113.${String(attempt + 1)}`,
      },
      data: { username: 'smoke_nobody', password: 'not-the-password' },
    });
    statuses.push(response.status());
  }
  expect(statuses).toContain(429);
  expect(statuses.at(-1)).toBe(429);
});

test('the constellations page shows a series that was added to the list', async ({ page }) => {
  test.skip(!adminReady, 'needs an admin: set SMOKE_ADMIN_USERNAME and SMOKE_ADMIN_PASSWORD');

  await logIn(page);
  const title = `Smoke test ${randomBytes(4).toString('hex')}`;
  const created = await page.request.post('/api/v1/series', { data: { title } });
  expect(created.status()).toBe(201);
  const { id } = (await created.json()) as { id: string };
  let seasonId: string | undefined;
  try {
    const season = await page.request.post('/api/v1/seasons', {
      data: { seriesId: id, ordinal: 1, title },
    });
    expect(season.status(), await season.text()).toBe(201);
    seasonId = ((await season.json()) as { id: string }).id;
    const listed = await page.request.put(`/api/v1/me/list/${seasonId}`, {
      data: { status: 'watching' },
    });
    expect(listed.status(), await listed.text()).toBe(200);

    await page.goto('/constellations');
    await expect(page.getByText(title)).toBeVisible();
  } finally {
    // The list entry restricts deleting its season, and a series with seasons can't be deleted.
    if (seasonId !== undefined) {
      await page.request.delete(`/api/v1/me/list/${seasonId}`);
      await page.request.delete(`/api/v1/seasons/${seasonId}`);
    }
    const removed = await page.request.delete(`/api/v1/series/${id}`);
    expect(removed.ok()).toBe(true);
  }
});
