import type { Member, Prisma, Project } from '@agentpm/db';
import { seedDefaultWorkflows } from '@agentpm/db';
import {
  AppError,
  type AddMemberInput,
  type CreateProjectInput,
  parseProjectSettings,
  type MemberRole,
} from '@agentpm/shared';
import type { Ctx } from '../ctx.js';
import { roleAtLeast } from '../ctx.js';
import { writeActivity } from './activity.service.js';

/** 项目访问断言：要求当前 actor 是项目成员且角色等级 >= minRole。 */
export async function requireProjectMembership(
  ctx: Ctx,
  projectKey: string,
  minRole: MemberRole = 'VIEWER',
): Promise<{ project: Project; member: Member | null }> {
  if (!ctx.actorId) throw AppError.unauthorized();
  const project = await ctx.db.project.findUnique({ where: { key: projectKey } });
  if (!project || project.archivedAt)
    throw AppError.notFound(`项目不存在：${projectKey}`, 'PROJECT_NOT_FOUND');
  const member = await ctx.db.member.findUnique({
    where: { projectId_actorId: { projectId: project.id, actorId: ctx.actorId } },
  });
  const canRead =
    !!member ||
    project.visibility === 'PUBLIC' ||
    (ctx.actorType === 'HUMAN' && (await isInstanceAdmin(ctx)));
  if (!canRead) throw AppError.forbidden('你不是该项目成员', 'NOT_A_MEMBER');
  if (member && !roleAtLeast(member.role, minRole)) {
    throw AppError.forbidden(`需要 ${minRole} 及以上角色（当前 ${member.role}）`, 'ROLE_TOO_LOW');
  }
  if (!member && minRole !== 'VIEWER') {
    throw AppError.forbidden('你不是该项目成员', 'NOT_A_MEMBER');
  }
  return { project, member };
}

async function isInstanceAdmin(ctx: Ctx): Promise<boolean> {
  if (!ctx.actorId) return false;
  const a = await ctx.db.actor.findUnique({
    where: { id: ctx.actorId },
    select: { isAdmin: true },
  });
  return !!a?.isAdmin;
}

export async function listProjectsForActor(ctx: Ctx) {
  if (!ctx.actorId) throw AppError.unauthorized();
  const memberships = await ctx.db.member.findMany({
    where: { actorId: ctx.actorId },
    include: {
      project: {
        include: {
          _count: { select: { issues: { where: { state: { category: { not: 'DONE' } } } } } },
          members: { select: { role: true } },
        },
      },
    },
    orderBy: { createdAt: 'asc' },
  });
  return memberships.map((m) => ({
    key: m.project.key,
    name: m.project.name,
    description: m.project.description,
    visibility: m.project.visibility,
    myRole: m.role,
    openIssues: m.project._count.issues,
    archived: !!m.project.archivedAt,
  }));
}

/** 创建项目：播种默认工作流 + 创建者为 OWNER。 */
export async function createProject(ctx: Ctx, input: CreateProjectInput) {
  if (!ctx.actorId) throw AppError.unauthorized();
  const dup = await ctx.db.project.findUnique({ where: { key: input.key } });
  if (dup) throw AppError.conflict(`项目 key 已存在：${input.key}`, 'PROJECT_KEY_TAKEN');

  const base = parseProjectSettings({});
  const settings = {
    ...base,
    agentPolicy: { ...base.agentPolicy, ...(input.agentPolicy ?? {}) },
  };

  const project = await ctx.db.project.create({
    data: {
      key: input.key,
      name: input.name,
      description: input.description,
      visibility: input.visibility,
      createdById: ctx.actorId,
      settings: settings as unknown as Prisma.InputJsonValue,
      members: { create: { actorId: ctx.actorId, role: 'OWNER' } },
    },
  });
  await seedDefaultWorkflows(ctx.db, project.id);

  await writeActivity(ctx, {
    projectId: project.id,
    action: 'project.created',
    summary: `创建项目 ${project.key}（${project.name}）`,
    detail: { key: project.key, name: project.name },
  });
  return project;
}

export async function getProjectDetail(ctx: Ctx, projectKey: string) {
  const { project, member } = await requireProjectMembership(ctx, projectKey);
  const members = await ctx.db.member.findMany({
    where: { projectId: project.id },
    include: {
      actor: {
        select: {
          id: true,
          name: true,
          displayName: true,
          type: true,
          isActive: true,
          avatarUrl: true,
          agentProfile: { select: { lastHeartbeatAt: true, status: true } },
        },
      },
    },
    orderBy: { createdAt: 'asc' },
  });
  const workflows = await ctx.db.workflow.findMany({
    where: { projectId: project.id },
    include: {
      states: { orderBy: { sortOrder: 'asc' } },
      transitions: {
        include: { fromState: { select: { name: true } }, toState: { select: { name: true } } },
      },
    },
  });
  return {
    project: {
      key: project.key,
      name: project.name,
      description: project.description,
      visibility: project.visibility,
      settings: parseProjectSettings(project.settings),
      archived: !!project.archivedAt,
      createdAt: project.createdAt,
    },
    myRole: member?.role ?? null,
    members: members.map((m) => ({
      name: m.actor.name,
      displayName: m.actor.displayName,
      type: m.actor.type,
      role: m.role,
      isActive: m.actor.isActive,
      avatarUrl: m.actor.avatarUrl,
      lastHeartbeatAt: m.actor.agentProfile?.lastHeartbeatAt ?? null,
    })),
    workflows: workflows.map((w) => ({
      issueType: w.issueType,
      name: w.name,
      states: w.states.map((s) => ({ name: s.name, category: s.category, isInitial: s.isInitial })),
      transitions: w.transitions.map((t) => ({
        from: t.fromState?.name ?? null,
        to: t.toState.name,
      })),
    })),
  };
}

