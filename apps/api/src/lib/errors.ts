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
// Postgres reports ON DELETE RESTRICT as either, depending on the version.
const FOREIGN_KEY_VIOLATIONS = ['23503', '23001'];

/** Whether a failed query broke a unique constraint or index, optionally a specific one. */
export function isUniqueViolation(error: unknown, constraint?: string): boolean {
  if (!(error instanceof Error) || !(error.cause instanceof Error)) return false;
  const cause = error.cause as Error & { code?: string; constraint?: string };
  return (
    cause.code === UNIQUE_VIOLATION && (constraint === undefined || cause.constraint === constraint)
  );
}

/** Whether a failed query broke a foreign key, optionally a specific one. */
export function isForeignKeyViolation(error: unknown, constraint?: string): boolean {
  if (!(error instanceof Error) || !(error.cause instanceof Error)) return false;
  const cause = error.cause as Error & { code?: string; constraint?: string };
  return (
    cause.code !== undefined &&
    FOREIGN_KEY_VIOLATIONS.includes(cause.code) &&
    (constraint === undefined || cause.constraint === constraint)
  );
}
