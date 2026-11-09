import type { FastifyError, FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { AppError, isAppError } from '@agentpm/shared';

/** 统一错误 → HTTP（AppError 携带机器可读 code；zod 校验错误 → 400 VALIDATION）。 */
export function registerErrorHandler(app: FastifyInstance) {
  app.setErrorHandler((err: FastifyError | AppError | ZodError | Error, req, reply) => {
    if (isAppError(err)) {
      return reply.status(err.statusCode).send({
        error: { code: err.code, message: err.message, details: err.details ?? null },
      });
    }
    if (err instanceof ZodError) {
      return reply.status(400).send({
        error: {
          code: 'VALIDATION',
          message: '参数校验失败',
          details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        },
      });
    }
    // fastify 自带的 body 解析 / ajv 校验错误
    const anyErr = err as FastifyError;
    if (anyErr.validation) {
      return reply.status(400).send({
        error: { code: 'VALIDATION', message: anyErr.message, details: anyErr.validation },
      });
    }
    req.log.error(err);
    const status = anyErr.statusCode && anyErr.statusCode >= 400 ? anyErr.statusCode : 500;
    return reply.status(status).send({
      error: { code: 'INTERNAL', message: 'Internal server error' },
    });
  });

  app.setNotFoundHandler((_req, reply) => {
    reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Route not found' } });
  });
}

export { AppError };
