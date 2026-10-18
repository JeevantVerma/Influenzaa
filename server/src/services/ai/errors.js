export class AIError extends Error {
  constructor(message, { retryable = false, code = 'ai_error' } = {}) {
    super(message);
    this.name = 'AIError';
    this.retryable = retryable;
    this.code = code;
  }
}
