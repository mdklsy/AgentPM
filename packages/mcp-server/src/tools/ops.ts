import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { heartbeat, listApprovals, type Ctx } from '@agentpm/core';
import { json } from '../server.js';

export function registerOpsTools(server: McpServer, ctx: Ctx) {
  server.registerTool(
    'agent.heartbeat',
    {
      title: '心跳',
      description:
        '上报 agent 存活状态与当前任务列表（服务端会校验任务确实领取中）。建议每 1-5 分钟调用一次，供监控面板展示。',
      inputSchema: {
        status: z.enum(['active', 'idle', 'paused']).optional(),
        currentIssueKeys: z.array(z.string()).optional(),
      },
    },
    async (args) => json(await heartbeat(ctx, args)),
  );

  server.registerTool(
    'approvals.list',
    {
      title: '我的审批',
      description:
        '查看我（当前 agent）发起的审批请求及状态——提 bug / 完成流转被策略拦截时在这里跟进。',
      inputSchema: {
        projectKey: z.string(),
        status: z
          .enum(['PENDING', 'APPROVED', 'REJECTED', 'EXPIRED'])
          .optional()
          .describe('默认 PENDING'),
      },
    },
    async ({ projectKey, status }) =>
      json({
        approvals: await listApprovals(ctx, projectKey, {
          status: status ?? 'PENDING',
          onlyMine: true,
        }),
      }),
  );
}
