import { z } from 'zod';
import {
  AddMemberSchema,
  ApprovalDecisionSchema,
  CreateProjectSchema,
  CreateSprintSchema,
  UpdateMemberSchema,
  UpdateProjectSchema,
} from '@agentpm/shared';
import {
  addMember,
  changeMemberRole,
  createProject,
  createSprint,
  decideApproval,
  getCurrentSprint,
  getProjectDetail,
  listApprovals,
  listBacklog,
  listProjectsForActor,
  listSprints,
  projectStats,
  queryActivities,
  removeMember,
  setIssueSprint,
  setSprintStatus,
  sprintBurndown,
  updateProject,
  velocity,
} from '@agentpm/core';
import { requireAuth } from '../plugins/auth.js';
import { makeCtx } from '../ctx.js';
import type { FastifyApp } from '../types.js';

export function registerProjectRoutes(app: FastifyApp) {
  app.get('/v1/projects', async (req) => {
    requireAuth(req);
    return { projects: await listProjectsForActor(makeCtx(app, req)) };
  });

  app.post('/v1/projects', async (req, reply) => {
    requireAuth(req, 'write');
    const input = CreateProjectSchema.parse(req.body);
    const project = await createProject(makeCtx(app, req), input);
    return reply.status(201).send({ project: { key: project.key, name: project.name } });
  });

  app.get('/v1/projects/:key', async (req) => {
    requireAuth(req);
    const { key } = req.params as { key: string };
    return getProjectDetail(makeCtx(app, req), key);
  });

  app.patch('/v1/projects/:key', async (req) => {
    requireAuth(req, 'write');
    const { key } = req.params as { key: string };
    const input = UpdateProjectSchema.parse(req.body);
    const updated = await updateProject(makeCtx(app, req), key, input);
    return { project: { key: updated.key, name: updated.name } };
  });

  /* ---------------- members ---------------- */

  app.post('/v1/projects/:key/members', async (req) => {
    requireAuth(req, 'write');
    const { key } = req.params as { key: string };
    const input = AddMemberSchema.parse(req.body);
    const member = await addMember(makeCtx(app, req), key, input);
    return { member: { actor: input.actorName, role: member.role } };
  });

  app.patch('/v1/projects/:key/members/:actorName', async (req) => {
    requireAuth(req, 'write');
    const { key, actorName } = req.params as { key: string; actorName: string };
    const input = UpdateMemberSchema.parse(req.body);
    const member = await changeMemberRole(makeCtx(app, req), key, actorName, input.role);
    return { member: { actor: actorName, role: member.role } };
  });

  app.delete('/v1/projects/:key/members/:actorName', async (req) => {
    requireAuth(req, 'write');
    const { key, actorName } = req.params as { key: string; actorName: string };
    return removeMember(makeCtx(app, req), key, actorName);
  });

  /* ---------------- stats / activity ---------------- */

  app.get('/v1/projects/:key/stats', async (req) => {
    requireAuth(req);
    const { key } = req.params as { key: string };
    return projectStats(makeCtx(app, req), key);
  });

  app.get('/v1/projects/:key/activities', async (req) => {
    requireAuth(req);
    const { key } = req.params as { key: string };
    const { project, items } = await queryActivities(makeCtx(app, req), key, req.query);
    if (!project) return { items: [] };
    return {
      items: items.map((a) => ({
        id: a.id,
        action: a.action,
        summary: a.summary,
        source: a.source,
        actor: a.actor ? { name: a.actor.name, type: a.actor.type } : null,
        issue: a.issue?.issueKey ?? null,
        createdAt: a.createdAt,
      })),
    };
  });

  /* ---------------- sprints ---------------- */

  app.get('/v1/projects/:key/sprints', async (req) => {
    requireAuth(req);
    const { key } = req.params as { key: string };
    return { sprints: await listSprints(makeCtx(app, req), key) };
  });

  app.get('/v1/projects/:key/sprints/current', async (req) => {
    requireAuth(req);
    const { key } = req.params as { key: string };
    return { sprint: await getCurrentSprint(makeCtx(app, req), key) };
  });

  app.post('/v1/projects/:key/sprints', async (req, reply) => {
    requireAuth(req, 'write');
    const { key } = req.params as { key: string };
    const input = CreateSprintSchema.parse(req.body);
    const sprint = await createSprint(makeCtx(app, req), key, input);
    return reply
      .status(201)
      .send({ sprint: { id: sprint.id, name: sprint.name, status: sprint.status } });
  });

  app.patch('/v1/projects/:key/sprints/:id/status', async (req) => {
    requireAuth(req, 'write');
    const { key, id } = req.params as { key: string; id: string };
    const { status } = z
      .object({ status: z.enum(['PLANNED', 'ACTIVE', 'COMPLETED']) })
      .parse(req.body);
    const r = await setSprintStatus(makeCtx(app, req), key, id, status);
    return {
      sprint: { id: r.sprint.id, name: r.sprint.name, status: r.sprint.status },
      returnedToBacklog: r.returnedToBacklog,
    };
  });

  app.get('/v1/projects/:key/sprints/:id/burndown', async (req) => {
    requireAuth(req);
    const { key, id } = req.params as { key: string; id: string };
    return sprintBurndown(makeCtx(app, req), key, id);
  });

  app.get('/v1/projects/:key/velocity', async (req) => {
    requireAuth(req);
    const { key } = req.params as { key: string };
    return velocity(makeCtx(app, req), key);
  });

  app.post('/v1/issues/:issueKey/sprint', async (req) => {
    requireAuth(req, 'write');
    const { issueKey } = req.params as { issueKey: string };
    const { sprintId } = z.object({ sprintId: z.string().nullable() }).parse(req.body);
    return setIssueSprint(makeCtx(app, req), issueKey, sprintId);
  });

  app.get('/v1/projects/:key/backlog', async (req) => {
    requireAuth(req);
    const { key } = req.params as { key: string };
    const q = req.query as { type?: string; label?: string };
    return { backlog: await listBacklog(makeCtx(app, req), key, q) };
  });

  /* ---------------- approvals ---------------- */

  app.get('/v1/projects/:key/approvals', async (req) => {
    requireAuth(req);
    const { key } = req.params as { key: string };
    const q = req.query as {
      status?: 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED';
      mine?: string;
    };
    return {
      approvals: await listApprovals(makeCtx(app, req), key, {
        status: q.status,
        onlyMine: q.mine === 'true',
      }),
    };
  });

  app.post('/v1/approvals/:id/decision', async (req) => {
    requireAuth(req, 'write');
    const { id } = req.params as { id: string };
    const input = ApprovalDecisionSchema.parse(req.body);
    return decideApproval(makeCtx(app, req), id, input);
  });
}
