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
    { name: 'Open', category: 'TODO', isInitial: true },
    { name: 'In Progress', category: 'IN_PROGRESS' },
    { name: 'Done', category: 'DONE' },
  ],
  transitions: [
    ['Open', 'In Progress'],
    ['In Progress', 'Open'],
    ['In Progress', 'Done'],
    ['Done', 'In Progress'], // reopen
  ],
});

/**
 * 建项目时按 issue 类型播种的默认工作流。
 * 状态机语义：TODO → IN_PROGRESS → DONE，允许相邻回退与 reopen；
 * DONE 类别的进入会设置 issue.closedAt。
 */
export const DEFAULT_WORKFLOW_SPECS: Record<IssueType, WorkflowSpec> = {
  STORY: {
    name: '默认需求流',
    states: [
      { name: 'Backlog', category: 'TODO', isInitial: true },
      { name: 'Selected', category: 'TODO' },
      { name: 'In Progress', category: 'IN_PROGRESS' },
      { name: 'In Review', category: 'IN_PROGRESS' },
      { name: 'Done', category: 'DONE' },
    ],
    transitions: [
      ['Backlog', 'Selected'],
      ['Selected', 'Backlog'],
      ['Selected', 'In Progress'],
      ['In Progress', 'Selected'],
      ['In Progress', 'In Review'],
      ['In Review', 'In Progress'],
      ['In Review', 'Done'],
      ['Done', 'In Progress'], // reopen
    ],
  },
  TASK: taskFlow(),
  SUBTASK: taskFlow(),
  BUG: {
    name: '默认缺陷流',
    states: [
      { name: 'Open', category: 'TODO', isInitial: true },
      { name: 'In Progress', category: 'IN_PROGRESS' },
      { name: 'In Review', category: 'IN_PROGRESS' },
      { name: 'Resolved', category: 'DONE' },
      { name: 'Closed', category: 'DONE' },
    ],
    transitions: [
      ['Open', 'In Progress'],
      ['In Progress', 'Open'],
      ['In Progress', 'In Review'],
      ['In Review', 'In Progress'],
      ['In Review', 'Resolved'],
      ['Resolved', 'In Review'],
      ['Resolved', 'Closed'],
      ['Closed', 'Resolved'],
      ['Closed', 'Open'], // reopen
    ],
  },
  EPIC: {
    name: '默认史诗流',
    states: [
      { name: 'Open', category: 'TODO', isInitial: true },
      { name: 'In Progress', category: 'IN_PROGRESS' },
      { name: 'Done', category: 'DONE' },
    ],
    transitions: [
      ['Open', 'In Progress'],
      ['In Progress', 'Open'],
      ['In Progress', 'Done'],
      ['Done', 'In Progress'],
    ],
  },
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
