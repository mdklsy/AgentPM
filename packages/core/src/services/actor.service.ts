import { AppError, type CreateAgentInput, type HeartbeatInput } from '@agentpm/shared';
import { generateApiToken, hashApiToken, tokenDisplayPrefix } from '@agentpm/shared/node';
import type { Ctx } from '../ctx.js';

/** 创建 agent（含首个 token 签发，明文仅此一次返回）。owner = 当前用户。 */
export async function createAgent(ctx: Ctx, input: CreateAgentInput) {
  if (!ctx.actorId) throw AppError.unauthorized();
  const exists = await ctx.db.actor.findUnique({ where: { name: input.name } });
  if (exists) throw AppError.conflict(`名字已被占用：${input.name}`, 'ACTOR_NAME_TAKEN');

  const agent = await ctx.db.actor.create({
    data: {
      type: 'AGENT',
      name: input.name,
      displayName: input.displayName ?? input.name,
      agentProfile: {
        create: {
          ownerId: ctx.actorId,
          description: input.description,
          model: input.model,
          capabilities: input.capabilities,
        },
      },
    },
    include: { agentProfile: true },
  });

  const raw = generateApiToken();
  await ctx.db.apiToken.create({
    data: {
      actorId: agent.id,
      name: input.tokenName ?? 'default',
      prefix: tokenDisplayPrefix(raw),
      tokenHash: hashApiToken(raw),
      scopes: ['read', 'write', 'mcp'],
    },
  });
  return { agent, token: raw };
}

export async function listAgents(ctx: Ctx) {
  return ctx.db.actor.findMany({
    where: { type: 'AGENT' },
    include: {
      agentProfile: {
        include: { owner: { select: { name: true, displayName: true } } },
      },
    },
    orderBy: { createdAt: 'desc' },
  });
}

/** agent 心跳：刷新 lastHeartbeatAt，可携带状态与当前任务。 */
export async function heartbeat(ctx: Ctx, input: HeartbeatInput) {
  if (!ctx.actorId) throw AppError.unauthorized();
  const agent = await ctx.db.actor.findUnique({
    where: { id: ctx.actorId },
    include: { agentProfile: true },
  });
  if (!agent || agent.type === 'HUMAN' || !agent.agentProfile) {
    throw AppError.badRequest('heartbeat 仅限 AGENT / AVATAR 身份调用', 'NOT_AN_AGENT');
  }

  // 校验 currentIssueKeys 确实领取中（顺带防 agent 状态漂移）
  const claimed = input.currentIssueKeys?.length
    ? await ctx.db.issue.findMany({
        where: { issueKey: { in: input.currentIssueKeys }, assigneeId: agent.id },
        select: {
          issueKey: true,
          type: true,
          state: { select: { name: true, category: true } },
          title: true,
        },
      })
    : [];

  await ctx.db.agentProfile.update({
    where: { actorId: agent.id },
    data: {
      lastHeartbeatAt: new Date(),
      ...(input.status ? { status: input.status } : {}),
      config: {
        currentIssueKeys: claimed.map((i) => i.issueKey),
        heartbeatStatus: input.status ?? 'active',
      },
    },
  });
  return { agent: agent.name, lastHeartbeatAt: new Date(), confirmedIssues: claimed };
}

export async function getActorByName(ctx: Ctx, name: string) {
  return ctx.db.actor.findUnique({ where: { name } });
}
