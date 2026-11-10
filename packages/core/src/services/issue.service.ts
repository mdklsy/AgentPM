import { Prisma } from '@agentpm/db';
import { emitWebhook } from './webhook.service.js';
import { issueAudience, notify, projectAdmins } from './notification.service.js';
import {
  AppError,
  type ClaimIssueInput,
  type CreateIssueInput,
  type SearchIssuesQuery,
  type UpdateIssueInput,
  parseProjectSettings,
} from '@agentpm/shared';
import type { Ctx } from '../ctx.js';
import { writeActivity } from './activity.service.js';
import { requireProjectMembership } from './project.service.js';

const ISSUE_INCLUDE = {
  state: { select: { name: true, category: true } },
  assignee: { select: { name: true, displayName: true, type: true } },
  reporter: { select: { name: true, displayName: true, type: true } },
  labels: { include: { label: { select: { name: true, color: true } } } },
  parentIssue: { select: { issueKey: true, title: true } },
  sprint: { select: { id: true, name: true, status: true } },
  release: { select: { id: true, name: true, status: true } },
} satisfies Prisma.IssueInclude;

export type IssueDetail = Prisma.IssueGetPayload<{ include: typeof ISSUE_INCLUDE }>;

export function serializeIssue(i: IssueDetail) {
  return {
    issueKey: i.issueKey,
    type: i.type,
    title: i.title,
    description: i.description,
    state: i.state.name,
    stateCategory: i.state.category,
    priority: i.priority,
    assignee: i.assignee?.name ?? null,
    reporter: i.reporter.name,
    labels: i.labels.map((l) => l.label.name),
    parent: i.parentIssue?.issueKey ?? null,
    sprint: i.sprint ? { id: i.sprint.id, name: i.sprint.name } : null,
    release: i.release
      ? { id: i.release.id, name: i.release.name, status: i.release.status }
      : null,
    storyPoints: i.storyPoints,
    estimateMinutes: i.estimateMinutes,
    dueDate: i.dueDate,
    fingerprint: i.fingerprint,
    environment: i.environment,
    closedAt: i.closedAt,
    createdAt: i.createdAt,
    updatedAt: i.updatedAt,
  };
}

export async function getIssueOr404(ctx: Ctx, issueKey: string) {
  const issue = await ctx.db.issue.findUnique({ where: { issueKey }, include: ISSUE_INCLUDE });
  if (!issue) throw AppError.notFound(`issue 不存在：${issueKey}`, 'ISSUE_NOT_FOUND');
  return issue;
}

async function assertIssueAccess(
  ctx: Ctx,
  issueKey: string,
  minRole: 'VIEWER' | 'MEMBER' = 'VIEWER',
) {
  const issue = await getIssueOr404(ctx, issueKey);
  const project = await ctx.db.project.findUniqueOrThrow({
    where: { id: issue.projectId },
    select: { key: true },
  });
  await requireProjectMembership(ctx, project.key, minRole);
  return issue;
}

