import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { join } from 'node:path';
import { AppError } from '@agentpm/shared';
import { addAttachment, deleteAttachment, getAttachment, listAttachments } from '@agentpm/core';
import { requireAuth } from '../plugins/auth.js';
import { makeCtx } from '../ctx.js';
import type { FastifyApp } from '../types.js';

const MAX_SIZE = 20 * 1024 * 1024; // 20MB

/**
 * 附件（M6）：multipart 上传 → 先建元数据记录（磁盘文件名 = 记录 id）→ 再写文件。
 * 下载按 id 查记录校验权限后流式返回。
 */
export function registerAttachmentRoutes(app: FastifyApp) {
  app.post('/v1/issues/:key/attachments', async (req, reply) => {
    requireAuth(req, 'write');
    const { key } = req.params as { key: string };
    const ctx = makeCtx(app, req);
    const file = await req.file({ limits: { fileSize: MAX_SIZE } });
    if (!file) throw AppError.badRequest('缺少文件（multipart/form-data，字段名 file）', 'NO_FILE');

    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of file.file) {
      size += chunk.length;
      chunks.push(chunk as Buffer);
    }
    // busboy 超 limits.fileSize 会静默截断流：必须显式检查 truncated
    if (file.file.truncated || size > MAX_SIZE)
      throw AppError.badRequest('附件不能超过 20MB', 'FILE_TOO_LARGE');

    const att = await addAttachment(ctx, {
      issueKey: key,
      name: file.filename.slice(0, 255),
      mimeType: file.mimetype,
      sizeBytes: size,
    });
    await mkdir(app.config.attachmentsDir, { recursive: true });
    await writeFile(join(app.config.attachmentsDir, att.id), Buffer.concat(chunks));
    return reply
      .status(201)
      .send({ attachment: { id: att.id, name: att.name, sizeBytes: size, url: att.url } });
  });

  app.get('/v1/issues/:key/attachments', async (req) => {
    requireAuth(req);
    const { key } = req.params as { key: string };
    return { attachments: await listAttachments(makeCtx(app, req), key) };
  });

  app.get('/v1/issues/:key/attachments/:id/download', async (req, reply) => {
    requireAuth(req);
    const { key, id } = req.params as { key: string; id: string };
    const att = await getAttachment(makeCtx(app, req), key, id);
    return reply
      .type(att.mimeType ?? 'application/octet-stream')
      .header('content-disposition', `attachment; filename*=UTF-8''${encodeURIComponent(att.name)}`)
      .send(createReadStream(join(app.config.attachmentsDir, att.id)));
  });

  app.delete('/v1/issues/:key/attachments/:id', async (req) => {
    requireAuth(req, 'write');
    const { key, id } = req.params as { key: string; id: string };
    const att = await deleteAttachment(makeCtx(app, req), key, id);
    await unlink(join(app.config.attachmentsDir, att.id)).catch(() => {});
    return { ok: true };
  });
}
