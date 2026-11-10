import type { FastifyBaseLogger, FastifyInstance } from 'fastify';
import type { PrismaClient } from '@agentpm/db';
import '@fastify/jwt';

declare module 'fastify' {
  interface FastifyInstance {
    db: PrismaClient;
    config: {
      mcpRateLimitPerMin: number;
      fulltextEnabled: boolean;
      attachmentsDir: string;
      appUrl: string;
      smtp: { host?: string; port: number; user?: string; pass?: string; from?: string };
    };
  }
}

export type FastifyApp = FastifyInstance & {
  db: PrismaClient;
  config: {
    mcpRateLimitPerMin: number;
    fulltextEnabled: boolean;
    attachmentsDir: string;
    appUrl: string;
    smtp: { host?: string; port: number; user?: string; pass?: string; from?: string };
  };
  log: FastifyBaseLogger;
};