/** 原子发号 + 建 issue（事务内 SELECT ... FOR UPDATE 锁项目行）。 */
export async function createIssue(
  ctx: Ctx,
  projectKey: string,
  input: CreateIssueInput,
): Promise<IssueDetail> {
  const { project } = await requireProjectMembership(ctx, projectKey, 'MEMBER');

  const created = await ctx.db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{ numberSeq: number }>>(
      Prisma.sql`SELECT numberSeq FROM \`Project\` WHERE id = ${project.id} FOR UPDATE`,
    );
    const seq = (rows[0]?.numberSeq ?? 0) + 1;
    await tx.project.update({ where: { id: project.id }, data: { numberSeq: seq } });

    const workflow = await tx.workflow.findUnique({
      where: { projectId_issueType: { projectId: project.id, issueType: input.type } },
      include: { states: { where: { isInitial: true } } },
    });
    const initial = workflow?.states[0];
    if (!initial) throw AppError.internal(`项目缺少 ${input.type} 的工作流初始状态`);

    let parent: { id: string; issueKey: string } | null = null;
    if (input.parentIssueKey) {
      const p = await tx.issue.findUnique({ where: { issueKey: input.parentIssueKey } });
      if (!p || p.projectId !== project.id)
        throw AppError.badRequest(
          `父 issue 不存在或不属于本项目：${input.parentIssueKey}`,
          'PARENT_NOT_FOUND',
        );
      parent = { id: p.id, issueKey: p.issueKey };
    }

    let assigneeId: string | undefined;
    if (input.assigneeName) {
      const a = await tx.actor.findUnique({
        where: { name: input.assigneeName },
        select: { id: true },
      });
      if (!a) throw AppError.badRequest(`指派对象不存在：${input.assigneeName}`, 'ACTOR_NOT_FOUND');
      assigneeId = a.id;
    }

    let releaseId: string | undefined;
    if (input.releaseId) {
      const r = await tx.release.findFirst({
        where: { id: input.releaseId, projectId: project.id },
        select: { id: true },
      });
      if (!r) throw AppError.badRequest('版本不存在或不属于本项目', 'RELEASE_NOT_FOUND');
      releaseId = r.id;
    }

    const issue = await tx.issue.create({
      data: {
        projectId: project.id,
        number: seq,
        issueKey: `${project.key}-${seq}`,
        type: input.type,
        title: input.title,
        description: input.description,
        stateId: initial.id,
        priority: input.priority,
        assigneeId,
        reporterId: ctx.actorId!,
        createdById: ctx.actorId!,
        parentIssueId: parent?.id,
        storyPoints: input.storyPoints,
        dueDate: input.dueDate,
        sprintId: input.sprintId,
        fingerprint: input.fingerprint,
        environment: input.environment,
        releaseId,
        estimateMinutes: input.estimateMinutes,
      },
    });

    // 标签：不存在则顺手创建（保持零门槛用法）
    for (const name of input.labelNames) {
      const label = await tx.label.upsert({
        where: { projectId_name: { projectId: project.id, name } },
        create: { projectId: project.id, name },
        update: {},
      });
      await tx.issueLabel
        .create({ data: { issueId: issue.id, labelId: label.id } })
        .catch(() => {});
    }
    return issue;
  });

  await writeActivity(ctx, {
    projectId: project.id,
    issueId: created.id,
    action: 'issue.created',
    summary: `创建 ${created.issueKey}（${created.type}）${created.title}`,
    detail: { type: created.type, priority: created.priority, fingerprint: created.fingerprint },
  });
  emitWebhook(ctx, 'issue.created', {
    projectKey: project.key,
    issueKey: created.issueKey,
    type: created.type,
    title: created.title,
  });
  await notify(ctx, [created.assigneeId], 'issue.assigned', {
    projectKey: project.key,
    issueKey: created.issueKey,
    title: created.title,
  });
  return getIssueOr404(ctx, created.issueKey);
}

const SORT_MAP: Record<SearchIssuesQuery['sort'], Prisma.IssueOrderByWithRelationInput[]> = {
  created_desc: [{ createdAt: 'desc' }],
  created_asc: [{ createdAt: 'asc' }],
  updated_desc: [{ updatedAt: 'desc' }],
  updated_asc: [{ updatedAt: 'asc' }],
  priority_asc: [{ priority: 'asc' }, { createdAt: 'desc' }],
};

