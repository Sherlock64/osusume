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

  it('counts each key separately', () => {
    const start = Date.now();
    const key = randomUUID();
    for (let i = 0; i < 4; i += 1) consumeAttempt(key, rule, start);
    expect(consumeAttempt(randomUUID(), rule, start)).toBeNull();
  });
});
