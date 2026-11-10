import { AppError } from '@agentpm/shared';
import { Prisma } from '@agentpm/db';
import type { Ctx } from '../ctx.js';
import { requireProjectMembership } from './project.service.js';
import { getIssueOr404 } from './issue.service.js';

/**
 * 自定义字段（M6）：项目级字段定义 + issue 级值。
 * type: text | number | date | select；appliesTo: ["ALL"] 或 IssueType 子集。
 */
export type CustomFieldType = 'text' | 'number' | 'date' | 'select';

export interface CreateFieldInput {
  name: string;
  type: CustomFieldType;
  options?: string[];
  appliesTo?: string[];
}

/** 项目 ADMIN+ 守卫（管理类操作）。 */
export async function requireProjectAdmin(ctx: Ctx, projectKey: string) {
  const { member } = await requireProjectMembership(ctx, projectKey, 'MEMBER');
  if (member?.role !== 'ADMIN' && member?.role !== 'OWNER')
    throw AppError.forbidden('需要项目 ADMIN 及以上权限', 'ADMIN_REQUIRED');
  return member;
}

export async function createField(ctx: Ctx, projectKey: string, input: CreateFieldInput) {
  await requireProjectAdmin(ctx, projectKey);
  const { project } = await requireProjectMembership(ctx, projectKey);
  if (input.type === 'select' && (input.options?.length ?? 0) === 0)
    throw AppError.badRequest('select 类型字段必须提供选项', 'OPTIONS_REQUIRED');
  const dup = await ctx.db.customFieldDef.findFirst({
    where: { projectId: project.id, name: input.name },
  });
  if (dup) throw AppError.conflict(`字段 ${input.name} 已存在`, 'FIELD_EXISTS');
  const count = await ctx.db.customFieldDef.count({ where: { projectId: project.id } });
  return ctx.db.customFieldDef.create({
    data: {
      projectId: project.id,
      name: input.name,
      type: input.type,
      options: input.options ?? [],
      appliesTo: input.appliesTo ?? ['ALL'],
      sortOrder: count,
    },
  });
}

export async function listFields(ctx: Ctx, projectKey: string) {
  const { project } = await requireProjectMembership(ctx, projectKey);
  const fields = await ctx.db.customFieldDef.findMany({
    where: { projectId: project.id },
    orderBy: { sortOrder: 'asc' },
  });
  return fields.map((f) => ({
    id: f.id,
    name: f.name,
    type: f.type as CustomFieldType,
    options: f.options,
    appliesTo: f.appliesTo,
    sortOrder: f.sortOrder,
  }));
}

export async function updateField(
  ctx: Ctx,
  projectKey: string,
  fieldId: string,
  input: Partial<CreateFieldInput>,
) {
  await requireProjectAdmin(ctx, projectKey);
  const { project } = await requireProjectMembership(ctx, projectKey);
  const field = await ctx.db.customFieldDef.findFirst({
    where: { id: fieldId, projectId: project.id },
  });
  if (!field) throw AppError.notFound('字段不存在', 'FIELD_NOT_FOUND');
  return ctx.db.customFieldDef.update({
    where: { id: field.id },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.options !== undefined ? { options: input.options } : {}),
      ...(input.appliesTo !== undefined ? { appliesTo: input.appliesTo } : {}),
    },
  });
}

export async function deleteField(ctx: Ctx, projectKey: string, fieldId: string) {
  await requireProjectAdmin(ctx, projectKey);
  const { project } = await requireProjectMembership(ctx, projectKey);
  const field = await ctx.db.customFieldDef.findFirst({
    where: { id: fieldId, projectId: project.id },
  });
  if (!field) throw AppError.notFound('字段不存在', 'FIELD_NOT_FOUND');
  await ctx.db.customFieldDef.delete({ where: { id: field.id } });
  return { ok: true };
}

function validateValue(
  type: string,
  options: unknown,
  value: unknown,
): { ok: true; stored: string | number | null } | { ok: false; error: string } {
  if (value === null || value === undefined || value === '') return { ok: true, stored: null };
  switch (type) {
    case 'text': {
      if (typeof value !== 'string') return { ok: false, error: '必须是字符串' };
      return { ok: true, stored: value.slice(0, 1000) };
    }
    case 'number': {
      const n = Number(value);
      if (!Number.isFinite(n)) return { ok: false, error: '必须是数字' };
      return { ok: true, stored: n };
    }
    case 'date': {
      const d = new Date(String(value));
      if (Number.isNaN(d.getTime())) return { ok: false, error: '必须是合法日期' };
      return { ok: true, stored: d.toISOString().slice(0, 10) };
    }
    case 'select': {
      const opts = (Array.isArray(options) ? options : []) as string[];
      if (typeof value !== 'string' || !opts.includes(value))
        return { ok: false, error: `必须是选项之一：${opts.join('、')}` };
      return { ok: true, stored: value };
    }
    default:
      return { ok: false, error: `未知字段类型 ${type}` };
  }
}

/** 设置 issue 的自定义字段值（部分更新：只覆盖传入的 fieldId）。 */
export async function setFieldValues(ctx: Ctx, issueKey: string, values: Record<string, unknown>) {
  const issue = await getIssueOr404(ctx, issueKey);
  const project = await ctx.db.project.findUniqueOrThrow({
    where: { id: issue.projectId },
    select: { key: true },
  });
  await requireProjectMembership(ctx, project.key, 'MEMBER');

  const fields = await ctx.db.customFieldDef.findMany({
    where: { projectId: issue.projectId },
  });
  const byId = new Map(fields.map((f) => [f.id, f]));

  for (const [fieldId, raw] of Object.entries(values)) {
    const field = byId.get(fieldId);
    if (!field) throw AppError.badRequest(`字段不存在：${fieldId}`, 'FIELD_NOT_FOUND');
    const applies = (Array.isArray(field.appliesTo) ? field.appliesTo : ['ALL']) as string[];
    if (!applies.includes('ALL') && !applies.includes(issue.type))
      throw AppError.badRequest(
        `字段 ${field.name} 不适用于 ${issue.type}`,
        'FIELD_NOT_APPLICABLE',
      );
    const v = validateValue(field.type, field.options, raw);
    if (!v.ok) throw AppError.badRequest(`字段 ${field.name}：${v.error}`, 'FIELD_VALUE_INVALID');
    await ctx.db.issueFieldValue.upsert({
      where: { issueId_fieldId: { issueId: issue.id, fieldId } },
      create: {
        issueId: issue.id,
        fieldId,
        value: v.stored === null ? Prisma.JsonNull : v.stored,
      },
      update: { value: v.stored === null ? Prisma.JsonNull : v.stored },
    });
  }
  return { ok: true };
}
