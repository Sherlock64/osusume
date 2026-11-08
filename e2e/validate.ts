// Screenshots the main pages in light and dark, at desktop and phone width, and writes one report.
// Usage and variables: see "Validation run" in docs/development.md.
import { randomBytes } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Browser, type BrowserContextOptions, chromium, type Page, request } from '@playwright/test';

const SITE = (process.env.VALIDATE_BASE_URL ?? 'http://localhost:5173').replace(/\/$/, '');
const MAILPIT = process.env.VALIDATE_MAILPIT_URL?.replace(/\/$/, '');
const OUT = join(import.meta.dirname, '.results', 'validate');
// Outside OUT, because each run empties OUT.
const CREDENTIALS = join(import.meta.dirname, '.results', 'validate-credentials.env');
const THEMES = (process.env.VALIDATE_THEMES ?? 'light,dark').split(',');
const VIEWPORTS = (process.env.VALIDATE_WIDTHS ?? '1440,390')
  .split(',')
  .map((width) => ({ width: Number(width), height: Number(width) >= 768 ? 900 : 844 }));
const filters = process.argv.slice(2);

const user = {
  username: process.env.VALIDATE_USER ?? 'validate_admin',
  password: process.env.VALIDATE_PASSWORD ?? '',
  email: 'validate-admin@example.test',
};

// Each call gets its own client address, so the auth rate limit (per address) never trips.
// The compose and minikube proxies overwrite the header, so there all calls share one bucket.
let ipCounter = Math.floor(Math.random() * 60_000);
function freshIp(): string {
  ipCounter += 1;
  return `10.${String((ipCounter >> 16) & 255)}.${String((ipCounter >> 8) & 255)}.${String(ipCounter & 255)}`;
}

