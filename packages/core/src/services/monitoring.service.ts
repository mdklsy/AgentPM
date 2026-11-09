import { parseProjectSettings } from '@agentpm/shared';
import type { Ctx } from '../ctx.js';
import { requireProjectMembership } from './project.service.js';

/**
 * 监控中心（M5）：项目健康度 + agent 信誉分。
 * 健康度是启发式评分（100 起扣分），与 avatar-worker 的规则引擎同一套口径。
 */
export interface HealthFactor {
  code: string;
  label: string;
  severity: 'HIGH' | 'MEDIUM' | 'LOW';
  detail: string;
  penalty: number;
}

export async function projectHealth(ctx: Ctx, projectKey: string) {
  const { project } = await requireProjectMembership(ctx, projectKey);
  const settings = parseProjectSettings(project.settings);
  const now = Date.now();
  const stallMs = settings.avatarPolicy.stallDays * 86_400_000;

  const [issues, pendingApprovals, agents] = await Promise.all([
    ctx.db.issue.findMany({
      where: { projectId: project.id },
      select: {
        issueKey: true,
        type: true,
        state: { select: { category: true } },
        dueDate: true,
        updatedAt: true,
        assignee: { select: { name: true } },
        closedAt: true,
        createdAt: true,
        reporterId: true,
      },
    }),
    ctx.db.approvalRequest.findMany({
      where: { projectId: project.id, status: 'PENDING' },
      select: { createdAt: true },
    }),
    ctx.db.member.findMany({
      where: { projectId: project.id, actor: { type: { in: ['AGENT', 'AVATAR'] } } },
      include: {
        actor: {
          select: {
            id: true,
            name: true,
            displayName: true,
            type: true,
            agentProfile: { select: { status: true, lastHeartbeatAt: true, ownerId: true } },
          },
        },
      },
    }),
  ]);

  const open = issues.filter((i) => i.state.category !== 'DONE');
  const overdue = open.filter((i) => i.dueDate && i.dueDate.getTime() < now);
  const stalled = open.filter(
    (i) => i.state.category === 'IN_PROGRESS' && now - i.updatedAt.getTime() > stallMs,
  );
  const agedApprovals = pendingApprovals.filter((a) => now - a.createdAt.getTime() > 86_400_000);
  const silentAgents = agents.filter(
    (m) =>
      m.actor.agentProfile &&
      open.some((i) => i.assignee?.name === m.actor.name) &&
      (!m.actor.agentProfile.lastHeartbeatAt ||
        now - m.actor.agentProfile.lastHeartbeatAt.getTime() > 30 * 60_000),
  );

  const factors: HealthFactor[] = [];
  if (overdue.length)
    factors.push({
      code: 'OVERDUE',
      label: '逾期任务',
      severity: overdue.length > 3 ? 'HIGH' : 'MEDIUM',
      detail: `${overdue.length} 个 issue 已过截止日（如 ${overdue
        .slice(0, 3)
        .map((i) => i.issueKey)
        .join('、')}）`,
      penalty: Math.min(30, overdue.length * 8),
    });
  if (stalled.length)
    factors.push({
      code: 'STALLED',
      label: '任务停滞',
      severity: stalled.length > 3 ? 'HIGH' : 'MEDIUM',
      detail: `${stalled.length} 个进行中任务超过 ${settings.avatarPolicy.stallDays} 天无更新`,
      penalty: Math.min(24, stalled.length * 6),
    });
  if (agedApprovals.length)
    factors.push({
      code: 'APPROVAL_AGING',
      label: '审批积压',
      severity: 'LOW',
      detail: `${agedApprovals.length} 个审批等待超过 24 小时`,
      penalty: Math.min(15, agedApprovals.length * 5),
    });
  if (silentAgents.length)
    factors.push({
      code: 'AGENT_SILENT',
      label: 'agent 失联',
      severity: 'MEDIUM',
      detail: `${silentAgents.map((m) => m.actor.name).join('、')} 持有任务但心跳超 30 分钟`,
      penalty: Math.min(12, silentAgents.length * 4),
    });

  const score = Math.max(20, 100 - factors.reduce((s, f) => s + f.penalty, 0));

  // agent 信誉分（v1 口径：bug 解决率 + 任务完成率 + 活跃度）
  const reputations = agents
    .filter((m) => m.actor.type === 'AGENT')
    .map((m) => {
      const filed = issues.filter((i) => i.type === 'BUG' && i.reporterId === m.actor.id);
      const resolved = filed.filter((i) => i.closedAt);
      const claimed = open.filter((i) => i.assignee?.name === m.actor.name);
      const doneByAgent = issues.filter((i) => i.closedAt && i.assignee?.name === m.actor.name);
      return {
        name: m.actor.name,
        displayName: m.actor.displayName,
        status: m.actor.agentProfile?.status ?? 'unknown',
        lastHeartbeatAt: m.actor.agentProfile?.lastHeartbeatAt ?? null,
        bugsFiled: filed.length,
        bugsResolved: resolved.length,
        bugAcceptanceRate: filed.length ? Math.round((resolved.length / filed.length) * 100) : null,
        activeIssues: claimed.length,
        completedIssues: doneByAgent.length,
      };
    });

  return {
    project: project.key,
    score,
    grade: score >= 90 ? 'A' : score >= 75 ? 'B' : score >= 60 ? 'C' : 'D',
    factors,
    avatars: agents
      .filter((m) => m.actor.type === 'AVATAR')
      .map((m) => ({
        name: m.actor.name,
        status: m.actor.agentProfile?.status ?? 'unknown',
        lastHeartbeatAt: m.actor.agentProfile?.lastHeartbeatAt ?? null,
      })),
    agentReputations: reputations,
  };
}