export async function searchIssues(ctx: Ctx, projectKey: string, query: SearchIssuesQuery) {
  const { project } = await requireProjectMembership(ctx, projectKey);

  const where: Prisma.IssueWhereInput = { projectId: project.id };
  if (query.type) {
    const types = query.type.split(',').map((s) => s.trim().toUpperCase());
    where.type = { in: types as CreateIssueInput['type'][] };
  }
  if (query.state) {
    const states = await ctx.db.workflowState.findMany({
      where: { workflow: { projectId: project.id }, name: query.state },
      select: { id: true },
    });
    where.stateId = { in: states.map((s) => s.id) };
  }
  if (query.stateCategory) where.state = { category: query.stateCategory };
  if (query.assignee === 'none') where.assigneeId = null;
  else if (query.assignee) where.assignee = { name: query.assignee };
  if (query.priority)
    where.priority = {
      in: query.priority
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean) as never,
    };
  if (query.reporter) where.reporter = { name: query.reporter };
  if (query.label) where.labels = { some: { label: { name: query.label } } };
  if (query.parent) where.parentIssue = { issueKey: query.parent };
  if (query.sprintId === 'none') where.sprintId = null;
  else if (query.sprintId) where.sprintId = query.sprintId;
  if (query.releaseId === 'none') where.releaseId = null;
  else if (query.releaseId) where.releaseId = query.releaseId;
  if (query.q) {
    const like = `%${query.q.replace(/[%_]/g, (m) => `\\${m}`)}%`;
    where.OR = [{ title: { contains: like } }, { description: { contains: like } }];
  }

  const [items, total] = await Promise.all([
    ctx.db.issue.findMany({
      where,
      orderBy: SORT_MAP[query.sort],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      include: ISSUE_INCLUDE,
    }),
    ctx.db.issue.count({ where }),
  ]);
  return {
    items: items.map(serializeIssue),
    total,
    page: query.page,
    pageSize: query.pageSize,
  };
}

export async function getIssue(ctx: Ctx, issueKey: string) {
  const issue = await assertIssueAccess(ctx, issueKey);
  const [comments, progressReports, links, attachments, fieldValues, worklogs] = await Promise.all([
    ctx.db.comment.findMany({
      where: { issueId: issue.id },
      orderBy: { createdAt: 'asc' },
      include: { author: { select: { name: true, displayName: true, type: true } } },
    }),
    ctx.db.progressReport.findMany({
      where: { issueId: issue.id },
      orderBy: { createdAt: 'desc' },
      take: 10,
      include: { actor: { select: { name: true, type: true } } },
    }),
    ctx.db.issueLink.findMany({
      where: { OR: [{ fromIssueId: issue.id }, { toIssueId: issue.id }] },
      include: {
        fromIssue: { select: { issueKey: true } },
        toIssue: { select: { issueKey: true } },
      },
    }),
    ctx.db.attachment.findMany({
      where: { issueId: issue.id },
      orderBy: { createdAt: 'desc' },
      include: { uploadedBy: { select: { name: true } } },
    }),
    ctx.db.issueFieldValue.findMany({
      where: { issueId: issue.id },
      include: { field: { select: { id: true, name: true, type: true, options: true } } },
    }),
    ctx.db.worklog.findMany({
      where: { issueId: issue.id },
      orderBy: { spentAt: 'desc' },
      include: { actor: { select: { name: true, displayName: true } } },
    }),
  ]);
  const worklogTotal = worklogs.reduce((s, w) => s + w.minutes, 0);
  return {
    ...serializeIssue(issue),
    comments: comments.map((c) => ({
      author: c.author.name,
      authorType: c.author.type,
      body: c.body,
      evidence: c.evidence,
      createdAt: c.createdAt,
    })),
    progressReports: progressReports.map((p) => ({
      actor: p.actor.name,
      percent: p.percent,
      notes: p.notes,
      blockers: p.blockers,
      artifacts: p.artifacts,
      createdAt: p.createdAt,
    })),
    links: links.map((l) => ({
      type: l.type,
      from: l.fromIssue.issueKey,
      to: l.toIssue.issueKey,
    })),
    attachments: attachments.map((a) => ({
      id: a.id,
      name: a.name,
      url: a.url,
      mimeType: a.mimeType,
      sizeBytes: a.sizeBytes,
      uploadedBy: a.uploadedBy.name,
      createdAt: a.createdAt,
    })),
    fields: fieldValues.map((fv) => ({
      fieldId: fv.field.id,
      name: fv.field.name,
      type: fv.field.type,
      options: fv.field.options,
      value: fv.value,
    })),
    worklogs: worklogs.map((w) => ({
      id: w.id,
      actor: w.actor.name,
      displayName: w.actor.displayName,
      minutes: w.minutes,
      spentAt: w.spentAt,
      comment: w.comment,
    })),
    worklogTotal,
  };
}

