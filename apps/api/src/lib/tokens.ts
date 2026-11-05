import { createHash, randomBytes } from 'node:crypto';

/** A token for an emailed link. Only its hash is stored. */
export function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