async function api(method: string, path: string, cookie: string, body?: unknown): Promise<{ data: unknown; cookie: string }> {
  const response = await fetch(SITE + path, {
    method,
    headers: { 'content-type': 'application/json', origin: SITE, cookie, 'x-forwarded-for': freshIp() },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${method} ${path}: ${String(response.status)} ${text.slice(0, 200)}`);
  const set = response.headers.getSetCookie();
  return { data: text ? (JSON.parse(text) as unknown) : null, cookie: set.length ? set.map((c) => c.split(';')[0]).join('; ') : cookie };
}

/** The newest link mailed to `to` after `since`. Mailpit keeps old mail from earlier installs. */
async function mailLink(to: string, since: number): Promise<string> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const search = (await (await fetch(`${String(MAILPIT)}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`)).json()) as {
      messages: { ID: string; Created: string }[];
    };
    const newest = search.messages.find((message) => Date.parse(message.Created) >= since);
    if (newest) {
      const message = (await (await fetch(`${String(MAILPIT)}/api/v1/message/${newest.ID}`)).json()) as { Text: string };
      const link = /https?:\/\/\S+/.exec(message.Text)?.[0];
      if (link) return link;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`No email for ${to} in Mailpit`);
}

const SEED_TITLES = ['Naruto', 'Bleach', 'One Piece', 'Mushishi', 'Frieren', 'Monster', 'Cowboy Bebop', 'Planetes', 'Haikyu!!', 'Ping Pong', 'Mob Psycho 100', 'Hyouka'];
const SEED_STATUSES = ['watching', 'completed', 'on_hold', 'dropped', 'plan_to_watch'];

/** On a new install: does first-run setup, then adds 12 series to the admin's list and map. */
async function setUpNewInstall(): Promise<void> {
  user.password = randomBytes(18).toString('base64url');
  const since = Date.now() - 5_000; // allows for a small clock difference with the Mailpit container
  await api('POST', '/api/v1/setup', '', { username: user.username, email: user.email, password: user.password });
  const token = new URL(await mailLink(user.email, since)).searchParams.get('token');
  await api('POST', '/api/v1/setup/verify', '', { token });
  let { cookie } = await api('POST', '/api/auth/sign-in/username', '', { username: user.username, password: user.password });
  for (const [index, title] of SEED_TITLES.entries()) {
    const series = (await api('POST', '/api/v1/series', cookie, { title })).data as { id: string };
    const season = (await api('POST', '/api/v1/seasons', cookie, { seriesId: series.id, ordinal: 1, title: `${title} Season 1` }))
      .data as { id: string };
    ({ cookie } = await api('PUT', `/api/v1/me/list/${season.id}`, cookie, { status: SEED_STATUSES[index % SEED_STATUSES.length] }));
  }
  writeFileSync(CREDENTIALS, `VALIDATE_USER=${user.username}\nVALIDATE_PASSWORD=${user.password}\n`, { mode: 0o600 });
  console.log(`New install set up. Login saved in ${CREDENTIALS}`);
}

type Shot = { name: string; path: string; loggedIn: boolean };

async function routes(cookie: string): Promise<Shot[]> {
  const series = ((await api('GET', '/api/v1/series?limit=1', cookie)).data as { items: { id: string }[] }).items[0];
  const out = (name: string, path: string): Shot => ({ name, path, loggedIn: false });
  const inn = (name: string, path: string): Shot => ({ name, path, loggedIn: true });
  return [
    out('login', '/login'),
    out('forgot-password', '/forgot-password'),
    inn('home', '/'),
    inn('home-search', '/?q=a'),
    inn('catalog', '/catalog'),
    ...(series ? [inn('series', `/series/${series.id}`)] : []),
    inn('constellations', '/constellations'),
    inn('friends', '/friends'),
    inn('compare', '/compare'),
    inn('requests', '/requests'),
    inn('requests-new', '/requests/new'),
    inn('invites', '/invites'),
    inn('settings', '/settings'),
    inn('admin-catalog', '/admin/catalog'),
    inn('admin-requests', '/admin/requests'),
    inn('admin-invites', '/admin/invites'),
    inn('admin-users', '/admin/users'),
    inn('admin-tags', '/admin/tags'),
    inn('admin-username-changes', '/admin/username-changes'),
  ].filter((shot) => filters.length === 0 || filters.some((word) => shot.name.includes(word)));
}

async function capture(page: Page, shot: Shot, label: string): Promise<string> {
  const errors: string[] = [];
  const onConsole = (message: { type(): string; text(): string }) => {
    if (message.type() === 'error') errors.push(message.text().slice(0, 120));
  };
  const onResponse = (response: { status(): number; url(): string; request(): { method(): string } }) => {
    if (response.status() >= 400) errors.push(`${String(response.status())} ${response.request().method()} ${new URL(response.url()).pathname}`);
  };
  page.on('console', onConsole);
  page.on('response', onResponse);
  try {
    await page.goto(shot.path, { waitUntil: 'networkidle' });
  } catch (error) {
    errors.push(`load: ${String(error).slice(0, 120)}`);
  }
  await page.waitForTimeout(300); // lets fades and the canvas fit finish
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  const file = `${shot.name}-${label}.png`;
  await page.screenshot({ path: join(OUT, file) });
  page.off('console', onConsole);
  page.off('response', onResponse);
  const ended = new URL(page.url()).pathname;
  const problems = [...(overflow > 0 ? [`overflow ${String(overflow)}px`] : []), ...(ended !== shot.path.split('?')[0] ? [`ended on ${ended}`] : []), ...errors];
  return `${problems.length ? 'FAIL' : 'ok  '} ${file}${problems.length ? `  ${problems.join(' | ')}` : ''}`;
}

async function run(browser: Browser, shots: Shot[], theme: string, viewport: { width: number; height: number }, state: BrowserContextOptions['storageState']): Promise<string[]> {
  const label = `${theme}-${String(viewport.width)}`;
  const lines: string[] = [];
  for (const loggedIn of [false, true]) {
    const mine = shots.filter((shot) => shot.loggedIn === loggedIn);
    if (mine.length === 0) continue;
    const context = await browser.newContext({
      baseURL: SITE,
      viewport,
      colorScheme: theme === 'dark' ? 'dark' : 'light',
      isMobile: viewport.width < 768,
      hasTouch: viewport.width < 768,
      storageState: loggedIn ? state : undefined,
    });
    await context.addInitScript((value) => {
      localStorage.setItem('osusume-theme', value);
    }, theme);
    const page = await context.newPage();
    for (const shot of mine) lines.push(await capture(page, shot, label));
    await context.close();
  }
  return lines;
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

if (MAILPIT && !process.env.VALIDATE_PASSWORD) {
  const status = (await api('GET', '/api/v1/setup/status', '')).data as { open: boolean };
  if (status.open) await setUpNewInstall();
}
if (!user.password) throw new Error('Set VALIDATE_USER and VALIDATE_PASSWORD (or load e2e/.results/validate-credentials.env), or set VALIDATE_MAILPIT_URL on a new install.');

// Logs in once through the api, and every logged-in page reuses that session.
const login = await request.newContext({ baseURL: SITE, extraHTTPHeaders: { origin: SITE, 'x-forwarded-for': freshIp() } });
const signIn = await login.post('/api/auth/sign-in/username', { data: { username: user.username, password: user.password } });
if (!signIn.ok()) throw new Error(`Login as ${user.username}: ${String(signIn.status())}`);
const storageState = await login.storageState();
const cookie = storageState.cookies.map((c) => `${c.name}=${c.value}`).join('; ');
await login.dispose();

const shots = await routes(cookie);
if (shots.length === 0) throw new Error(`No page name contains ${filters.join(' or ')}. See routes() in e2e/validate.ts.`);
const started = Date.now();
const browser = await chromium.launch();
const results = await Promise.all(
  THEMES.flatMap((theme) => VIEWPORTS.map((viewport) => run(browser, shots, theme, viewport, storageState))),
);
await browser.close();

const lines = results.flat().sort((a, b) => a.slice(5).localeCompare(b.slice(5)));
const failed = lines.filter((line) => line.startsWith('FAIL')).length;
const summary = `${String(lines.length)} shots, ${String(failed)} with problems, ${String(Math.round((Date.now() - started) / 1000))} s. Site ${SITE}`;
writeFileSync(join(OUT, 'report.txt'), `${summary}\n${lines.join('\n')}\n`);
console.log(`${summary}\nShots and report.txt in ${OUT}`);
for (const line of lines.filter((l) => l.startsWith('FAIL'))) console.log(line);
process.exitCode = failed ? 1 : 0;