export async function updateIssue(ctx: Ctx, issueKey: string, input: UpdateIssueInput) {
  const issue = await assertIssueAccess(ctx, issueKey, 'MEMBER');
  // 先校验再落库：releaseId 必须属于同一项目（避免外键 500）
  if (input.releaseId) {
    const release = await ctx.db.release.findFirst({
      where: { id: input.releaseId, projectId: issue.projectId },
    });
    if (!release) throw AppError.badRequest('版本不存在或不属于本项目', 'RELEASE_NOT_FOUND');
  }
  await ctx.db.issue.update({
    where: { id: issue.id },
    data: {
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.priority !== undefined ? { priority: input.priority } : {}),
      ...(input.storyPoints !== undefined ? { storyPoints: input.storyPoints } : {}),
      ...(input.dueDate !== undefined ? { dueDate: input.dueDate } : {}),
      ...(input.estimateMinutes !== undefined ? { estimateMinutes: input.estimateMinutes } : {}),
      ...(input.releaseId !== undefined ? { releaseId: input.releaseId } : {}),
    },
  });
  if (input.labelNames) {
    await ctx.db.issueLabel.deleteMany({ where: { issueId: issue.id } });
    for (const name of input.labelNames) {
      const label = await ctx.db.label.upsert({
        where: { projectId_name: { projectId: issue.projectId, name } },
        create: { projectId: issue.projectId, name },
        update: {},
      });
      await ctx.db.issueLabel
        .create({ data: { issueId: issue.id, labelId: label.id } })
        .catch(() => {});
    }
  }
  await writeActivity(ctx, {
    projectId: issue.projectId,
    issueId: issue.id,
    action: 'issue.updated',
    summary: `更新 ${issue.issueKey}`,
    detail: { fields: Object.keys(input) },
  });
  return getIssueOr404(ctx, issueKey);
}

export interface TransitionResult {
  status: 'done' | 'pending_approval';
  issue?: ReturnType<typeof serializeIssue>;
  approvalId?: string;
  message: string;
}

/**
 * 工作流流转：校验状态机；agent 流转到 DONE 受策略约束（可转审批）。
 * bypassPolicy=true 仅限审批通过后的系统代执行。
 */
