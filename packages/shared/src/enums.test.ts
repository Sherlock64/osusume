import { describe, expect, it } from 'vitest';
import {
  inviteRequestStatusSchema,
  listStatusSchema,
  userRoleSchema,
  visibilityTierSchema,
} from './enums.ts';

describe('shared enums', () => {
  it('accepts the documented values', () => {
    expect(userRoleSchema.options).toEqual(['admin', 'member']);
    expect(visibilityTierSchema.options).toEqual(['private', 'friends', 'members', 'public']);
    expect(listStatusSchema.options).toEqual([
      'plan_to_watch',
      'watching',
      'completed',
      'on_hold',
      'dropped',
    ]);
    expect(inviteRequestStatusSchema.options).toEqual([
      'pending',
      'approved',
      'rejected',
      'revoked',
      'accepted',
    ]);
  });

  it('rejects unknown values', () => {
    expect(listStatusSchema.safeParse('rewatching').success).toBe(false);
    expect(userRoleSchema.safeParse('owner').success).toBe(false);
  });
});
