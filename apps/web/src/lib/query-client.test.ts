import { describe, expect, it, vi } from 'vitest';
import { ApiError } from './api-request.ts';
import { createQueryClient } from './query-client.ts';

describe('createQueryClient', () => {
  it('reports a lost session from a query or a mutation', async () => {
    const onUnauthenticated = vi.fn();
    const client = createQueryClient(onUnauthenticated);
    const fail = () => Promise.reject(new ApiError(401, 'unauthenticated', 'Log in to continue.'));

    await expect(client.query({ queryKey: ['a'], queryFn: fail })).rejects.toThrow();
    expect(onUnauthenticated).toHaveBeenCalledTimes(1);

    const mutation = client.getMutationCache().build(client, { mutationFn: fail });
    await expect(mutation.execute(undefined)).rejects.toThrow();
    expect(onUnauthenticated).toHaveBeenCalledTimes(2);
  });

  it('ignores other failures', async () => {
    const onUnauthenticated = vi.fn();
    const client = createQueryClient(onUnauthenticated);
    const fail = () => Promise.reject(new ApiError(403, 'invalid_password', 'Wrong.'));
    await expect(client.query({ queryKey: ['a'], queryFn: fail })).rejects.toThrow();
    expect(onUnauthenticated).not.toHaveBeenCalled();
  });
});