export async function transitionIssue(
  ctx: Ctx,
  issueKey: string,
  toStateName: string,
  comment?: string,
  opts: { bypassPolicy?: boolean } = {},
): Promise<TransitionResult> {
  const issue = await assertIssueAccess(ctx, issueKey, 'MEMBER');
  const project = await ctx.db.project.findUniqueOrThrow({ where: { id: issue.projectId } });
  const settings = parseProjectSettings(project.settings);

  const workflow = await ctx.db.workflow.findUnique({
    where: { projectId_issueType: { projectId: issue.projectId, issueType: issue.type } },
    include: {
      states: true,
      transitions: true,
    },
  });
  if (!workflow) throw AppError.internal('工作流缺失');
  const target = workflow.states.find((s) => s.name === toStateName);
  if (!target) {
    throw AppError.badRequest(
      `状态不存在：${toStateName}。可用：${workflow.states.map((s) => s.name).join(', ')}`,
      'STATE_NOT_FOUND',
    );
  }
  if (target.id === issue.stateId) {
    throw AppError.badRequest(`issue 已处于 ${toStateName}`, 'ALREADY_IN_STATE');
  }
  const allowed = workflow.transitions.some(
    (t) => t.toStateId === target.id && (t.fromStateId === null || t.fromStateId === issue.stateId),
  );
  if (!allowed) {
    throw AppError.badRequest(
      `不允许从 ${issue.state.name} 流转到 ${toStateName}（工作流未定义该迁移）`,
      'TRANSITION_NOT_ALLOWED',
    );
  }

  // agent 策略：完成流转需审批
  const isAgentActor = ctx.actorType === 'AGENT' || ctx.actorType === 'AVATAR';
  if (
    !opts.bypassPolicy &&
    isAgentActor &&
    target.category === 'DONE' &&
    settings.agentPolicy.completeTransition === 'approval'
  ) {
    const approval = await ctx.db.approvalRequest.create({
      data: {
        projectId: issue.projectId,
        requestedById: ctx.actorId!,
        actionType: 'issue.transition',
        payload: { issueKey, toState: toStateName, comment: comment ?? null },
      },
    });
    await writeActivity(ctx, {
      projectId: issue.projectId,
      issueId: issue.id,
      action: 'approval.requested',
      summary: `agent 请求将 ${issueKey} 流转为 ${toStateName}（待审批）`,
      detail: { approvalId: approval.id, actionType: 'issue.transition' },
    });
    emitWebhook(ctx, 'approval.requested', {
      projectKey: project.key,
      actionType: 'issue.transition',
      approvalId: approval.id,
      issueKey,
      toState: toStateName,
    });
    await notify(ctx, await projectAdmins(ctx, issue.projectId), 'approval.requested', {
      projectKey: project.key,
      actionType: 'issue.transition',
      issueKey,
      toState: toStateName,
    });
    return {
      status: 'pending_approval',
      approvalId: approval.id,
      message: `需要人工审批：将 ${issueKey} 流转为 ${toStateName} 的请求已进入审批队列`,
    };
  }

  const wasDone = issue.state.category === 'DONE';
  const updated = await ctx.db.issue.update({
    where: { id: issue.id },
    data: {
      stateId: target.id,
      closedAt: target.category === 'DONE' ? (wasDone ? issue.closedAt : new Date()) : null,
    },
  });
  if (comment) {
    await ctx.db.comment.create({
      data: { issueId: issue.id, authorId: ctx.actorId!, body: comment },
    });
  }
  await writeActivity(ctx, {
    projectId: issue.projectId,
    issueId: issue.id,
    action: 'issue.transitioned',
    summary: `${issueKey}: ${issue.state.name} → ${toStateName}`,
    detail: { from: issue.state.name, to: toStateName },
  });
  emitWebhook(ctx, 'issue.transitioned', {
    projectKey: (
      await ctx.db.project.findUniqueOrThrow({
        where: { id: issue.projectId },
        select: { key: true },
      })
    ).key,
    issueKey,
    from: issue.state.name,
    to: toStateName,
    stateCategory: target.category,
  });
  if (target.category === 'DONE' && !wasDone) {
    const audience = await issueAudience(ctx, issue);
    const project = await ctx.db.project.findUniqueOrThrow({
      where: { id: issue.projectId },
      select: { key: true },
    });
    await notify(ctx, audience, 'issue.completed', {
      projectKey: project.key,
      issueKey,
      title: issue.title,
    });
  }
  return {
    status: 'done',
    issue: serializeIssue(await getIssueOr404(ctx, updated.issueKey)),
    message: `${issueKey} 已流转为 ${toStateName}`,
  };
}

export async function assignIssue(ctx: Ctx, issueKey: string, assigneeName: string | null) {
  const issue = await assertIssueAccess(ctx, issueKey, 'MEMBER');
  let assigneeId: string | null = null;
  if (assigneeName) {
    const a = await ctx.db.actor.findUnique({ where: { name: assigneeName } });
    if (!a) throw AppError.badRequest(`指派对象不存在：${assigneeName}`, 'ACTOR_NOT_FOUND');
    const m = await ctx.db.member.findUnique({
      where: { projectId_actorId: { projectId: issue.projectId, actorId: a.id } },
    });
    if (!m) throw AppError.badRequest(`${assigneeName} 不是项目成员`, 'NOT_A_MEMBER');
    assigneeId = a.id;
  }
  await ctx.db.issue.update({ where: { id: issue.id }, data: { assigneeId } });
  await writeActivity(ctx, {
    projectId: issue.projectId,
    issueId: issue.id,
    action: 'issue.assigned',
    summary: `${issueKey} 指派给 ${assigneeName ?? '（取消指派）'}`,
  });
  emitWebhook(ctx, 'issue.assigned', {
    projectKey: (
      await ctx.db.project.findUniqueOrThrow({
        where: { id: issue.projectId },
        select: { key: true },
      })
    ).key,
    issueKey,
    assignee: assigneeName,
  });
  const project = await ctx.db.project.findUniqueOrThrow({
    where: { id: issue.projectId },
    select: { key: true },
  });
  await notify(ctx, [assigneeId], 'issue.assigned', {
    projectKey: project.key,
    issueKey,
    title: issue.title,
  });
  return serializeIssue(await getIssueOr404(ctx, issueKey));
}

