import { z } from 'zod';
import {
  inviteRequestStatusSchema,
  userRoleSchema,
  usernameChangeRequestStatusSchema,
} from './enums.ts';
import { paginationQuerySchema } from './http.ts';

/** How long an emailed invite link works. */
export const INVITE_LIFETIME_DAYS = 7;

export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 30;
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

/** The characters Better Auth's username login accepts. Keeps the capitalization entered. */
export const usernameSchema = z
  .string()
  .min(USERNAME_MIN_LENGTH)
  .max(USERNAME_MAX_LENGTH)
  .regex(/^[a-zA-Z0-9_.]+$/, 'Use only letters, digits, underscores and dots.');

/** Usernames ignore case, so every lookup goes through this key. */
export function usernameKey(username: string): string {
  return username.toLowerCase();
}

export const passwordSchema = z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH);

/** Emails are stored lowercase, which is how Better Auth looks them up. */
export const emailSchema = z.string().trim().toLowerCase().max(254).pipe(z.email());

export const tokenSchema = z.string().min(1).max(512);

export const idParamSchema = z.object({ id: z.uuid() });

export const emailSentResponseSchema = z.object({ status: z.literal('email_sent') });
export type EmailSentResponse = z.infer<typeof emailSentResponseSchema>;

const timestampSchema = z.iso.datetime();

/** `mine` is the only scope outside the admin lists, so it can only be "true" or left out. */
export const mineQuerySchema = paginationQuerySchema.extend({
  mine: z.enum(['true']).optional(),
});

/** An account as its owner or the people handling it see it. `username` keeps its capitalization. */
export const accountSchema = z.object({
  id: z.uuid(),
  username: z.string(),
  email: z.string(),
  role: userRoleSchema,
  createdAt: timestampSchema,
});
export type Account = z.infer<typeof accountSchema>;

/* First-run setup */

export const setupStatusResponseSchema = z.object({ open: z.boolean() });
export type SetupStatusResponse = z.infer<typeof setupStatusResponseSchema>;

export const setupRequestSchema = z.object({
  username: usernameSchema,
  email: emailSchema,
  password: passwordSchema,
});
export type SetupRequest = z.infer<typeof setupRequestSchema>;

export const tokenBodySchema = z.object({ token: tokenSchema });
export type TokenBody = z.infer<typeof tokenBodySchema>;

/* Invites */

export const createInviteRequestSchema = z.object({ email: emailSchema });
export type CreateInviteRequest = z.infer<typeof createInviteRequestSchema>;

export const inviteRequestListQuerySchema = mineQuerySchema;

export const inviteRequestSchema = z.object({
  id: z.uuid(),
  inviteeEmail: z.string(),
  status: inviteRequestStatusSchema,
  /** Set on approval. An approved invite past this time no longer works or counts as open. */
  expiresAt: timestampSchema.nullable(),
  createdAt: timestampSchema,
});
export type InviteRequest = z.infer<typeof inviteRequestSchema>;

export const adminInviteRequestListQuerySchema = paginationQuerySchema.extend({
  status: inviteRequestStatusSchema.optional(),
});

export const adminInviteRequestSchema = inviteRequestSchema.extend({
  /** Null once the requester has been removed. */
  requesterId: z.uuid().nullable(),
  requesterUsername: z.string().nullable(),
  decidedBy: z.uuid().nullable(),
});
export type AdminInviteRequest = z.infer<typeof adminInviteRequestSchema>;

/**
 * What an invite link shows before submit. Any link that cannot be accepted, for whatever
 * reason, gets the same answer: no email and `valid: false`.
 */
export const invitePreviewSchema = z.object({
  valid: z.boolean(),
  email: z.string().nullable(),
});
export type InvitePreview = z.infer<typeof invitePreviewSchema>;

export const decisionSchema = z.object({ decision: z.enum(['approve', 'reject']) });
export type Decision = z.infer<typeof decisionSchema>;

export const acceptInviteSchema = z.object({
  username: usernameSchema,
  password: passwordSchema,
});
export type AcceptInvite = z.infer<typeof acceptInviteSchema>;

/* Own account */

export const changeEmailSchema = z.object({
  currentPassword: z.string().min(1).max(PASSWORD_MAX_LENGTH),
  newEmail: emailSchema,
});
export type ChangeEmail = z.infer<typeof changeEmailSchema>;

export const deleteAccountSchema = z.object({
  currentPassword: z.string().min(1).max(PASSWORD_MAX_LENGTH),
});
export type DeleteAccount = z.infer<typeof deleteAccountSchema>;

/* Username changes */

export const createUsernameChangeRequestSchema = z.object({ username: usernameSchema });
export type CreateUsernameChangeRequest = z.infer<typeof createUsernameChangeRequestSchema>;

export const usernameChangeRequestListQuerySchema = mineQuerySchema;

export const usernameChangeRequestSchema = z.object({
  id: z.uuid(),
  requestedUsername: z.string(),
  status: usernameChangeRequestStatusSchema,
  decidedAt: timestampSchema.nullable(),
  createdAt: timestampSchema,
});
export type UsernameChangeRequest = z.infer<typeof usernameChangeRequestSchema>;

export const adminUsernameChangeRequestListQuerySchema = paginationQuerySchema.extend({
  status: usernameChangeRequestStatusSchema.optional(),
});

export const adminUsernameChangeRequestSchema = usernameChangeRequestSchema.extend({
  userId: z.uuid(),
  currentUsername: z.string(),
  decidedBy: z.uuid().nullable(),
});
export type AdminUsernameChangeRequest = z.infer<typeof adminUsernameChangeRequestSchema>;

/* Admin users */

export const adminUserSchema = accountSchema.extend({
  /** Read-only: the first admin is locked against every admin action. */
  isFirstAdmin: z.boolean(),
  disabledAt: timestampSchema.nullable(),
});
export type AdminUser = z.infer<typeof adminUserSchema>;
