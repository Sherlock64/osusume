import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { consumeAttempt } from './rate-limit.ts';

const rule = { windowSeconds: 10, max: 3 };

describe('consumeAttempt', () => {
  it('allows up to the limit, then says how long to wait', () => {
    const key = randomUUID();
    const start = Date.now();
    expect(consumeAttempt(key, rule, start)).toBeNull();
    expect(consumeAttempt(key, rule, start)).toBeNull();
    expect(consumeAttempt(key, rule, start)).toBeNull();
    expect(consumeAttempt(key, rule, start + 4000)).toBe(6);
  });

  it('starts again after the window', () => {
    const key = randomUUID();
    const start = Date.now();
    for (let i = 0; i < 4; i += 1) consumeAttempt(key, rule, start);
    expect(consumeAttempt(key, rule, start + 10_000)).toBeNull();
  });

  it('keeps a long window when a shorter rule is used on another key', () => {
    const key = randomUUID();
    const long = { windowSeconds: 3600, max: 1 };
    const start = Date.now();
    consumeAttempt(key, long, start);
    consumeAttempt(randomUUID(), rule, start + 60_000);
    expect(consumeAttempt(key, long, start + 60_000)).toBe(3540);
  });

  it('counts each key separately', () => {
    const start = Date.now();
    const key = randomUUID();
    for (let i = 0; i < 4; i += 1) consumeAttempt(key, rule, start);
    expect(consumeAttempt(randomUUID(), rule, start)).toBeNull();
  });
});
