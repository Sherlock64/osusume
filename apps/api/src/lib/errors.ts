/** An error with a stable code that the api reports to clients as-is. */
export class ApiError extends Error {
  override name = 'ApiError';
  readonly status: 400 | 401 | 403 | 404 | 409 | 422;
  readonly code: string;

  constructor(status: ApiError['status'], code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
