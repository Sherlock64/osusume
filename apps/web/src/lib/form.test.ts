import { setupRequestSchema } from '@osusume/shared';
import { describe, expect, it } from 'vitest';
import { ApiError } from './api-request.ts';
import { submitErrors, validate } from './form.ts';

describe('validate', () => {
  it('reports each field once, in words for people', () => {
    const result = validate(setupRequestSchema, { username: 'a', email: 'nope', password: 'short' });
    expect(result).toEqual({
      errors: {
        form: null,
        fields: {
          username: 'Must be at least 3 characters.',
          email: 'Enter a valid email address.',
          password: 'Must be at least 12 characters.',
        },
      },
    });
  });

  it("keeps a schema's own message", () => {
    const result = validate(setupRequestSchema, {
      username: 'bad name',
      email: 'a@example.test',
      password: 'long-enough-password',
    });
    expect(result).toMatchObject({
      errors: { fields: { username: 'Use only letters, digits, underscores and dots.' } },
    });
  });

  it('returns the parsed values', () => {
    const result = validate(setupRequestSchema, {
      username: 'Admin',
      email: ' A@Example.test ',
      password: 'long-enough-password',
    });
    expect(result).toMatchObject({ data: { username: 'Admin', email: 'a@example.test' } });
  });
});

describe('submitErrors', () => {
  it('puts a mapped code on its field', () => {
    const error = new ApiError(409, 'username_taken', 'This username is taken.');
    expect(submitErrors(error, ['username'], { username_taken: 'username' })).toEqual({
      fields: { username: 'This username is taken.' },
      form: null,
    });
  });

  it('puts an api validation error on the fields the form has', () => {
    const error = new ApiError(400, 'validation_error', 'username: Bad');
    expect(submitErrors(error, ['username'])).toEqual({ fields: { username: 'Bad' }, form: null });
  });

  it('puts anything else on the form', () => {
    const notAField = new ApiError(400, 'validation_error', 'token: Bad');
    expect(submitErrors(notAField, ['username'])).toEqual({ fields: {}, form: 'token: Bad' });
    expect(submitErrors(new Error('boom'), [])).toMatchObject({
      form: 'Could not reach the server. Please try again.',
    });
  });
});
