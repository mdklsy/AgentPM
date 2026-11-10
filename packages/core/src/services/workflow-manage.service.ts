import { AppError } from '@agentpm/shared';
import type { Ctx } from '../ctx.js';
import { requireProjectAdmin } from './fields.service.js';
import { requireProjectMembership } from './project.service.js';

/**
 * 工作流编辑（M6）：全量替换某项目某 issue 类型的工作流（状态 + 迁移）。
 * 校验：状态名唯一、初始态恰一个、迁移引用存在的状态；被 issue 占用的状态不可删。
 * 引用全走 stateId，改名不影响历史 issue。
 */

export interface WorkflowEditorInput {
  name?: string;
  states: Array<{
    id?: string; // 带上=保留该状态（可改名/改类别）；不带=新建
    name: string;
    category: 'TODO' | 'IN_PROGRESS' | 'DONE';
    isInitial?: boolean;
  }>;
  transitions: Array<[fromName: string | null, toName: string]>;
}

export async function getWorkflow(ctx: Ctx, projectKey: string, issueType: string) {
  await requireProjectMembership(ctx, projectKey);
  const workflow = await ctx.db.workflow.findUnique({
    where: {
      projectId_issueType: {
        projectId: await projectIdOf(ctx, projectKey),
        issueType: issueType as never,
      },
    },
    include: {
      states: { orderBy: { sortOrder: 'asc' } },
      transitions: {
        include: { fromState: { select: { name: true } }, toState: { select: { name: true } } },
      },
    },
  });
  if (!workflow) throw AppError.notFound(`工作流不存在：${issueType}`, 'WORKFLOW_NOT_FOUND');
  return {
    issueType,
    name: workflow.name,
    states: workflow.states.map((s) => ({
      id: s.id,
      name: s.name,
      category: s.category,
      isInitial: s.isInitial,
      sortOrder: s.sortOrder,
      issueCount: null, // 数量按需另查（编辑器预览用 whereIssueCount）
    })),
    transitions: workflow.transitions.map((t) => ({
      from: t.fromState?.name ?? null,
      to: t.toState.name,
    })),
  };
}

async function projectIdOf(ctx: Ctx, projectKey: string): Promise<string> {
  const p = await ctx.db.project.findUniqueOrThrow({
    where: { key: projectKey },
    select: { id: true },
  });
  return p.id;
}

export async function replaceWorkflow(
  ctx: Ctx,
  projectKey: string,
  issueType: string,
  input: WorkflowEditorInput,
) {
  await requireProjectAdmin(ctx, projectKey);
  const projectId = await projectIdOf(ctx, projectKey);
  const workflow = await ctx.db.workflow.findUnique({
    where: { projectId_issueType: { projectId, issueType: issueType as never } },
    include: { states: { include: { issues: { select: { issueKey: true } } } } },
  });
  if (!workflow) throw AppError.notFound(`工作流不存在：${issueType}`, 'WORKFLOW_NOT_FOUND');

  // 校验状态名唯一
  const names = input.states.map((s) => s.name);
  if (new Set(names).size !== names.length)
    throw AppError.badRequest('状态名不能重复', 'STATE_NAME_DUP');
  const initials = input.states.filter((s) => s.isInitial);
  if (initials.length !== 1)
    throw AppError.badRequest('必须且只能有一个初始状态', 'INITIAL_STATE_INVALID');
  // 校验迁移引用
  for (const [, to] of input.transitions) {
    if (!names.includes(to))
      throw AppError.badRequest(`迁移引用了不存在的状态：${to}`, 'TRANSITION_BAD_TARGET');
  }
  for (const [from] of input.transitions) {
    if (from && !names.includes(from))
      throw AppError.badRequest(`迁移引用了不存在的状态：${from}`, 'TRANSITION_BAD_SOURCE');
  }
  // 被 issue 占用的状态不可删
  const keptIds = new Set(input.states.filter((s) => s.id).map((s) => s.id));
  const removedBusy = workflow.states.filter((s) => !keptIds.has(s.id) && s.issues.length > 0);
  if (removedBusy.length)
    throw AppError.badRequest(
      `以下状态仍有 issue 使用，不能删除：${removedBusy.map((s) => `${s.name}（${s.issues.length} 个）`).join('、')}`,
      'STATE_IN_USE',
    );
  // 目标状态（新）里初始态必须存在
  const initialName = initials[0]!.name;

  await ctx.db.$transaction(async (tx) => {
    // 删除未被占用的旧状态（连带迁移靠 Cascade）
    for (const s of workflow.states) {
      if (!keptIds.has(s.id) && s.issues.length === 0) {
        await tx.workflowState.delete({ where: { id: s.id } });
      }
    }
    // 逐个 upsert 状态
    const idByName = new Map<string, string>();
    for (const [i, s] of input.states.entries()) {
      if (s.id) {
        await tx.workflowState.update({
          where: { id: s.id },
          data: { name: s.name, category: s.category, isInitial: !!s.isInitial, sortOrder: i },
        });
        idByName.set(s.name, s.id);
      } else {
        const created = await tx.workflowState.create({
          data: {
            workflowId: workflow.id,
            name: s.name,
            category: s.category,
            isInitial: !!s.isInitial,
            sortOrder: i,
          },
        });
        idByName.set(s.name, created.id);
      }
    }
    // 重建迁移
    await tx.workflowTransition.deleteMany({ where: { workflowId: workflow.id } });
    for (const [from, to] of input.transitions) {
      const fromId = from ? idByName.get(from)! : null;
      const toId = idByName.get(to)!;
      await tx.workflowTransition.create({
        data: { workflowId: workflow.id, fromStateId: fromId, toStateId: toId },
      });
    }
    if (input.name) {
      await tx.workflow.update({ where: { id: workflow.id }, data: { name: input.name } });
    }
    // 初始态唯一性兜底：把非初始态的 isInitial 清掉
    await tx.workflowState.updateMany({
      where: { workflowId: workflow.id, isInitial: true, name: { not: initialName } },
      data: { isInitial: false },
    });
  });

  return getWorkflow(ctx, projectKey, issueType);
}
