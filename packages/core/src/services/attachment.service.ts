import { AppError } from '@agentpm/shared';
import type { Ctx } from '../ctx.js';
import { requireProjectMembership } from './project.service.js';
import { getIssueOr404 } from './issue.service.js';

/**
 * 附件（M6）：文件落盘在 API 层（磁盘文件名 = 附件 id，目录 <ATTACHMENTS_DIR>），
 * 本服务管元数据与权限；url 存服务端相对下载路径。
 */

export interface CreateAttachmentInput {
  issueKey: string;
  name: string;
  mimeType?: string;
  sizeBytes: number;
}

/** 校验 issue 访问权并返回 issue。 */
async function accessIssue(ctx: Ctx, issueKey: string, minRole: 'VIEWER' | 'MEMBER') {
  const issue = await getIssueOr404(ctx, issueKey);
  const project = await ctx.db.project.findUniqueOrThrow({
    where: { id: issue.projectId },
    select: { key: true },
  });
  await requireProjectMembership(ctx, project.key, minRole);
  return issue;
}

/** 创建记录（拿到 id 后 API 层以 id 为文件名落盘）。 */
export async function addAttachment(ctx: Ctx, input: CreateAttachmentInput) {
  const issue = await accessIssue(ctx, input.issueKey, 'MEMBER');
  if (!ctx.actorId) throw AppError.unauthorized();
  const att = await ctx.db.attachment.create({
    data: {
      issueId: issue.id,
      name: input.name,
      url: '', // 落盘后由 API 层补
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      uploadedById: ctx.actorId,
    },
  });
  const url = `/v1/issues/${input.issueKey}/attachments/${att.id}/download`;
  return ctx.db.attachment.update({ where: { id: att.id }, data: { url } });
}

export async function listAttachments(ctx: Ctx, issueKey: string) {
  const issue = await accessIssue(ctx, issueKey, 'VIEWER');
  const rows = await ctx.db.attachment.findMany({
    where: { issueId: issue.id },
    orderBy: { createdAt: 'desc' },
    include: { uploadedBy: { select: { name: true } } },
  });
  return rows.map((a) => ({
    id: a.id,
    name: a.name,
    url: a.url,
    mimeType: a.mimeType,
    sizeBytes: a.sizeBytes,
    uploadedBy: a.uploadedBy.name,
    createdAt: a.createdAt,
  }));
}

export type AttachmentRow = Awaited<ReturnType<typeof listAttachments>>[number];

/** 删除：上传者本人或项目 ADMIN+；返回记录（API 层负责删磁盘文件）。 */
export async function deleteAttachment(ctx: Ctx, issueKey: string, attachmentId: string) {
  const issue = await accessIssue(ctx, issueKey, 'MEMBER');
  const att = await ctx.db.attachment.findFirst({
    where: { id: attachmentId, issueId: issue.id },
  });
  if (!att) throw AppError.notFound('附件不存在', 'ATTACHMENT_NOT_FOUND');
  if (att.uploadedById !== ctx.actorId) {
    const member = await ctx.db.member.findFirst({
      where: { projectId: issue.projectId, actorId: ctx.actorId ?? '' },
    });
    if (member?.role !== 'ADMIN' && member?.role !== 'OWNER')
      throw AppError.forbidden('只能删除自己上传的附件', 'NOT_UPLOADER');
  }
  await ctx.db.attachment.delete({ where: { id: att.id } });
  return att;
}

/** 按 id 查附件（下载路由用；校验 issue 访问权）。 */
export async function getAttachment(ctx: Ctx, issueKey: string, attachmentId: string) {
  const issue = await accessIssue(ctx, issueKey, 'VIEWER');
  const att = await ctx.db.attachment.findFirst({
    where: { id: attachmentId, issueId: issue.id },
  });
  if (!att) throw AppError.notFound('附件不存在', 'ATTACHMENT_NOT_FOUND');
  return att;
}
