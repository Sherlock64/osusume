import { describe, expect, it } from 'vitest';
import { ApiError, authRequest, request, validationFieldErrors } from './api-request.ts';

function json(status: number, body: unknown) {
  return Promise.resolve(new Response(JSON.stringify(body), { status }));
}

describe('request', () => {
  it('returns the body of a success', async () => {
    await expect(request(json(200, { open: true }))).resolves.toEqual({ open: true });
  });

  it('returns nothing for a 204', async () => {
    const response = Promise.resolve(new Response(null, { status: 204 }));
    await expect(request(response)).resolves.toBeUndefined();
  });

  it("surfaces the api's code and message", async () => {
    const error = { error: { code: 'username_taken', message: 'This username is taken.' } };
    await expect(request(json(409, error))).rejects.toMatchObject({
      status: 409,
      code: 'username_taken',
      message: 'This username is taken.',
    });
  });

  it('copes with a body that is not the error envelope', async () => {
    const response = Promise.resolve(new Response('<html>Bad gateway</html>', { status: 502 }));
    await expect(request(response)).rejects.toMatchObject({ status: 502, code: 'unknown_error' });
  });

  it('reports a request that got no answer as status 0', async () => {
    const failed = Promise.reject<Response>(new TypeError('Failed to fetch'));
    await expect(request(failed)).rejects.toMatchObject({ status: 0, code: 'network_error' });
  });
});

describe('authRequest', () => {
  it('returns the data of a success', async () => {
    await expect(authRequest(Promise.resolve({ data: 1, error: null }))).resolves.toBe(1);
  });

  it("surfaces Better Auth's code", async () => {
    const error = { status: 401, code: 'INVALID_USERNAME_OR_PASSWORD', message: 'Invalid' };
    await expect(authRequest(Promise.resolve({ data: null, error }))).rejects.toMatchObject({
      status: 401,
      code: 'INVALID_USERNAME_OR_PASSWORD',
    });
  });

  it('names a rate limit, which comes with no code', async () => {
    const error = { status: 429, message: 'Too many requests.' };
    await expect(authRequest(Promise.resolve({ data: null, error }))).rejects.toMatchObject({
      status: 429,
      code: 'rate_limited',
    });
  });
});

describe('validationFieldErrors', () => {
  it('splits the message by field, keeping the first per field', () => {
    const message = 'username: Bad; password: Short; username: Worse';
    const error = new ApiError(400, 'validation_error', message);
    expect(validationFieldErrors(error)).toEqual({ username: 'Bad', password: 'Short' });
  });

  it('ignores other errors', () => {
    expect(validationFieldErrors(new ApiError(409, 'taken', 'a: b'))).toEqual({});
  });
});
