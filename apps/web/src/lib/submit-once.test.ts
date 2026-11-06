import { describe, expect, it, vi } from 'vitest';
import { forgetAttempt, submitOnce } from './submit-once.ts';

describe('submitOnce', () => {
  it('runs once per key, sharing the result', async () => {
    const run = vi.fn(() => Promise.resolve('done'));
    const results = await Promise.all([submitOnce('a', run), submitOnce('a', run)]);
    expect(results).toEqual(['done', 'done']);
    expect(await submitOnce('a', run)).toBe('done');
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('runs separately for another key', async () => {
    const run = vi.fn(() => Promise.resolve('done'));
    await Promise.all([submitOnce('b', run), submitOnce('c', run)]);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('runs again once forgotten', async () => {
    const run = vi.fn(() => Promise.resolve('done'));
    await submitOnce('d', run);
    forgetAttempt('d');
    await submitOnce('d', run);
    expect(run).toHaveBeenCalledTimes(2);
  });
});
