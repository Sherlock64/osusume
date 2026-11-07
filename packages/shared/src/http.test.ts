import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  paginationQuerySchema,
} from './http.ts';

describe('paginationQuerySchema', () => {
  it('applies the default page size', () => {
    expect(paginationQuerySchema.parse({})).toEqual({ limit: DEFAULT_PAGE_SIZE });
  });

  it('coerces a limit from the query string', () => {
    expect(paginationQuerySchema.parse({ limit: '10', cursor: 'abc' })).toEqual({
      limit: 10,
      cursor: 'abc',
    });
  });

  it.each([['0'], ['-1'], ['1.5'], [String(MAX_PAGE_SIZE + 1)], ['many']])(
    'rejects a limit of %s',
    (limit) => {
      expect(paginationQuerySchema.safeParse({ limit }).success).toBe(false);
    },
  );
});