export async function updateProject(
  ctx: Ctx,
  projectKey: string,
  input: {
    name?: string;
    description?: string | null;
    visibility?: Project['visibility'];
    archived?: boolean;
    agentPolicy?: Record<string, unknown>;
  },
) {
  const { project } = await requireProjectMembership(ctx, projectKey, 'ADMIN');
  const current = parseProjectSettings(project.settings);
  const settings =
    input.agentPolicy !== undefined
      ? { ...current, agentPolicy: { ...current.agentPolicy, ...input.agentPolicy } }
      : current;

  const updated = await ctx.db.project.update({
    where: { id: project.id },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.description !== undefined ? { description: input.description ?? null } : {}),
      ...(input.visibility !== undefined ? { visibility: input.visibility } : {}),
      ...(input.archived !== undefined ? { archivedAt: input.archived ? new Date() : null } : {}),
      settings: settings as unknown as Prisma.InputJsonValue,
    },
  });
  await writeActivity(ctx, {
    projectId: project.id,
    action: 'project.updated',
    summary: `更新项目设置${input.agentPolicy ? '（含 agent 策略）' : ''}`,
    detail: { changes: Object.keys(input) },
  });
  return updated;
}

export async function addMember(ctx: Ctx, projectKey: string, input: AddMemberInput) {
  const { project } = await requireProjectMembership(ctx, projectKey, 'ADMIN');
  const actor = await ctx.db.actor.findUnique({ where: { name: input.actorName } });
  if (!actor) throw AppError.notFound(`账号不存在：${input.actorName}`, 'ACTOR_NOT_FOUND');
  if (actor.type === 'AGENT' && input.role === 'OWNER')
    throw AppError.badRequest('agent 不能成为 OWNER', 'AGENT_CANNOT_OWN');
  if (actor.type === 'HUMAN' && input.role === 'AGENT')
    throw AppError.badRequest('AGENT 角色仅限 agent 账号', 'ROLE_NOT_MATCH');

  const dup = await ctx.db.member.findUnique({
    where: { projectId_actorId: { projectId: project.id, actorId: actor.id } },
  });
  if (dup) throw AppError.conflict(`${actor.name} 已是项目成员`, 'ALREADY_MEMBER');

  const member = await ctx.db.member.create({
    data: { projectId: project.id, actorId: actor.id, role: input.role, addedById: ctx.actorId },
  });
  await writeActivity(ctx, {
    projectId: project.id,
    action: 'member.added',
    summary: `添加成员 ${actor.name}（${input.role}）`,
    detail: { actorName: actor.name, role: input.role },
  });
  return member;
}

export async function removeMember(ctx: Ctx, projectKey: string, actorName: string) {
  const { project } = await requireProjectMembership(ctx, projectKey, 'ADMIN');
  const member = await ctx.db.member.findFirst({
    where: { project: { key: projectKey }, actor: { name: actorName } },
  });
  if (!member) throw AppError.notFound('成员不存在', 'NOT_A_MEMBER');
  if (member.role === 'OWNER') throw AppError.badRequest('不能移除 OWNER', 'OWNER_IMMUTABLE');
  await ctx.db.member.delete({ where: { id: member.id } });
  await writeActivity(ctx, {
    projectId: project.id,
    action: 'member.removed',
    summary: `移除成员 ${actorName}`,
  });
  return { ok: true };
}

export async function changeMemberRole(
  ctx: Ctx,
  projectKey: string,
  actorName: string,
  role: MemberRole,
) {
  const { project } = await requireProjectMembership(ctx, projectKey, 'ADMIN');
  const member = await ctx.db.member.findFirst({
    where: { projectId: project.id, actor: { name: actorName } },
  });
  if (!member) throw AppError.notFound('成员不存在', 'NOT_A_MEMBER');
  if (member.role === 'OWNER') throw AppError.badRequest('不能变更 OWNER 角色', 'OWNER_IMMUTABLE');
  const actor = await ctx.db.actor.findUniqueOrThrow({ where: { id: member.actorId } });
  if (actor.type === 'HUMAN' && role === 'AGENT')
    throw AppError.badRequest('AGENT 角色仅限 agent', 'ROLE_NOT_MATCH');
  const updated = await ctx.db.member.update({ where: { id: member.id }, data: { role } });
  await writeActivity(ctx, {
    projectId: project.id,
    action: 'member.role_changed',
    summary: `${actorName} 角色变更为 ${role}`,
  });
  return updated;
}