/** agent 并发领取上限校验（policy.maxConcurrentClaims）。 */
async function assertClaimBudget(
  ctx: Ctx,
  project: { id: string; settings: unknown },
  actorId: string,
) {
  const isAgent = ctx.actorType === 'AGENT' || ctx.actorType === 'AVATAR';
  if (!isAgent) return;
  const settings = parseProjectSettings(project.settings);
  const active = await ctx.db.issue.count({
    where: { projectId: project.id, assigneeId: actorId, state: { category: { not: 'DONE' } } },
  });
  if (active >= settings.agentPolicy.maxConcurrentClaims) {
    throw AppError.conflict(
      `已达并发领取上限（${settings.agentPolicy.maxConcurrentClaims}），请先完成或释放当前任务`,
      'CLAIM_LIMIT_REACHED',
      { active },
    );
  }
}

/**
 * 原子领取：指定 issueKey 直接抢；或按条件从待办池抢单。
 * 并发安全由 updateMany(where assigneeId IS NULL) 的单语句原子性保证。
 */
export async function claimIssue(ctx: Ctx, projectKey: string, input: ClaimIssueInput) {
  const { project } = await requireProjectMembership(ctx, projectKey, 'MEMBER');
  if (!ctx.actorId) throw AppError.unauthorized();
  await assertClaimBudget(ctx, project, ctx.actorId);

  if (input.issueKey) {
    const target = await ctx.db.issue.findUnique({
      where: { issueKey: input.issueKey },
      include: { project: { select: { key: true } } },
    });
    if (!target || target.project.key !== project.key)
      throw AppError.notFound(`issue 不存在：${input.issueKey}`, 'ISSUE_NOT_FOUND');
    const won = await tryClaimById(ctx, target.id, ctx.actorId);
    if (!won) {
      const current = await ctx.db.issue.findUniqueOrThrow({
        where: { id: target.id },
        include: { assignee: { select: { name: true } } },
      });
      throw AppError.conflict(
        `${input.issueKey} 已被 ${current.assignee?.name ?? '其他人'} 领取`,
        'ALREADY_CLAIMED',
      );
    }
    await writeActivity(ctx, {
      projectId: project.id,
      issueId: target.id,
      action: 'task.claimed',
      summary: `${ctx.actorName ?? ctx.actorId} 领取 ${input.issueKey}`,
    });
    emitWebhook(ctx, 'task.claimed', {
      projectKey: project.key,
      issueKey: input.issueKey,
      assignee: ctx.actorName,
    });
    return { issue: serializeIssue(await getIssueOr404(ctx, input.issueKey)), contested: false };
  }

  // 条件抢单：候选 → 逐个 CAS
  const where: Prisma.IssueWhereInput = {
    projectId: project.id,
    assigneeId: null,
    state: { category: 'TODO' },
    ...(input.type ? { type: input.type } : {}),
    ...(input.label ? { labels: { some: { label: { name: input.label } } } } : {}),
    ...(input.q
      ? {
          OR: [
            { title: { contains: `%${input.q}%` } },
            { description: { contains: `%${input.q}%` } },
          ],
        }
      : {}),
  };
  const candidates = await ctx.db.issue.findMany({
    where,
    orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
    take: 10,
    select: { id: true, issueKey: true },
  });
  for (const c of candidates) {
    if (await tryClaimById(ctx, c.id, ctx.actorId)) {
      await writeActivity(ctx, {
        projectId: project.id,
        issueId: c.id,
        action: 'task.claimed',
        summary: `${ctx.actorName ?? ctx.actorId} 领取 ${c.issueKey}`,
        detail: { matchedBy: { type: input.type, label: input.label, q: input.q } },
      });
      emitWebhook(ctx, 'task.claimed', {
        projectKey: project.key,
        issueKey: c.issueKey,
        assignee: ctx.actorName,
      });
      return { issue: serializeIssue(await getIssueOr404(ctx, c.issueKey)), contested: false };
    }
  }
  throw AppError.notFound(
    candidates.length ? '抢单竞争失败：候选任务刚被别人领取，请重试' : '没有符合条件的可领取任务',
    candidates.length ? 'CLAIM_RACE_LOST' : 'NO_CLAIMABLE_ISSUE',
  );
}

