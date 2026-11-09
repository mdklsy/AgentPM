import { CreateAgentSchema, CreateTokenSchema, HeartbeatSchema } from '@agentpm/shared';
import {
  createAgent,
  createToken,
  heartbeat,
  listAgents,
  listTokens,
  revokeToken,
} from '@agentpm/core';
import { requireAuth } from '../plugins/auth.js';
import { makeCtx } from '../ctx.js';
import type { FastifyApp } from '../types.js';

export function registerActorRoutes(app: FastifyApp) {
  /* ---------------- tokens ---------------- */

  app.get('/v1/tokens', async (req) => {
    const actor = requireAuth(req);
    return { tokens: await listTokens(makeCtx(app, req), actor.id) };
  });

  app.post('/v1/tokens', async (req, reply) => {
    const actor = requireAuth(req, 'write');
    const input = CreateTokenSchema.parse(req.body);
    const { token, plaintext } = await createToken(makeCtx(app, req), actor.id, input);
    return reply.status(201).send({ token, plaintext });
  });

  app.delete('/v1/tokens/:id', async (req) => {
    const actor = requireAuth(req, 'write');
    const { id } = req.params as { id: string };
    return revokeToken(makeCtx(app, req), actor.id, id);
  });

  /* ---------------- agents ---------------- */

  app.get('/v1/agents', async (req) => {
    requireAuth(req);
    return { agents: await listAgents(makeCtx(app, req)) };
  });

  app.post('/v1/agents', async (req, reply) => {
    const actor = requireAuth(req, 'write');
    if (actor.type !== 'HUMAN') {
      return reply
        .status(400)
        .send({ error: { code: 'HUMAN_ONLY', message: '只有人类用户可以创建 agent' } });
    }
    const input = CreateAgentSchema.parse(req.body);
    const { agent, token } = await createAgent(makeCtx(app, req), input);
    return reply.status(201).send({
      agent: {
        name: agent.name,
        displayName: agent.displayName,
        owner: actor.name,
        description: input.description,
      },
      token,
      note: 'token 明文仅此一次返回，请立即保存',
    });
  });

  app.post('/v1/agents/heartbeat', async (req) => {
    requireAuth(req, 'write');
    const input = HeartbeatSchema.parse(req.body);
    return heartbeat(makeCtx(app, req), input);
  });
}
