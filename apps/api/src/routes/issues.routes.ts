import {
  AppError,
  AssignIssueSchema,
  BugReportSchema,
  ClaimIssueSchema,
  CreateCommentSchema,
  CreateIssueSchema,
  LinkIssueSchema,
  ProgressReportSchema,
  RegressionSubmitSchema,
  SearchIssuesQuerySchema,
  TransitionIssueSchema,
  UpdateIssueSchema,
} from '@agentpm/shared';
import {
  addComment,
  assignIssue,
  claimIssue,
  createIssue,
  getIssue,
  getRun,
  linkIssue,
  listRuns,
  releaseIssue,
  reportBug,
  reportProgress,
  searchIssues,
  submitRegression,
  transitionIssue,
  updateIssue,
  watchIssue,
} from '@agentpm/core';
import { requireAuth } from '../plugins/auth.js';
import { makeCtx } from '../ctx.js';
import type { FastifyApp } from '../types.js';

export function registerIssueRoutes(app: FastifyApp) {
  /* ---------------- list / create ---------------- */

  app.get('/v1/projects/:key/issues', async (req) => {
    requireAuth(req);
    const { key } = req.params as { key: string };
    const query = SearchIssuesQuerySchema.parse(req.query ?? {});
    return searchIssues(makeCtx(app, req), key, query);
  });

  app.post('/v1/projects/:key/issues', async (req, reply) => {
    requireAuth(req, 'write');
    const { key } = req.params as { key: string };
    const input = CreateIssueSchema.parse(req.body);
    const issue = await createIssue(makeCtx(app, req), key, input);
    return reply.status(201).send({ issue });
  });

  /* ---------------- single issue ---------------- */

  app.get('/v1/issues/:issueKey', async (req) => {
    requireAuth(req);
    const { issueKey } = req.params as { issueKey: string };
    return { issue: await getIssue(makeCtx(app, req), issueKey) };
  });

  app.patch('/v1/issues/:issueKey', async (req) => {
    requireAuth(req, 'write');
    const { issueKey } = req.params as { issueKey: string };
    const input = UpdateIssueSchema.parse(req.body);
    return { issue: await updateIssue(makeCtx(app, req), issueKey, input) };
  });

  app.post('/v1/issues/:issueKey/transition', async (req) => {
    requireAuth(req, 'write');
    const { issueKey } = req.params as { issueKey: string };
    const input = TransitionIssueSchema.parse(req.body);
    return transitionIssue(makeCtx(app, req), issueKey, input.toState, input.comment);
  });

  app.post('/v1/issues/:issueKey/assign', async (req) => {
    requireAuth(req, 'write');
    const { issueKey } = req.params as { issueKey: string };
    const input = AssignIssueSchema.parse(req.body);
    return { issue: await assignIssue(makeCtx(app, req), issueKey, input.assigneeName) };
  });

  app.post('/v1/issues/:issueKey/release', async (req) => {
    requireAuth(req, 'write');
    const { issueKey } = req.params as { issueKey: string };
    const { reason } = (req.body ?? {}) as { reason?: string };
    return { issue: await releaseIssue(makeCtx(app, req), issueKey, reason) };
  });

  app.post('/v1/issues/:issueKey/link', async (req) => {
    requireAuth(req, 'write');
    const { issueKey } = req.params as { issueKey: string };
    const input = LinkIssueSchema.parse(req.body);
    return linkIssue(makeCtx(app, req), issueKey, input.toIssueKey, input.type);
  });

  app.post('/v1/issues/:issueKey/watch', async (req) => {
    requireAuth(req);
    const { issueKey } = req.params as { issueKey: string };
    const { watch } = (req.body ?? {}) as { watch?: boolean };
    return watchIssue(makeCtx(app, req), issueKey, watch !== false);
  });

  /* ---------------- comments / progress ---------------- */

  app.post('/v1/issues/:issueKey/comments', async (req, reply) => {
    requireAuth(req, 'write');
    const { issueKey } = req.params as { issueKey: string };
    const input = CreateCommentSchema.parse(req.body);
    const comment = await addComment(makeCtx(app, req), issueKey, input);
    return reply.status(201).send({
      comment: {
        author: comment.author.name,
        authorType: comment.author.type,
        body: comment.body,
        evidence: comment.evidence,
        createdAt: comment.createdAt,
      },
    });
  });

  app.post('/v1/issues/:issueKey/progress', async (req) => {
    requireAuth(req, 'write');
    const { issueKey } = req.params as { issueKey: string };
    const input = ProgressReportSchema.parse(req.body);
    return reportProgress(makeCtx(app, req), issueKey, input);
  });

  /* ---------------- claim（两个入口：项目级抢单 / 指定 issue） ---------------- */

  app.post('/v1/projects/:key/claim', async (req) => {
    requireAuth(req, 'write');
    const { key } = req.params as { key: string };
    const input = ClaimIssueSchema.parse(req.body ?? {});
    return claimIssue(makeCtx(app, req), key, input);
  });

  app.post('/v1/issues/:issueKey/claim', async (req) => {
    requireAuth(req, 'write');
    const { issueKey } = req.params as { issueKey: string };
    const issue = await app.db.issue.findUnique({
      where: { issueKey },
      include: { project: { select: { key: true } } },
    });
    if (!issue) throw AppError.notFound(`issue 不存在：${issueKey}`, 'ISSUE_NOT_FOUND');
    return claimIssue(makeCtx(app, req), issue.project.key, { issueKey });
  });

  /* ---------------- bug.report（REST 等价入口） ---------------- */

  app.post('/v1/projects/:key/bugs', async (req, reply) => {
    requireAuth(req, 'write');
    const { key } = req.params as { key: string };
    const input = BugReportSchema.parse(req.body);
    const result = await reportBug(makeCtx(app, req), key, input);
    return reply.status(result.status === 'created' ? 201 : 200).send(result);
  });

  /* ---------------- 回归 ---------------- */

  app.post(
    '/v1/projects/:key/regression-runs',
    { bodyLimit: 8 * 1024 * 1024 },
    async (req, reply) => {
      requireAuth(req, 'write');
      const { key } = req.params as { key: string };
      const input = RegressionSubmitSchema.parse(req.body);
      const result = await submitRegression(makeCtx(app, req), key, input);
      return reply.status(201).send(result);
    },
  );

  app.get('/v1/projects/:key/regression-runs', async (req) => {
    requireAuth(req);
    const { key } = req.params as { key: string };
    return { runs: await listRuns(makeCtx(app, req), key) };
  });

  app.get('/v1/projects/:key/regression-runs/:id', async (req) => {
    requireAuth(req);
    const { key, id } = req.params as { key: string; id: string };
    return getRun(makeCtx(app, req), key, id);
  });
}
