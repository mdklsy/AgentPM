/**
 * 规则引擎（纯函数，无 IO）：替身的"眼睛"。
 * 输入为经 REST 采集的项目快照，输出结构化风险与建议；
 * 与 core/monitoring.service 的健康度同一套口径。
 */

export interface SnapshotIssue {
  issueKey: string;
  title: string;
  type: string;
  state: string;
  stateCategory: 'TODO' | 'IN_PROGRESS' | 'DONE';
  priority: string;
  assignee: string | null;
  dueDate: string | null;
  updatedAt: string;
}

export interface SnapshotInput {
  projectKey: string;
  projectName: string;
  stats: {
    totals: {
      total: number;
      done: number;
      todo: number;
      inProgress: number;
      completionRate: number;
    };
    workload: {
      unassigned: number;
      members: Array<{ name: string; type: string; open: number; inProgress: number }>;
    };
    agents: Array<{
      name: string;
      status: string;
      lastHeartbeatAt: string | null;
      activeIssues: number;
    }>;
    sprint: { name: string; endsAt: string | null; totals: Record<string, number> } | null;
    activity7d: { total: number; bySource: Record<string, number> };
  };
  issues: SnapshotIssue[];
  burndownTail: Array<{ date: string; remaining: number; ideal: number }> | null;
  pendingApprovals: Array<{
    id: string;
    actionType: string;
    requestedBy: string;
    createdAt: string;
  }>;
  policy: { stallDays: number; digestHour: number; commentOnStalled: boolean };
  now?: Date;
}

export type RiskCode =
  | 'STALLED_TASK'
  | 'OVERDUE'
  | 'SPRINT_BEHIND'
  | 'APPROVAL_AGING'
  | 'WORKLOAD_IMBALANCE'
  | 'AGENT_SILENT';

export interface Risk {
  code: RiskCode;
  severity: 'HIGH' | 'MEDIUM' | 'LOW';
  message: string;
  evidence?: Record<string, unknown>;
}

export interface Insights {
  risks: Risk[];
  suggestions: string[];
  headline: string;
}

