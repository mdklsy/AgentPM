import type { PrismaClient } from '@agentpm/db';
import type { ActorType, ActivitySource, MemberRole } from '@agentpm/shared';

/**
 * 服务调用上下文：一切服务函数的第一个参数。
 * 审计是领域逻辑的一部分（ADR 0004）：Ctx 携带来源信息，由服务层统一落 Activity。
 */
export interface Ctx {
  db: PrismaClient;
  /** 已认证的执行者；SYSTEM 代执行（如审批通过后代为流转）时可为空 */
  actorId?: string;
  actorType?: ActorType;
  actorName?: string;
  apiTokenId?: string;
  source: ActivitySource;
  ip?: string;
  userAgent?: string;
  /** source=MCP 时记录的工具名 */
  mcpTool?: string;
  /** 实例对外地址（M6）：通知邮件里的链接用它拼 */
  appUrl?: string;
}

/** 角色等级：VIEWER < AGENT/MEMBER < ADMIN < OWNER */
const ROLE_RANK: Record<MemberRole, number> = {
  VIEWER: 0,
  AGENT: 1,
  MEMBER: 1,
  ADMIN: 2,
  OWNER: 3,
};

export function roleAtLeast(role: MemberRole, min: MemberRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[min];
}

export function systemCtx(db: PrismaClient): Ctx {
  return { db, source: 'SYSTEM' };
}
