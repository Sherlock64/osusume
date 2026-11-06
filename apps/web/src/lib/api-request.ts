import { errorResponseSchema } from '@osusume/shared';
import type { ClientResponse } from 'hono/client';
import type { SuccessStatusCode } from 'hono/utils/http-status';

const GENERIC_MESSAGE = 'Something went wrong. Please try again.';

/**
 * Every failed api or Better Auth call ends up as this. `code` is the api's stable error code, for
 * branching; `message` is fit to show. A request that never got an answer has status 0.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

/** Anything thrown while talking to the server, as an ApiError. */
export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  return new ApiError(0, 'network_error', 'Could not reach the server. Please try again.');
}

/** The api's answer for something that isn't there. A malformed id in the address gets a 400. */
export function isNotFoundError(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 404 || error.status === 400);
}

function fallbackError(status: number, message?: string): ApiError {
  if (status === 429) {
    return new ApiError(429, 'rate_limited', 'Too many attempts. Please wait and try again.');
  }
  return new ApiError(status, 'unknown_error', message ?? GENERIC_MESSAGE);
}

/** Reads the api's error envelope, tolerating a body that isn't one (a proxy's 502, say). */
export async function apiErrorFromResponse(response: {
  status: number;
  json(): Promise<unknown>;
}): Promise<ApiError> {
  const body: unknown = await response.json().catch(() => null);
  const parsed = errorResponseSchema.safeParse(body);
  if (!parsed.success) return fallbackError(response.status);
  return new ApiError(response.status, parsed.data.error.code, parsed.data.error.message);
}

/** The body type of a Hono client response's success statuses. */
type SuccessBody<R> =
  R extends ClientResponse<infer Body, infer Status> ?
    Status extends SuccessStatusCode ?
      Body
    : never
  : never;

/** Awaits a Hono client call: resolves to the success body, throws an ApiError otherwise. */
export async function request<R extends { ok: boolean; status: number; json(): Promise<unknown> }>(
  call: Promise<R>,
): Promise<SuccessBody<R>> {
  let response: R;
  try {
    response = await call;
  } catch (error) {
    throw toApiError(error);
  }
  if (!response.ok) throw await apiErrorFromResponse(response);
  if (response.status === 204) return undefined as SuccessBody<R>;
  return (await response.json()) as SuccessBody<R>;
}

interface AuthResult<T> {
  data: T;
  error: { status: number; code?: string | undefined; message?: string | undefined } | null;
}

/** Awaits a Better Auth client call, which reports failure in its result rather than throwing. */
export async function authRequest<T>(call: Promise<AuthResult<T>>): Promise<T> {
  let result: AuthResult<T>;
  try {
    result = await call;
  } catch (error) {
    throw toApiError(error);
  }
  if (!result.error) return result.data;
  const { status, code, message } = result.error;
  if (code === undefined) throw fallbackError(status, message);
  throw new ApiError(status, code, message ?? GENERIC_MESSAGE);
}

/**
 * The api reports a failed validation as one message, "field: problem; other: problem". Splits it
 * back up, for the rare case where the form's own check passed and the api's didn't.
 */
export function validationFieldErrors(error: ApiError): Record<string, string> {
  if (error.code !== 'validation_error') return {};
  const fields: Record<string, string> = {};
  for (const part of error.message.split('; ')) {
    const separator = part.indexOf(': ');
    if (separator > 0) fields[part.slice(0, separator)] ??= part.slice(separator + 2);
  }
  return fields;
}
