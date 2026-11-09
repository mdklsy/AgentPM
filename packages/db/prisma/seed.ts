/**
 * AgentPM 种子数据（幂等：项目 APM 已存在则跳过）。
 * - 首个管理员（SEED_ADMIN_USERNAME / SEED_ADMIN_PASSWORD / SEED_ADMIN_EMAIL）
 * - 示例项目 APM（默认工作流 + 标签 + ACTIVE sprint + 一组示例 issue）
 * - 示例 agent `demo-agent`（owner=admin，签发 MCP token 并打印一次性明文）
 */
import type { IssueType } from '../src/index.js';
import { createPrisma } from '../src/index.js';
import { getInitialState, seedDefaultWorkflows } from '../src/workflows.js';
import { loadEnv, generateApiToken, hashApiToken, tokenDisplayPrefix } from '@agentpm/shared/node';

loadEnv();

const db = createPrisma();

async function upsertAdmin() {
  const username = process.env.SEED_ADMIN_USERNAME || 'admin';
  const password = process.env.SEED_ADMIN_PASSWORD || 'ChangeMe!AgentPM2026';
  const email = process.env.SEED_ADMIN_EMAIL || 'admin@example.com';

  const { hash } = await import('@node-rs/argon2');
  const passwordHash = await hash(password);

  const admin = await db.actor.upsert({
    where: { name: username },
    create: {
      type: 'HUMAN',
      name: username,
      displayName: 'Administrator',
      email,
      passwordHash,
      isAdmin: true,
      mustChangePassword: true,
    },
    update: {},
  });
  return { admin, username };
}

