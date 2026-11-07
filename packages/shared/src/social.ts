import { z } from 'zod';
import { usernameKey, usernameSchema } from './accounts.ts';
import { TITLE_MAX_LENGTH } from './catalog.ts';
import { listStatusSchema, visibilityTierSchema } from './enums.ts';
import { paginationQuerySchema } from './http.ts';

export const LIST_NOTE_MAX_LENGTH = 10_000;
export const COMPARE_USERS_MAX = 100;

const timestampSchema = z.iso.datetime();

/**
 * The sort value in a list or friends cursor, a title or a username. A cursor is client input
 * like any other, so one that could not have been issued is refused rather than queried.
 */
export const textCursorSortSchema = z.string().max(TITLE_MAX_LENGTH);

/**
 * A username to look up. Deliberately looser than `usernameSchema`: a name that could not exist
 * gets the same not-found or "not available" answer as one that does not exist.
 */
const usernameLookupSchema = z.string().min(1);

export const usernameParamSchema = z.object({ username: usernameLookupSchema });
export const seasonIdParamSchema = z.object({ seasonId: z.uuid() });
export const listSlugParamSchema = z.object({
  slug: z.string().min(1),
});

/* Watch list */

export const listQuerySchema = paginationQuerySchema.extend({
  /** Series with at least one season on the list at this status. */
  status: listStatusSchema.optional(),
});
export type ListQuery = z.infer<typeof listQuerySchema>;

/** On a PUT, a note left out stays as it is, and null or an empty note clears it. */
export const putListEntrySchema = z.object({
  status: listStatusSchema,
  note: z
    .string()
    .trim()
    .max(LIST_NOTE_MAX_LENGTH)
    .nullable()
    .optional(),
});

export const putListSettingsSchema = z.object({ visibility: visibilityTierSchema });

export const listSettingsSchema = z.object({
  visibility: visibilityTierSchema,
  /** Set only while the visibility is public. Going public again makes a new one. */
  publicSlug: z.string().nullable(),
});
export type ListSettings = z.infer<typeof listSettingsSchema>;

/* Friends */

export const friendRelations = ['friend', 'incoming', 'outgoing'] as const;
export const friendRelationSchema = z.enum(friendRelations);
export type FriendRelation = z.infer<typeof friendRelationSchema>;

export const friendListQuerySchema = paginationQuerySchema.extend({
  relation: friendRelationSchema.optional(),
});

export const createFriendRequestSchema = z.object({ username: usernameSchema });

/** An accepted friend or a pending request, as the current user sees it. */
export const friendEntrySchema = z.object({
  /** The friendship: the id to accept, decline, cancel or unfriend with. */
  id: z.uuid(),
  relation: friendRelationSchema,
  username: z.string(),
  createdAt: timestampSchema,
});
export type FriendEntry = z.infer<typeof friendEntrySchema>;

/* Compare */

/** The distinct usernames in a `users` value, in the order given, as they were typed. */
export function parseCompareUsernames(users: string): string[] {
  const seen = new Set<string>();
  const usernames: string[] = [];
  for (const part of users.split(',')) {
    const username = part.trim();
    const key = usernameKey(username);
    if (username === '' || seen.has(key)) continue;
    seen.add(key);
    usernames.push(username);
  }
  return usernames;
}

export const compareQuerySchema = z.object({
  users: z
    .string()
    .refine((users) => parseCompareUsernames(users).length > 0, 'Name at least one username.')
    .refine(
      (users) => parseCompareUsernames(users).length <= COMPARE_USERS_MAX,
      `Name at most ${String(COMPARE_USERS_MAX)} usernames.`,
    ),
});

export const compareRowSchema = z.object({
  seasonId: z.uuid(),
  seriesId: z.uuid(),
  seriesTitle: z.string(),
  seasonTitle: z.string(),
  ordinal: z.number().int(),
  /** Who has this season, in the order of `users`. */
  on: z.array(z.string()),
  /** Every compared person, with null for those who do not have this season. */
  statuses: z.array(z.object({ username: z.string(), status: listStatusSchema.nullable() })),
});
export type CompareRow = z.infer<typeof compareRowSchema>;

export const compareResponseSchema = z.object({
  /**
   * Everyone asked for, in the order given. An unavailable name comes back as it was typed,
   * so nothing tells a missing user from a disabled one or a hidden list.
   */
  users: z.array(z.object({ username: z.string(), available: z.boolean() })),
  /** Null with fewer than two available lists: there is nothing to compare. */
  comparison: z
    .object({
      onAll: z.array(compareRowSchema),
      /** On at least two lists, but not all of them. */
      onSome: z.array(compareRowSchema),
      onOne: z.array(compareRowSchema),
    })
    .nullable(),
});
export type CompareResponse = z.infer<typeof compareResponseSchema>;
