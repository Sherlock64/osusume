import { hc, type ClientRequestOptions } from 'hono/client';
import type { Hono } from 'hono';

/**
 * The typed client pattern used across the workspace.
 *
 * `apps/api` exports its route type as `AppType` from `@osusume/api/app-type`
 * as a type-only import, so no server code reaches the browser bundle. This
 * package stays independent of the api by taking that type as a parameter:
 *
 *   import type { AppType } from '@osusume/api/app-type';
 *   const api = createApiClient<AppType>('/');
 *   await api.api.v1.health.$get();
 *
 * Requests send cookies because the session is a same-origin cookie.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- matches any route schema
export function createApiClient<App extends Hono<any, any, any>>(
  baseUrl: string,
  options?: ClientRequestOptions,
): ReturnType<typeof hc<App>> {
  return hc<App>(baseUrl, {
    ...options,
    init: { credentials: 'same-origin', ...options?.init },
  });
}
