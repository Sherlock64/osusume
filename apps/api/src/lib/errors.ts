/** An error with a stable code that the api reports to clients as-is. */
export class ApiError extends Error {
  override name = 'ApiError';
  readonly status: 400 | 401 | 403 | 404 | 409 | 422 | 503;
  readonly code: string;

  constructor(status: ApiError['status'], code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const UNIQUE_VIOLATION = '23505';

/** Whether a failed query broke a unique constraint or index, optionally a specific one. */
export function isUniqueViolation(error: unknown, constraint?: string): boolean {
  if (!(error instanceof Error) || !(error.cause instanceof Error)) return false;
  const cause = error.cause as Error & { code?: string; constraint?: string };
  return (
    cause.code === UNIQUE_VIOLATION && (constraint === undefined || cause.constraint === constraint)
  );
}