export function computeInsights(input: SnapshotInput): Insights {
  const now = input.now ?? new Date();
  const risks: Risk[] = [];
  const suggestions: string[] = [];
  const open = input.issues.filter((i) => i.stateCategory !== 'DONE');

  // 1. 任务停滞：IN_PROGRESS 且 updatedAt 超 stallDays
  const stalled = open
    .filter(
      (i) =>
        i.stateCategory === 'IN_PROGRESS' &&
        now.getTime() - new Date(i.updatedAt).getTime() > input.policy.stallDays * 86_400_000,
    )
    .sort((a, b) => new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime())
    .slice(0, 5);
  if (stalled.length) {
    risks.push({
      code: 'STALLED_TASK',
      severity: stalled.length >= 3 ? 'HIGH' : 'MEDIUM',
      message: `${stalled.length} 个进行中任务超过 ${input.policy.stallDays} 天无更新（${stalled.map((i) => i.issueKey).join('、')}）`,
      evidence: {
        issues: stalled.map((i) => ({
          issueKey: i.issueKey,
          assignee: i.assignee,
          updatedAt: i.updatedAt,
        })),
      },
    });
    suggestions.push('与停滞任务的负责人确认阻塞点，必要时释放回待办池让其他 agent 领取。');
  }

  // 2. 逾期
  const overdue = open
    .filter((i) => i.dueDate && new Date(i.dueDate).getTime() < now.getTime())
    .sort((a, b) => new Date(a.dueDate!).getTime() - new Date(b.dueDate!).getTime())
    .slice(0, 5);
  if (overdue.length) {
    risks.push({
      code: 'OVERDUE',
      severity: overdue.length >= 3 ? 'HIGH' : 'MEDIUM',
      message: `${overdue.length} 个 issue 已过截止日（${overdue.map((i) => i.issueKey).join('、')}）`,
      evidence: { issues: overdue.map((i) => ({ issueKey: i.issueKey, dueDate: i.dueDate })) },
    });
    suggestions.push('重排逾期任务的截止日或优先级，优先清理 P0/P1。');
  }

  // 3. Sprint 偏离（燃尽尾部 vs 理想线 + 剩余天数）
  const tail = input.burndownTail?.[input.burndownTail.length - 1];
  if (input.stats.sprint && tail) {
    const daysLeft = input.stats.sprint.endsAt
      ? Math.ceil((new Date(input.stats.sprint.endsAt).getTime() - now.getTime()) / 86_400_000)
      : null;
    const behind = tail.remaining - tail.ideal;
    if (behind > 0 && (behind >= 2 || (daysLeft !== null && daysLeft <= 2 && tail.remaining > 1))) {
      risks.push({
        code: 'SPRINT_BEHIND',
        severity: daysLeft !== null && daysLeft <= 2 && tail.remaining > 2 ? 'HIGH' : 'MEDIUM',
        message: `${input.stats.sprint.name} 剩余 ${tail.remaining} 项，落后理想线 ${behind} 项${daysLeft !== null ? `，距结束 ${Math.max(0, daysLeft)} 天` : ''}`,
        evidence: { remaining: tail.remaining, ideal: tail.ideal, daysLeft },
      });
      suggestions.push('评估砍需求或加派 agent，保持 Sprint 交付承诺。');
    }
  }

  // 4. 审批积压（>24h）
  const aged = input.pendingApprovals.filter(
    (a) => now.getTime() - new Date(a.createdAt).getTime() > 86_400_000,
  );
  if (aged.length) {
    risks.push({
      code: 'APPROVAL_AGING',
      severity: 'LOW',
      message: `${aged.length} 个审批等待超 24 小时（最早来自 ${aged[0]!.requestedBy}）`,
      evidence: { approvals: aged.map((a) => ({ id: a.id, actionType: a.actionType })) },
    });
    suggestions.push('审批积压会阻塞 agent 工作流，请尽快处理审批收件箱。');
  }

  // 5. 负载不均（max >= 3 × avg 且成员 ≥2）
  const loads = input.stats.workload.members.map((m) => ({ ...m, load: m.open + m.inProgress }));
  const activeLoads = loads.filter((l) => l.load > 0);
  if (activeLoads.length >= 2) {
    const avg = activeLoads.reduce((s, l) => s + l.load, 0) / activeLoads.length;
    const max = activeLoads.reduce((a, b) => (a.load >= b.load ? a : b));
    if (max.load >= avg * 3) {
      risks.push({
        code: 'WORKLOAD_IMBALANCE',
        severity: 'LOW',
        message: `${max.name} 负载 ${max.load} 项，是平均（${avg.toFixed(1)}）的 3 倍以上`,
        evidence: { loads },
      });
      suggestions.push(`考虑把 ${max.name} 的部分任务释放给空闲成员或 agent。`);
    }
  }

  // 6. agent 失联（有在办任务但心跳 >30min）
  const silent = input.stats.agents.filter(
    (a) =>
      a.activeIssues > 0 &&
      (!a.lastHeartbeatAt || now.getTime() - new Date(a.lastHeartbeatAt).getTime() > 30 * 60_000),
  );
  if (silent.length) {
    risks.push({
      code: 'AGENT_SILENT',
      severity: 'MEDIUM',
      message: `${silent.map((a) => a.name).join('、')} 持有任务但心跳超 30 分钟`,
      evidence: { agents: silent.map((a) => ({ name: a.name, activeIssues: a.activeIssues })) },
    });
    suggestions.push('检查失联 agent 的运行状态；长时间无响应可由管理员释放其任务。');
  }

  const t = input.stats.totals;
  const headline = `${input.projectName}：完成率 ${t.completionRate}%（${t.done}/${t.total}），进行中 ${t.inProgress}、待办 ${t.todo}、未指派 ${input.stats.workload.unassigned}，7 日活跃 ${input.stats.activity7d.total} 条`;
  return { risks, suggestions, headline };
}
