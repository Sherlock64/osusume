import { userRoleSchema } from '@osusume/shared';
import { queryOptions } from '@tanstack/react-query';
import { z } from 'zod';
import { api } from '@/lib/api';
import { authRequest, request } from '@/lib/api-request';
import { authClient } from '@/lib/auth-client';

const sessionResponseSchema = z
  .object({
    user: z.object({
      id: z.string(),
      username: z.string(),
      displayUsername: z.string().nullish(),
      email: z.string(),
      role: userRoleSchema,
      isFirstAdmin: z.boolean().nullish(),
    }),
  })
  .nullable();

export interface SessionUser {
  id: string;
  /** Keeps the capitalization entered. */
  username: string;
  email: string;
  role: z.infer<typeof userRoleSchema>;
  /** The first admin is permanent, so they are not offered deleting their account. */
  isFirstAdmin: boolean;
}

/** The logged-in user, or null. A failed check throws, so an outage doesn't look like a logout. */
export const sessionQuery = queryOptions({
  queryKey: ['session'],
  staleTime: 30_000,
  queryFn: async (): Promise<SessionUser | null> => {
    const session = sessionResponseSchema.parse(await authRequest(authClient.getSession()));
    if (!session) return null;
    const { displayUsername, isFirstAdmin, ...user } = session.user;
    return {
      ...user,
      username: displayUsername ?? user.username,
      isFirstAdmin: isFirstAdmin === true,
    };
  },
});

/** Setup never reopens, so only a closed answer can be kept. */
export const setupStatusQuery = queryOptions({
  queryKey: ['setup-status'],
  staleTime: (query) => (query.state.data?.open === false ? Infinity : 0),
  queryFn: () => request(api.setup.status.$get()),
});
