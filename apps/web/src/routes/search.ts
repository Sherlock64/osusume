import { tokenSchema } from '@osusume/shared';
import { z } from 'zod';

/** The `?token=` of an emailed link. A malformed one reads as missing: the page shows a dead link. */
export const tokenSearchSchema = z.object({ token: tokenSchema.optional().catch(undefined) });
