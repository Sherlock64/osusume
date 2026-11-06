import { describe, expect, it } from 'vitest';
import { EnvValidationError, loadDatabaseEnv, loadEnv } from './env.ts';

const valid = {
  DATABASE_URL: 'postgres://user:secret-password@localhost:5432/osusume',
  PUBLIC_BASE_URL: 'http://localhost:5173/',
  AUTH_SECRET: 'a-test-secret-that-is-at-least-32-characters',
  IMAGE_STORAGE_PATH: '/var/lib/osusume/images',
  SMTP_HOST: 'localhost',
  SMTP_PORT: '1025',
  SMTP_FROM: 'Osusume <no-reply@example.test>',
};

function messageFor(source: NodeJS.ProcessEnv): string {
  try {
    loadEnv(source);
  } catch (error) {
    expect(error).toBeInstanceOf(EnvValidationError);
    return (error as Error).message;
  }
  throw new Error('expected loadEnv to throw');
}

describe('loadEnv', () => {
  it('parses a valid environment and applies defaults', () => {
    expect(loadEnv(valid)).toEqual({
      DATABASE_URL: valid.DATABASE_URL,
      NODE_ENV: 'development',
      HOST: '0.0.0.0',
      PORT: 3000,
      PUBLIC_BASE_URL: 'http://localhost:5173',
      AUTH_SECRET: valid.AUTH_SECRET,
      IMAGE_STORAGE_PATH: valid.IMAGE_STORAGE_PATH,
      SMTP_HOST: 'localhost',
      SMTP_PORT: 1025,
      SMTP_SECURE: false,
      SMTP_FROM: valid.SMTP_FROM,
    });
  });

  it('lists every missing required variable by name', () => {
    const message = messageFor({});
    for (const name of [
      'DATABASE_URL',
      'PUBLIC_BASE_URL',
      'AUTH_SECRET',
      'IMAGE_STORAGE_PATH',
      'SMTP_HOST',
      'SMTP_PORT',
      'SMTP_FROM',
    ]) {
      expect(message).toContain(`${name}: is required`);
    }
  });

  it('treats an empty value as unset', () => {
    expect(messageFor({ ...valid, SMTP_HOST: '' })).toContain('SMTP_HOST: is required');
    expect(loadEnv({ ...valid, SMTP_USER: '', SMTP_PASSWORD: '' }).SMTP_USER).toBeUndefined();
  });

  it('rejects a non-postgres DATABASE_URL without echoing its value', () => {
    const message = messageFor({ ...valid, DATABASE_URL: 'mysql://user:hunter2@localhost/db' });
    expect(message).toContain('DATABASE_URL');
    expect(message).not.toContain('hunter2');
  });

  it('rejects an out-of-range port', () => {
    expect(messageFor({ ...valid, SMTP_PORT: '70000' })).toContain('SMTP_PORT');
    expect(messageFor({ ...valid, PORT: 'http' })).toContain('PORT');
  });

  it('rejects a malformed boolean rather than guessing', () => {
    expect(messageFor({ ...valid, SMTP_SECURE: 'maybe' })).toContain('SMTP_SECURE');
    expect(loadEnv({ ...valid, SMTP_SECURE: 'true' }).SMTP_SECURE).toBe(true);
  });

  it('requires SMTP credentials to be set together', () => {
    expect(messageFor({ ...valid, SMTP_USER: 'someone' })).toContain('SMTP_PASSWORD');
    expect(messageFor({ ...valid, SMTP_PASSWORD: 'x' })).toContain('SMTP_USER');
    expect(loadEnv({ ...valid, SMTP_USER: 'someone', SMTP_PASSWORD: 'x' }).SMTP_USER).toBe(
      'someone',
    );
  });

  it('rejects a short auth secret without echoing it', () => {
    const message = messageFor({ ...valid, AUTH_SECRET: 'too-short' });
    expect(message).toContain('AUTH_SECRET');
    expect(message).not.toContain('too-short');
  });

  it('rejects a non-http public base URL', () => {
    expect(messageFor({ ...valid, PUBLIC_BASE_URL: 'ftp://example.test' })).toContain(
      'PUBLIC_BASE_URL',
    );
  });
});

describe('loadDatabaseEnv', () => {
  it('needs only DATABASE_URL', () => {
    expect(loadDatabaseEnv({ DATABASE_URL: valid.DATABASE_URL })).toEqual({
      DATABASE_URL: valid.DATABASE_URL,
    });
    expect(() => loadDatabaseEnv({})).toThrow(/DATABASE_URL: is required/);
  });
});
