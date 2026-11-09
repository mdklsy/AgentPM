import { AppError, parseProjectSettings, type RegressionSubmitInput } from '@agentpm/shared';
import type { Ctx } from '../ctx.js';
import { writeActivity } from './activity.service.js';
import { fileBugInternal, type BugReportResult } from './bug.service.js';
import { requireProjectMembership } from './project.service.js';

/**
 * 提交回归结果矩阵：
 * - 记录 RegressionRun + 全量用例结果；
 * - 失败用例按策略自动建 bug（指纹去重；fingerprint 缺省用 suite::caseName）；
 * - bugCreate=approval 的项目不自动建单，把失败清单返回给 agent 自行走 bug.report（其本身受策略约束）。
 */
export async function submitRegression(ctx: Ctx, projectKey: string, input: RegressionSubmitInput) {
  const { project, member } = await requireProjectMembership(ctx, projectKey, 'MEMBER');
  const settings = parseProjectSettings(project.settings);

  const counts = {
    total: input.results.length,
    passed: input.results.filter((r) => r.status === 'PASS').length,
    failed: input.results.filter((r) => r.status === 'FAIL').length,
    errors: input.results.filter((r) => r.status === 'ERROR').length,
    skipped: input.results.filter((r) => r.status === 'SKIP').length,
  };

  const failing = input.results.filter((r) => r.status === 'FAIL' || r.status === 'ERROR');

  const run = await ctx.db.$transaction(async (tx) => {
    const created = await tx.regressionRun.create({
      data: {
        projectId: project.id,
        suite: input.suite,
        branch: input.branch,
        commitSha: input.commitSha,
        triggeredById: ctx.actorId!,
        status: counts.failed + counts.errors > 0 ? 'FAILED' : 'PASSED',
        ...counts,
        durationMs: input.durationMs,
        summary: { failing: failing.map((f) => f.name).slice(0, 50) },
      },
    });
    for (const r of input.results) {
      await tx.testCaseResult.create({
        data: {
          runId: created.id,
          name: r.name,
          className: r.className,
          status: r.status,
          durationMs: r.durationMs,
          message: r.message,
          fingerprint: r.fingerprint,
        },
      });
    }
    return created;
  });

  const autoFile =
    settings.agentPolicy.autoFileRegressionBugs &&
    !(
      settings.agentPolicy.bugCreate === 'approval' &&
      (ctx.actorType === 'AGENT' || ctx.actorType === 'AVATAR')
    );

  const filedBugs: Array<{ caseName: string } & BugReportResult> = [];
  if (autoFile && failing.length) {
    for (const f of failing) {
      const result = await fileBugInternal(
        ctx,
        project.id,
        projectKey,
        {
          title: `[regression] ${f.name}${f.className ? ` · ${f.className}` : ''}`,
          description: [
            f.message ? `失败信息：\n\`\`\`\n${f.message.slice(0, 4000)}\n\`\`\`` : null,
            `来源：回归套件 \`${input.suite}\`，运行 ${run.id.slice(-8)}，分支 ${input.branch ?? '-'}`,
          ]
            .filter(Boolean)
            .join('\n\n'),
          severity: 'P2',
          evidence: { regressionRunId: run.id, suite: input.suite, status: f.status },
          fingerprint:
            f.fingerprint ?? `reg:${input.suite}:${f.className ? f.className + '#' : ''}${f.name}`,
          environment: input.branch ?? undefined,
          labelNames: ['bug'],
        },
        !!member,
      );
      filedBugs.push({ caseName: f.name, ...result });
    }
  }

  await writeActivity(ctx, {
    projectId: project.id,
    action: 'regression.submitted',
    summary: `回归 ${input.suite}：${counts.passed}/${counts.total} 通过${
      filedBugs.length
        ? `，自动建单 ${filedBugs.filter((b) => b.status === 'created').length} 个`
        : ''
    }`,
    detail: {
      runId: run.id,
      ...counts,
      autoFiled: filedBugs.filter((b) => b.status === 'created').length,
    },
  });

  return {
    runId: run.id,
    suite: input.suite,
    status: run.status,
    counts,
    autoFilePolicy: autoFile ? 'enabled' : 'disabled',
    filedBugs: filedBugs.map((b) => ({
      caseName: b.caseName,
      status: b.status,
      issueKey: b.issue?.issueKey ?? b.duplicateOf ?? null,
      message: b.message,
    })),
    note: autoFile
      ? undefined
      : '未自动建单（策略关闭或需审批）：失败用例清单见 counts.failing 详情，请通过 bug.report 提交',
  };
}

export async function listRuns(ctx: Ctx, projectKey: string, limit = 20) {
  const { project } = await requireProjectMembership(ctx, projectKey);
  return ctx.db.regressionRun.findMany({
    where: { projectId: project.id },
    orderBy: { finishedAt: 'desc' },
    take: Math.min(limit, 100),
    include: { triggeredBy: { select: { name: true, type: true } } },
  });
}

export async function getRun(ctx: Ctx, projectKey: string, runId: string) {
  const { project } = await requireProjectMembership(ctx, projectKey);
  const run = await ctx.db.regressionRun.findFirst({
    where: { id: runId, projectId: project.id },
    include: {
      triggeredBy: { select: { name: true, type: true } },
      cases: { orderBy: [{ status: 'desc' }, { name: 'asc' }] },
    },
  });
  if (!run) throw AppError.notFound('回归运行不存在', 'RUN_NOT_FOUND');
  return run;
}
