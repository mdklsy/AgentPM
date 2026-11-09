import { AppError, parseProjectSettings } from '@agentpm/shared';
import {
  createReport,
  getCurrentSprint,
  listApprovals,
  listReports,
  projectStats,
  requireProjectMembership,
  searchIssues,
  sprintBurndown,
} from '@agentpm/core';
import { computeInsights, type SnapshotInput } from '#worker/analysis.js';
import { renderReport } from '#worker/report-render.js';
import { requireAuth } from '../plugins/auth.js';
import { makeCtx } from '../ctx.js';
import type { FastifyApp } from '../types.js';

/**
 * PM 替身「立即巡检」（M5.5）：在 API 进程内跑规则引擎并发布报告，
 * 让替身在纯页面操作下即可用（创建 → 立即巡检 → 看报告）；定时自动巡检仍由 avatar-worker 承担。
 * 手动巡检必产出报告：有非低危风险 → RISK_ALERT，否则 DAILY_DIGEST（引擎：规则，不做 LLM 增强）。
 */
export function registerAvatarRoutes(app: FastifyApp) {
  app.post('/v1/projects/:key/avatar/inspect', async (req, reply) => {
    requireAuth(req, 'write');
    const { key } = req.params as { key: string };
    const ctx = makeCtx(app, req);
    const { project } = await requireProjectMembership(ctx, key, 'MEMBER');

    const avatar = await ctx.db.member.findFirst({
      where: { projectId: project.id, actor: { type: 'AVATAR' } },
      select: { actor: { select: { id: true, name: true } } },
    });
    if (!avatar)
      throw AppError.badRequest('NO_AVATAR', '项目里还没有 PM 替身，请先在监控页创建');

    const policy = parseProjectSettings(project.settings).avatarPolicy;
    const now = new Date();

    const [stats, issuesResp, approvals, sprint, lastReports] = await Promise.all([
      projectStats(ctx, key),
      searchIssues(ctx, key, { page: 1, pageSize: 100, sort: 'updated_desc' }),
      listApprovals(ctx, key, { status: 'PENDING' }),
      getCurrentSprint(ctx, key),
      listReports(ctx, key, 1),
    ]);

    let burndownTail: SnapshotInput['burndownTail'] = null;
    if (sprint) {
      const bd = await sprintBurndown(ctx, key, sprint.id).catch(() => null);
      burndownTail = bd ? bd.points.slice(-3) : null;
    }

    const insights = computeInsights({
      projectKey: key,
      projectName: project.name,
      stats,
      issues: issuesResp.items,
      burndownTail,
      pendingApprovals: approvals,
      policy,
      now,
    });

    const kind = insights.risks.some((r) => r.severity !== 'LOW') ? 'RISK_ALERT' : 'DAILY_DIGEST';
    const rendered = renderReport({
      projectName: project.name,
      kind,
      insights,
      llm: null,
      window: {
        from: new Date(now.getTime() - 7 * 86_400_000).toISOString(),
        to: now.toISOString(),
      },
      avatarName: avatar.actor.name,
      engine: 'rules',
    });

    // 以替身身份发布（作者=替身，走审计/通知/webhook；审计 detail 记录触发者）
    const report = await createReport(
      {
        ...ctx,
        actorId: avatar.actor.id,
        actorType: 'AVATAR',
        actorName: avatar.actor.name,
        source: 'SYSTEM',
        apiTokenId: undefined,
        ip: undefined,
        userAgent: undefined,
      },
      key,
      { kind, title: rendered.title, content: rendered.content, data: { insights, policy } },
      { via: `手动巡检（触发者 ${ctx.actorName ?? '未知'}）` },
    );
    return reply.status(201).send({
      report: { id: report.id, kind, title: rendered.title, risks: insights.risks.length },
      action: kind === 'RISK_ALERT' ? 'alert' : 'digest',
    });
  });
}
