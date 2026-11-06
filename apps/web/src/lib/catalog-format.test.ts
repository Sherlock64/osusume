import { describe, expect, it } from 'vitest';
import { formatAired } from './catalog-format';

describe('formatAired', () => {
  it('shows as much as is known', () => {
    expect(formatAired(2021, 'spring')).toBe('Spring 2021');
    expect(formatAired(2021, null)).toBe('2021');
    expect(formatAired(null, 'fall')).toBe('Fall');
  });

  it('has nothing to show when both are blank', () => {
    expect(formatAired(null, null)).toBeNull();
  });
});
