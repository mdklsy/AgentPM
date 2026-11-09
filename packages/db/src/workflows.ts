import type { IssueType, Prisma, PrismaClient, StateCategory } from './index.js';

export interface WorkflowStateSpec {
  name: string;
  category: StateCategory;
  isInitial?: boolean;
}

/** from 为 null 表示“从任意状态都可进入 to” */
export type WorkflowTransitionSpec = [from: string | null, to: string];

export interface WorkflowSpec {
  name: string;
  states: WorkflowStateSpec[];
  transitions: WorkflowTransitionSpec[];
}

const taskFlow = (): WorkflowSpec => ({
  name: '默认任务流',
  states: [
    { name: '待办', category: 'TODO', isInitial: true },
    { name: '进行中', category: 'IN_PROGRESS' },
    { name: '已完成', category: 'DONE' },
  ],
  transitions: [
    ['待办', '进行中'],
    ['进行中', '待办'],
    ['进行中', '已完成'],
    ['已完成', '进行中'], // reopen
  ],
});

/**
 * 建项目时按 issue 类型播种的默认工作流（状态名为面向用户的显示名，可直接自定义）。
 * 状态机语义：TODO → IN_PROGRESS → DONE，允许相邻回退与 reopen；
 * DONE 类别的进入会设置 issue.closedAt。
 */
export const DEFAULT_WORKFLOW_SPECS: Record<IssueType, WorkflowSpec> = {
  STORY: {
    name: '默认需求流',
    states: [
      { name: '待办', category: 'TODO', isInitial: true },
      { name: '已选定', category: 'TODO' },
      { name: '进行中', category: 'IN_PROGRESS' },
      { name: '评审中', category: 'IN_PROGRESS' },
      { name: '已完成', category: 'DONE' },
    ],
    transitions: [
      ['待办', '已选定'],
      ['已选定', '待办'],
      ['已选定', '进行中'],
      ['进行中', '已选定'],
      ['进行中', '评审中'],
      ['评审中', '进行中'],
      ['评审中', '已完成'],
      ['已完成', '进行中'], // reopen
    ],
  },
  TASK: taskFlow(),
  SUBTASK: taskFlow(),
  BUG: {
    name: '默认缺陷流',
    states: [
      { name: '待办', category: 'TODO', isInitial: true },
      { name: '进行中', category: 'IN_PROGRESS' },
      { name: '评审中', category: 'IN_PROGRESS' },
      { name: '已解决', category: 'DONE' },
      { name: '已关闭', category: 'DONE' },
    ],
    transitions: [
      ['待办', '进行中'],
      ['进行中', '待办'],
      ['进行中', '评审中'],
      ['评审中', '进行中'],
      ['评审中', '已解决'],
      ['已解决', '评审中'],
      ['已解决', '已关闭'],
      ['已关闭', '已解决'],
      ['已关闭', '待办'], // reopen
    ],
  },
  EPIC: {
    name: '默认史诗流',
    states: [
      { name: '待办', category: 'TODO', isInitial: true },
      { name: '进行中', category: 'IN_PROGRESS' },
      { name: '已完成', category: 'DONE' },
    ],
    transitions: [
      ['待办', '进行中'],
      ['进行中', '待办'],
      ['进行中', '已完成'],
      ['已完成', '进行中'],
    ],
  },
};

/**
 * 历史版本（v0.1 内部开发期）的英文默认状态名 → 中文名映射。
 * `pnpm --filter @agentpm/db localize:states` 用它升级存量数据库（幂等）。
 */
export const LEGACY_STATE_NAME_MAP: Record<string, string> = {
  Open: '待办',
  Backlog: '待办',
  Selected: '已选定',
  'In Progress': '进行中',
  'In Review': '评审中',
  Done: '已完成',
  Resolved: '已解决',
  Closed: '已关闭',
};

/** 在事务中为一个项目播种全部默认工作流（幂等：已存在则跳过）。 */
export async function seedDefaultWorkflows(
  db: Prisma.TransactionClient | PrismaClient,
  projectId: string,
): Promise<void> {
  for (const [issueType, spec] of Object.entries(DEFAULT_WORKFLOW_SPECS) as [
    IssueType,
    WorkflowSpec,
  ][]) {
    const existing = await db.workflow.findUnique({
      where: { projectId_issueType: { projectId, issueType } },
    });
    if (existing) continue;

    await db.workflow.create({
      data: {
        projectId,
        issueType,
        name: spec.name,
        states: {
          create: spec.states.map((s, i) => ({
            name: s.name,
            category: s.category,
            sortOrder: i,
            isInitial: s.isInitial ?? false,
          })),
        },
      },
    });

    const workflow = await db.workflow.findUniqueOrThrow({
      where: { projectId_issueType: { projectId, issueType } },
      include: { states: true },
    });
    const byName = new Map(workflow.states.map((s) => [s.name, s.id]));
    for (const [from, to] of spec.transitions) {
      const toId = byName.get(to);
      const fromId = from ? byName.get(from) : null;
      if (!toId || (from && !fromId)) continue;
      await db.workflowTransition.create({
        data: { workflowId: workflow.id, fromStateId: fromId, toStateId: toId },
      });
    }
  }
}

/** 找到某项目某类型工作流的初始状态（建 issue 时用）。 */
export async function getInitialState(
  db: Prisma.TransactionClient | PrismaClient,
  projectId: string,
  issueType: IssueType,
) {
  const state = await db.workflowState.findFirst({
    where: { workflow: { projectId, issueType }, isInitial: true },
  });
  return state ?? null;
}
