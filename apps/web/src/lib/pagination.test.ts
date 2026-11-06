import { describe, expect, it, vi } from 'vitest';
import { fetchAllPages } from './pagination';

describe('fetchAllPages', () => {
  it('follows the cursor to the last page', async () => {
    const fetchPage = vi.fn((cursor: string | undefined) =>
      Promise.resolve(
        cursor === undefined ? { items: [1, 2], nextCursor: 'next' } : { items: [3], nextCursor: null },
      ),
    );
    await expect(fetchAllPages(fetchPage)).resolves.toEqual([1, 2, 3]);
    expect(fetchPage.mock.calls).toEqual([[undefined], ['next']]);
  });
});
