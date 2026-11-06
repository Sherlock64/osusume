import { COMPARE_USERS_MAX } from '@osusume/shared';
import { describe, expect, it } from 'vitest';
import { addCompareNames, compareGroups, isUnavailable, removeCompareName } from './compare';

describe('addCompareNames', () => {
  it('adds a typed name, ignoring repeats whatever their case', () => {
    expect(addCompareNames(['Ann'], ' bob ')).toEqual(['Ann', 'bob']);
    expect(addCompareNames(['Ann'], 'ANN')).toEqual(['Ann']);
  });

  it('ignores blanks and stops at the limit', () => {
    expect(addCompareNames(['Ann'], '  ')).toEqual(['Ann']);
    const full = Array.from({ length: COMPARE_USERS_MAX }, (_, index) => `user${String(index)}`);
    expect(addCompareNames(full, 'late')).toEqual(full);
  });
});

describe('removeCompareName', () => {
  it('removes the name whatever its case, including the viewer', () => {
    expect(removeCompareName(['Ann', 'bob'], 'ann')).toEqual(['bob']);
  });
});

describe('isUnavailable', () => {
  const users = [
    { username: 'Ann', available: true },
    { username: 'ghost', available: false },
  ];

  it('reads the answer ignoring case', () => {
    expect(isUnavailable(users, 'GHOST')).toBe(true);
    expect(isUnavailable(users, 'ann')).toBe(false);
  });

  it('says nothing about a name the answer does not hold yet', () => {
    expect(isUnavailable(users, 'new')).toBe(false);
  });
});

describe('compareGroups', () => {
  it('has no groups when there is nothing to compare', () => {
    expect(compareGroups(null)).toEqual([]);
  });

  it('keeps the three groups in order, empty or not, showing who except on all', () => {
    const groups = compareGroups({ onAll: [], onSome: [], onOne: [] });
    expect(groups.map(({ id, showsWho }) => [id, showsWho])).toEqual([
      ['onAll', false],
      ['onSome', true],
      ['onOne', true],
    ]);
  });
});