async function main() {
  const { admin } = await upsertAdmin();

  const existing = await db.project.findUnique({ where: { key: 'APM' } });
  if (existing) {
    console.info('[agentpm-seed] 示例项目 APM 已存在，跳过。管理员账号已确保存在。');
    return;
  }

  // --- project + workflows + labels ---
  const project = await db.project.create({
    data: {
      key: 'APM',
      name: 'AgentPM 演示项目',
      description: '用于本地体验与验收的示例项目：人类与 agent 在同一项目协作。',
      visibility: 'INTERNAL',
      createdById: admin.id,
      settings: {
        agentPolicy: {
          maxConcurrentClaims: 3,
          bugCreate: 'auto',
          completeTransition: 'approval',
          autoFileRegressionBugs: true,
        },
      },
    },
  });
  await seedDefaultWorkflows(db, project.id);

  for (const [name, color] of [
    ['feature', '#2563eb'],
    ['bug', '#dc2626'],
    ['docs', '#16a34a'],
    ['agent-friendly', '#7c3aed'],
  ] as const) {
    await db.label.create({ data: { projectId: project.id, name, color } });
  }
  await db.member.create({
    data: { projectId: project.id, actorId: admin.id, role: 'OWNER' },
  });

  // --- sprint ---
  const now = new Date();
  const sprint = await db.sprint.create({
    data: {
      projectId: project.id,
      name: 'Sprint 1',
      goal: '跑通 人 ↔ agent 协作最小闭环',
      startsAt: new Date(now.getTime() - 3 * 86400_000),
      endsAt: new Date(now.getTime() + 11 * 86400_000),
      status: 'ACTIVE',
    },
  });

  // --- demo agent + token ---
  const demoAgent = await db.actor.create({
    data: {
      type: 'AGENT',
      name: 'demo-agent',
      displayName: 'Demo Agent',
      agentProfile: {
        create: {
          ownerId: admin.id,
          description: '种子数据创建的示例 agent：用于验证 MCP 领取/汇报/提bug/回归全链路。',
          model: 'any-mcp-client',
          capabilities: ['claim-task', 'report-bug', 'regression'],
        },
      },
    },
    include: { agentProfile: true },
  });
  await db.member.create({
    data: { projectId: project.id, actorId: demoAgent.id, role: 'AGENT' },
  });
  const token = generateApiToken();
  await db.apiToken.create({
    data: {
      actorId: demoAgent.id,
      name: 'seed-token',
      prefix: tokenDisplayPrefix(token),
      tokenHash: hashApiToken(token),
      scopes: ['read', 'write', 'mcp'],
    },
  });

  // --- issues ---
  let seq = 0;
  const labels = await db.label.findMany({ where: { projectId: project.id } });
  const labelByName = new Map(labels.map((l) => [l.name, l.id]));

  async function addIssue(input: {
    type: IssueType;
    title: string;
    description?: string;
    state?: string;
    priority?: 'P0' | 'P1' | 'P2' | 'P3' | 'P4';
    assigneeId?: string;
    labelNames?: string[];
    parentKey?: string;
    sprint?: boolean;
    fingerprint?: string;
  }) {
    seq += 1;
    const issueKey = `APM-${seq}`;
    const state =
      (input.state &&
        (await db.workflowState.findFirst({
          where: { workflow: { projectId: project.id, issueType: input.type }, name: input.state },
        }))) ||
      (await getInitialState(db, project.id, input.type));
    if (!state) throw new Error(`no state for ${input.type}`);
    const parent = input.parentKey
      ? await db.issue.findUnique({ where: { issueKey: input.parentKey } })
      : null;
    return db.issue.create({
      data: {
        projectId: project.id,
        number: seq,
        issueKey,
        type: input.type,
        title: input.title,
        description: input.description,
        stateId: state.id,
        priority: input.priority ?? 'P2',
        assigneeId: input.assigneeId,
        reporterId: admin.id,
        createdById: admin.id,
        parentIssueId: parent?.id,
        sprintId: input.sprint ? sprint.id : null,
        fingerprint: input.fingerprint,
        labels: input.labelNames?.length
          ? {
              create: input.labelNames
                .filter((n) => labelByName.has(n))
                .map((n) => ({ labelId: labelByName.get(n)! })),
            }
          : undefined,
      },
    });
  }

  await addIssue({
    type: 'EPIC',
    title: 'AgentPM v0.1 核心能力',
    description: '人机统一身份、MCP 工具面、审计与审批闸门。',
  });
  await addIssue({ type: 'STORY', title: '项目与成员管理', sprint: true, labelNames: ['feature'] });
  await addIssue({
    type: 'STORY',
    title: 'Issue 全生命周期',
    sprint: true,
    labelNames: ['feature'],
  });
  await addIssue({ type: 'TASK', title: '设计统一 Actor 数据模型', labelNames: ['docs'] });
  await addIssue({
    type: 'TASK',
    title: '实现认证与 RBAC',
    state: 'Done',
    sprint: true,
    labelNames: ['feature'],
  });
  await addIssue({
    type: 'TASK',
    title: 'MCP 工具面：领取与进度汇报',
    state: 'In Progress',
    assigneeId: demoAgent.id,
    sprint: true,
    labelNames: ['agent-friendly'],
  });
  await addIssue({
    type: 'TASK',
    title: '编写部署文档',
    labelNames: ['docs', 'agent-friendly'],
  });
  await addIssue({
    type: 'SUBTASK',
    title: '实现工作流状态机校验',
    parentKey: 'APM-3',
    sprint: true,
  });
  await addIssue({
    type: 'BUG',
    title: '并发领取同一任务时出现双写',
    description: '两个 agent 同时 claim 同一 issue 的竞态问题（已由 updateMany 原子领取修复）。',
    state: 'Resolved',
    priority: 'P1',
    labelNames: ['bug'],
    fingerprint: 'race:issue.claim',
  });
  await addIssue({
    type: 'BUG',
    title: '中文关键词搜索未命中',
    priority: 'P2',
    labelNames: ['bug'],
    sprint: true,
  });

  await db.project.update({ where: { id: project.id }, data: { numberSeq: seq } });

  // 活动流示例：让审计流一开始就有内容
  await db.activity.createMany({
    data: [
      {
        projectId: project.id,
        actorId: admin.id,
        action: 'project.created',
        summary: '创建项目 APM（seed）',
        source: 'SYSTEM',
      },
      {
        projectId: project.id,
        actorId: demoAgent.id,
        action: 'task.claimed',
        summary: 'agent demo-agent 领取 APM-6',
        source: 'SYSTEM',
        detail: { issueKey: 'APM-6' },
      },
    ],
  });

  console.info(`
============================================================
 AgentPM seed 完成
------------------------------------------------------------
 管理员账号   : ${process.env.SEED_ADMIN_USERNAME || 'admin'}
 初始密码     : ${process.env.SEED_ADMIN_PASSWORD || 'ChangeMe!AgentPM2026'}（首次登录后请修改）
 示例项目     : APM（${seq} 个 issue，Sprint 1 ACTIVE）
 示例 agent   : demo-agent
 agent token  : ${token}
                （仅此一次显示；可用它访问 /v1/mcp）
 MCP HTTP     : POST http://<host>:3000/v1/mcp  Authorization: Bearer <token>
 stdio 网关   : npx agentpm-mcp --url http://<host>:3000/v1/mcp --token <token>
============================================================
`);
}

main()
  .catch((e) => {
    console.error('[agentpm-seed] failed:', e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
