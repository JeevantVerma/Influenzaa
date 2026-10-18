export class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message, details) => new AppError(400, 'bad_request', message, details);
export const validationError = (details) => new AppError(422, 'validation_failed', 'Request validation failed', details);
export const unauthorized = (message = 'Authentication required') => new AppError(401, 'unauthorized', message);
export const forbidden = (message = 'You do not have access to this resource') => new AppError(403, 'forbidden', message);
export const notFound = (what = 'Resource') => new AppError(404, 'not_found', `${what} not found`);
export const conflict = (message, details) => new AppError(409, 'conflict', message, details);
export const tooMany = (message = 'Too many requests') => new AppError(429, 'rate_limited', message);
export const unavailable = (message, details) => new AppError(503, 'unavailable', message, details);
export const policyBlocked = (message, details) => new AppError(403, 'policy_blocked', message, details);
