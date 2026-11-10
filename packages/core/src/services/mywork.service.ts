import type { Ctx } from '../ctx.js';

/**
 * 我的工作（M6）：跨项目聚合指派给我 / 我关注 / 我报告的 issue。
 * 这是第一个跨项目 issue 查询（此前所有 issue.findMany 都限定 projectId）。
 */

export interface MyWorkItem {
  issueKey: string;
  title: string;
  type: string;
  state: string;
  stateCategory: string;
  priority: string;
  projectKey: string;
  projectName: string;
  updatedAt: Date;
}

/** 未完成优先、其余按更新时间倒序。 */
function sortOpenFirst(items: MyWorkItem[]): MyWorkItem[] {
  return [...items].sort((a, b) => {
    const aOpen = a.stateCategory !== 'DONE' ? 0 : 1;
    const bOpen = b.stateCategory !== 'DONE' ? 0 : 1;
    if (aOpen !== bOpen) return aOpen - bOpen;
    return b.updatedAt.getTime() - a.updatedAt.getTime();
  });
}

function toItem(i: {
  issueKey: string;
  title: string;
  type: string;
  priority: string;
  updatedAt: Date;
  project: { key: string; name: string };
  state: { name: string; category: string };
}): MyWorkItem {
  return {
    issueKey: i.issueKey,
    title: i.title,
    type: i.type,
    state: i.state.name,
    stateCategory: i.state.category,
    priority: i.priority,
    projectKey: i.project.key,
    projectName: i.project.name,
    updatedAt: i.updatedAt,
  };
}

export async function myWork(ctx: Ctx) {
  if (!ctx.actorId) throw new Error('unauthorized');
  const me = ctx.actorId;

  const base = {
    orderBy: { updatedAt: 'desc' as const },
    take: 300,
    include: {
      project: { select: { key: true, name: true } },
      state: { select: { name: true, category: true } },
    },
  };

  const [assigned, watching, reported] = await Promise.all([
    ctx.db.issue.findMany({ ...base, where: { assigneeId: me } }),
    ctx.db.issue.findMany({ ...base, where: { watchers: { some: { actorId: me } } } }),
    ctx.db.issue.findMany({ ...base, where: { reporterId: me } }),
  ]);

  return {
    assigned: sortOpenFirst(assigned.map(toItem)),
    watching: sortOpenFirst(watching.map(toItem)),
    reported: sortOpenFirst(reported.map(toItem)),
  };
}
