import { useCallback, useEffect, useState } from 'react';
import { toApiError, type ApiError } from '@/lib/api-request';

const attempts = new Map<string, Promise<unknown>>();

/**
 * Runs `run` once per key for the life of the page, handing later callers the same promise. For
 * single-use tokens: StrictMode mounts effects twice, and a second POST would report the used
 * token as dead over the first one's success.
 */
export function submitOnce<T>(key: string, run: () => Promise<T>): Promise<T> {
  const existing = attempts.get(key);
  if (existing) return existing as Promise<T>;
  const attempt = run();
  attempts.set(key, attempt);
  return attempt;
}

export function forgetAttempt(key: string): void {
  attempts.delete(key);
}

type Outcome<T> = { data: T; error?: undefined } | { data?: undefined; error: ApiError };

/**
 * Submits a single-use token when the page opens. Call it only from a page's component, never a
 * route loader, so that preloading can't spend a token. `run` must be defined outside the
 * component. `outcome` stays undefined while the request is out or when `token` is undefined.
 */
export function useSubmitToken<T>(
  name: string,
  token: string | undefined,
  run: (token: string) => Promise<T>,
) {
  const [outcome, setOutcome] = useState<Outcome<T>>();
  const [round, setRound] = useState(0);
  const key = `${name}:${token ?? ''}`;

  useEffect(() => {
    if (token === undefined) return;
    let active = true;
    submitOnce(key, () => run(token)).then(
      (data) => {
        if (active) setOutcome({ data });
      },
      (error: unknown) => {
        if (active) setOutcome({ error: toApiError(error) });
      },
    );
    return () => {
      active = false;
    };
  }, [key, token, run, round]);

  const retry = useCallback(() => {
    forgetAttempt(key);
    setOutcome(undefined);
    setRound((current) => current + 1);
  }, [key]);

  return { outcome, retry };
}