async function tryClaimById(ctx: Ctx, issueId: string, actorId: string): Promise<boolean> {
  const res = await ctx.db.issue.updateMany({
    where: { id: issueId, assigneeId: null },
    data: { assigneeId: actorId },
  });
  return res.count === 1;
}

export async function releaseIssue(ctx: Ctx, issueKey: string, reason?: string) {
  const issue = await assertIssueAccess(ctx, issueKey, 'MEMBER');
  const member = await ctx.db.member.findFirst({
    where: { projectId: issue.projectId, actorId: ctx.actorId },
  });
  const isOwner = issue.assignee?.name === ctx.actorName;
  const canRelease = isOwner || member?.role === 'ADMIN' || member?.role === 'OWNER';
  if (!canRelease) throw AppError.forbidden('只有领取人或项目管理员可以释放任务', 'NOT_ASSIGNEE');
  if (!issue.assignee) throw AppError.badRequest('该任务未被领取', 'NOT_CLAIMED');

  await ctx.db.issue.update({ where: { id: issue.id }, data: { assigneeId: null } });
  if (reason) {
    await ctx.db.comment.create({
      data: { issueId: issue.id, authorId: ctx.actorId!, body: `释放任务：${reason}` },
    });
  }
  await writeActivity(ctx, {
    projectId: issue.projectId,
    issueId: issue.id,
    action: 'task.released',
    summary: `${ctx.actorName ?? ctx.actorId} 释放 ${issueKey}${reason ? `：${reason}` : ''}`,
  });
  emitWebhook(ctx, 'task.released', {
    projectKey: (
      await ctx.db.project.findUniqueOrThrow({
        where: { id: issue.projectId },
        select: { key: true },
      })
    ).key,
    issueKey,
    reason: reason ?? null,
  });
  return serializeIssue(await getIssueOr404(ctx, issueKey));
}

export async function linkIssue(
  ctx: Ctx,
  fromIssueKey: string,
  toIssueKey: string,
  type: 'BLOCKS' | 'RELATES' | 'DUPLICATES' | 'CAUSES',
) {
  const from = await assertIssueAccess(ctx, fromIssueKey, 'MEMBER');
  const to = await getIssueOr404(ctx, toIssueKey);
  if (to.projectId !== from.projectId) throw AppError.badRequest('跨项目链接暂不支持');
  if (to.id === from.id) throw AppError.badRequest('不能链接自身');
  await ctx.db.issueLink
    .create({ data: { fromIssueId: from.id, toIssueId: to.id, type, createdById: ctx.actorId! } })
    .catch(() => {});
  await writeActivity(ctx, {
    projectId: from.projectId,
    issueId: from.id,
    action: 'issue.linked',
    summary: `链接 ${fromIssueKey} --${type}--> ${toIssueKey}`,
  });
  return { from: fromIssueKey, to: toIssueKey, type };
}

export async function watchIssue(ctx: Ctx, issueKey: string, watch: boolean) {
  const issue = await assertIssueAccess(ctx, issueKey);
  if (watch) {
    await ctx.db.watcher
      .create({ data: { issueId: issue.id, actorId: ctx.actorId! } })
      .catch(() => {});
  } else {
    await ctx.db.watcher
      .deleteMany({ where: { issueId: issue.id, actorId: ctx.actorId! } })
      .catch(() => {});
  }
  return { issueKey, watching: watch };
}
