import type { FastifyBaseLogger, FastifyInstance } from 'fastify';
import type { PrismaClient } from '@agentpm/db';
import '@fastify/jwt';

declare module 'fastify' {
  interface FastifyInstance {
    db: PrismaClient;
    config: {
      mcpRateLimitPerMin: number;
      fulltextEnabled: boolean;
    };
  }
}

export type FastifyApp = FastifyInstance & {
  db: PrismaClient;
  config: { mcpRateLimitPerMin: number; fulltextEnabled: boolean };
  log: FastifyBaseLogger;
};
