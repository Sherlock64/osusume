import { z } from 'zod';

export const userRoles = ['admin', 'member'] as const;
export const userRoleSchema = z.enum(userRoles);
export type UserRole = z.infer<typeof userRoleSchema>;

export const listStatuses = [
  'plan_to_watch',
  'watching',
  'completed',
  'on_hold',
  'dropped',
] as const;
export const listStatusSchema = z.enum(listStatuses);
export type ListStatus = z.infer<typeof listStatusSchema>;
export const listStatusLabels: Record<ListStatus, string> = {
  plan_to_watch: 'Plan to watch',
  watching: 'Watching',
  completed: 'Completed',
  on_hold: 'On hold',
  dropped: 'Dropped',
};

export const visibilityTiers = ['private', 'friends', 'members', 'public'] as const;
export const visibilityTierSchema = z.enum(visibilityTiers);
export type VisibilityTier = z.infer<typeof visibilityTierSchema>;

export const inviteRequestStatuses = [
  'pending',
  'approved',
  'rejected',
  'revoked',
  'accepted',
] as const;
export const inviteRequestStatusSchema = z.enum(inviteRequestStatuses);
export type InviteRequestStatus = z.infer<typeof inviteRequestStatusSchema>;

export const catalogRequestStatuses = ['pending', 'approved', 'rejected'] as const;
export const catalogRequestStatusSchema = z.enum(catalogRequestStatuses);
export type CatalogRequestStatus = z.infer<typeof catalogRequestStatusSchema>;

export const catalogRequestKinds = ['new_series', 'add_season'] as const;
export const catalogRequestKindSchema = z.enum(catalogRequestKinds);

export const usernameChangeRequestStatuses = ['pending', 'approved', 'rejected'] as const;
export const usernameChangeRequestStatusSchema = z.enum(usernameChangeRequestStatuses);
export type UsernameChangeRequestStatus = z.infer<typeof usernameChangeRequestStatusSchema>;

export const friendshipStatuses = ['pending', 'accepted'] as const;

export const seasonsOfYear = ['winter', 'spring', 'summer', 'fall'] as const;
export const seasonOfYearSchema = z.enum(seasonsOfYear);
export type SeasonOfYear = z.infer<typeof seasonOfYearSchema>;
