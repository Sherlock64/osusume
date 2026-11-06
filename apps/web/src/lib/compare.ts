import {
  COMPARE_USERS_MAX,
  parseCompareUsernames,
  usernameKey,
  type CompareResponse,
  type CompareRow,
} from '@osusume/shared';

/** The people chosen so far plus what was typed, ignoring repeats and anyone past the limit. */
export function addCompareNames(current: readonly string[], input: string): string[] {
  const names = [...current];
  const seen = new Set(current.map(usernameKey));
  for (const name of parseCompareUsernames(input)) {
    if (names.length >= COMPARE_USERS_MAX) break;
    if (seen.has(usernameKey(name))) continue;
    seen.add(usernameKey(name));
    names.push(name);
  }
  return names;
}

export function removeCompareName(current: readonly string[], name: string): string[] {
  return current.filter((other) => usernameKey(other) !== usernameKey(name));
}

/** Whether the api said it can't show this person's list. */
export function isUnavailable(users: CompareResponse['users'], name: string): boolean {
  return users.some(
    (user) => !user.available && usernameKey(user.username) === usernameKey(name),
  );
}

export interface CompareGroup {
  id: 'onAll' | 'onSome' | 'onOne';
  title: string;
  rows: CompareRow[];
  /** Whether each row should say who has the season, which "on all" makes needless. */
  showsWho: boolean;
}

/** The three groups to draw. Empty when there are too few visible lists to compare. */
export function compareGroups(comparison: CompareResponse['comparison']): CompareGroup[] {
  if (comparison === null) return [];
  return [
    { id: 'onAll', title: 'On all lists', rows: comparison.onAll, showsWho: false },
    { id: 'onSome', title: 'On some lists', rows: comparison.onSome, showsWho: true },
    { id: 'onOne', title: 'On only one list', rows: comparison.onOne, showsWho: true },
  ];
}
