import { usernameClient } from 'better-auth/client/plugins';
import { createAuthClient } from 'better-auth/react';

/**
 * Better Auth lives at /api/auth. Only the endpoints in the api's
 * `exposedAuthEndpoints` answer. Wrap calls in `authRequest` to get the usual ApiError.
 */
export const authClient = createAuthClient({
  baseURL: window.location.origin,
  basePath: '/api/auth',
  plugins: [usernameClient()],
});
