/**
 * 统一业务错误。REST 层与 MCP 层都把它映射为各自协议的错误语义
 * （HTTP 状态码 + code / JSON-RPC error），不要在业务代码里裸抛字符串。
 */
export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }

  static badRequest(message: string, code = 'BAD_REQUEST', details?: unknown) {
    return new AppError(400, code, message, details);
  }
  static unauthorized(message = 'Authentication required', code = 'UNAUTHORIZED') {
    return new AppError(401, code, message);
  }
  static forbidden(message = 'You do not have permission to do this', code = 'FORBIDDEN') {
    return new AppError(403, code, message);
  }
  static notFound(message = 'Resource not found', code = 'NOT_FOUND') {
    return new AppError(404, code, message);
  }
  static conflict(message: string, code = 'CONFLICT', details?: unknown) {
    return new AppError(409, code, message, details);
  }
  static tooMany(message = 'Rate limit exceeded', code = 'RATE_LIMITED') {
    return new AppError(429, code, message);
  }
  static internal(message = 'Internal server error', code = 'INTERNAL') {
    return new AppError(500, code, message);
  }
}

export function isAppError(e: unknown): e is AppError {
  return e instanceof AppError;
}
