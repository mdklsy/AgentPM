import { PrismaClient } from '@prisma/client';

export * from '@prisma/client';
export * from './workflows.js';

export type DB = PrismaClient;

/** 创建新的 PrismaClient（测试/多库场景）；应用主流程请用 getPrisma() 单例。 */
export function createPrisma(datasourceUrl?: string): PrismaClient {
  return new PrismaClient(datasourceUrl ? { datasourceUrl } : undefined);
}

let singleton: PrismaClient | undefined;

/** 进程级单例。默认读 DATABASE_URL，可显式传入连接串。 */
export function getPrisma(datasourceUrl?: string): PrismaClient {
  if (!datasourceUrl && singleton) return singleton;
  const client = createPrisma(datasourceUrl);
  if (!datasourceUrl) singleton = client;
  return client;
}
