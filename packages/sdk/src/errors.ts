/**
 * Something ouicu refused or that went wrong, in words for a person.
 *
 * `status` is the HTTP status ouicu answered with: 401 the key does not
 * work (or there is none), 403 the plan does not allow it, the account is
 * suspended or its email is not confirmed, 404 not found, 409 a name is
 * taken, 410 gone, 413 too large, 429 too many at once or over the month's
 * data. It is 0 when ouicu never answered: no connection, a folder that
 * cannot be read, or the CLI failing.
 */
export class OuicuError extends Error {
  readonly status: number;

  constructor(status: number, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "OuicuError";
    this.status = status;
  }
}
