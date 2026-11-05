import { describe, expect, it } from 'vitest';
import { emailSchema, passwordSchema, usernameKey, usernameSchema } from './accounts.ts';

describe('usernameSchema', () => {
  it('keeps the capitalization entered', () => {
    expect(usernameSchema.parse('Mixed_Case.1')).toBe('Mixed_Case.1');
    expect(usernameKey('Mixed_Case.1')).toBe('mixed_case.1');
  });

  it.each(['ab', 'a'.repeat(31), 'has space', 'comma,name', 'slash/name', 'ünicode'])(
    'refuses %s',
    (value) => {
      expect(usernameSchema.safeParse(value).success).toBe(false);
    },
  );
});

describe('emailSchema', () => {
  it('trims and lowercases', () => {
    expect(emailSchema.parse('  Someone@Example.Test ')).toBe('someone@example.test');
  });

  it.each(['', 'nope', 'a@', `${'a'.repeat(250)}@example.test`])('refuses %s', (value) => {
    expect(emailSchema.safeParse(value).success).toBe(false);
  });
});

describe('passwordSchema', () => {
  it('holds to the length limits', () => {
    expect(passwordSchema.safeParse('1234567').success).toBe(false);
    expect(passwordSchema.safeParse('12345678').success).toBe(true);
    expect(passwordSchema.safeParse('a'.repeat(129)).success).toBe(false);
  });
});
