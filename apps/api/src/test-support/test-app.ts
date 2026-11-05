import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect } from 'vitest';
import { createApp } from '../app.ts';
import { insertAccount } from '../auth/accounts.ts';
import { createAuth } from '../auth/auth.ts';
import { createVolumeImageStorage } from '../lib/image-storage.ts';
import { type Mailer, createSmtpMailer } from '../lib/mailer.ts';
import { testSmtpEnv } from './mailpit.ts';
import { createMigratedDatabase } from './scratch-database.ts';

export const PUBLIC_BASE_URL = 'http://osusume.test';
export const PASSWORD = 'correct horse battery';

/** A recipient no other test or process has used. */
export function uniqueEmail(label = 'user'): string {
  return `${label}-${randomUUID()}@example.test`;
}

let usernameCounter = 0;

/** A username no other test in this file has used. */
export function uniqueUsername(label = 'user'): string {
  usernameCounter += 1;
  return `${label}_${randomBytes(3).toString('hex')}_${String(usernameCounter)}`;
}

function randomIp(): string {
  const octet = () => String(randomBytes(1)[0] ?? 1);
  return `10.${octet()}.${octet()}.${octet()}`;
}

export interface RequestOptions {
  cookie?: string | undefined;
  /** Better Auth limits by client IP, so requests get a random one unless a test sets it. */
  ip?: string;
  origin?: string;
}

export interface TestResponse {
  status: number;
  body: unknown;
  headers: Headers;
}

/**
 * The real app on a scratch database and Mailpit. Pass `mailer` to replace SMTP, for
 * testing what happens when sending fails.
 */
export async function createTestApp(options: { mailer?: Mailer; publicBaseUrl?: string } = {}) {
  const publicBaseUrl = options.publicBaseUrl ?? PUBLIC_BASE_URL;
  const { db, pool, cleanup: dropDatabase } = await createMigratedDatabase();
  const imageDirectory = await mkdtemp(join(tmpdir(), 'osusume-images-'));
  const imageStorage = createVolumeImageStorage(imageDirectory);
  const cleanup = async () => {
    await dropDatabase();
    await rm(imageDirectory, { recursive: true, force: true });
  };
  const mailer = options.mailer ?? createSmtpMailer(testSmtpEnv);
  const auth = createAuth({
    db,
    secret: 'a-test-secret-that-is-at-least-32-characters',
    publicBaseUrl,
    mailer,
  });
  const app = createApp({
    checkDatabase: () => Promise.resolve(),
    db,
    auth,
    mailer,
    imageStorage,
    publicBaseUrl,
  });
  const passwordHash = await (await auth.$context).password.hash(PASSWORD);

  async function request(
    method: string,
    path: string,
    body?: unknown,
    requestOptions: RequestOptions = {},
  ): Promise<TestResponse> {
    const response = await app.request(`${publicBaseUrl}${path}`, {
      method,
      headers: {
        origin: requestOptions.origin ?? publicBaseUrl,
        'x-forwarded-for': requestOptions.ip ?? randomIp(),
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(requestOptions.cookie === undefined ? {} : { cookie: requestOptions.cookie }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    let parsed: unknown = text;
    try {
      parsed = JSON.parse(text);
    } catch {
      // Not JSON; tests see the raw text.
    }
    return { status: response.status, body: parsed, headers: response.headers };
  }

  /** Uploads a file as multipart form data, declaring the given type and name. */
  async function upload(
    bytes: Uint8Array,
    options: { cookie?: string; type?: string; name?: string; field?: string } = {},
  ): Promise<TestResponse> {
    const form = new FormData();
    const file = new File([Buffer.from(bytes)], options.name ?? 'upload.png', {
      type: options.type ?? 'image/png',
    });
    form.append(options.field ?? 'file', file);
    const response = await app.request(`${publicBaseUrl}/api/v1/images`, {
      method: 'POST',
      headers: {
        origin: publicBaseUrl,
        ...(options.cookie === undefined ? {} : { cookie: options.cookie }),
      },
      body: form,
    });
    const text = await response.text();
    let parsed: unknown = text;
    try {
      parsed = JSON.parse(text);
    } catch {
      // Not JSON; tests see the raw text.
    }
    return { status: response.status, body: parsed, headers: response.headers };
  }

  /** Logs in through Better Auth and returns the session cookie. */
  async function login(username: string, password = PASSWORD): Promise<string> {
    const response = await request('POST', '/api/auth/sign-in/username', { username, password });
    if (response.status !== 200) {
      throw new Error(`Login failed: ${String(response.status)} ${JSON.stringify(response.body)}`);
    }
    const cookie = response.headers.get('set-cookie');
    if (!cookie) throw new Error('Login set no cookie');
    return cookie.split(';')[0] ?? '';
  }

  /** Creates an account directly, skipping the invite flow that a given test is not about. */
  async function seedUser(
    values: { role?: 'admin' | 'member'; isFirstAdmin?: boolean; email?: string; username?: string } = {},
  ) {
    const username = values.username ?? uniqueUsername();
    const email = values.email ?? uniqueEmail();
    const row = await db.transaction((tx) =>
      insertAccount(tx, {
        username,
        email,
        passwordHash,
        role: values.role ?? 'member',
        isFirstAdmin: values.isFirstAdmin ?? false,
      }),
    );
    return { ...row, enteredUsername: username };
  }

  async function seedLoggedIn(values: Parameters<typeof seedUser>[0] = {}) {
    const row = await seedUser(values);
    return { ...row, cookie: await login(row.enteredUsername) };
  }

  return { app, db, pool, auth, imageDirectory, imageStorage, request, upload, login, seedUser, seedLoggedIn, cleanup };
}

/** Asserts a refusal in the api's error shape. */
export function expectError(response: TestResponse, status: number, code: string): void {
  expect({ status: response.status, body: response.body }).toMatchObject({
    status,
    body: { error: { code } },
  });
}

export type TestApp = Awaited<ReturnType<typeof createTestApp>>;
