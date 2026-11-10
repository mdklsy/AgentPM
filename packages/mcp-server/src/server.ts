import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  agileReport,
  getCurrentSprint,
  getProjectDetail,
  listBacklog,
  listProjectsForActor,
  listSprints,
  myWork,
  projectStats,
  queryActivities,
  searchIssues,
  type Ctx,
} from '@agentpm/core';
import { registerIssueTools } from './tools/issues.js';
import { registerQualityTools } from './tools/quality.js';
import { registerOpsTools } from './tools/ops.js';

export const MCP_SERVER_INFO = { name: 'agentpm', version: '0.1.0' } as const;

/**
 * 创建一个 MCP server 实例（传输无关）。
 * Streamable HTTP 端点（apps/api）与 stdio 网关共用此工厂。
 * 注意：stateless 模式下每个请求新建实例；ctx 携带本次调用的 agent 身份与审计上下文。
 */
export function createAgentPmMcpServer(opts: { ctx: Ctx }): McpServer {
  const server = new McpServer(MCP_SERVER_INFO, { capabilities: { resources: {} } });
  const ctx = opts.ctx;

  /* ------------------------- project.* ------------------------- */

  server.registerTool(
    'project.list',
    {
      title: '列出我的项目',
      description: '列出当前身份有成员身份的项目（含角色与未完成 issue 数）。',
      inputSchema: {},
    },
    async () => json({ projects: await listProjectsForActor(ctx) }),
  );

  server.registerTool(
    'project.get',
    {
      title: '项目详情',
      description: '项目设置（含 agent 策略）、成员列表、各 issue 类型的工作流状态机。',
      inputSchema: { projectKey: z.string().describe('项目 key，如 APM') },
    },
    async ({ projectKey }) => json(await getProjectDetail(ctx, projectKey)),
  );

  server.registerTool(
    'project.stats',
    {
      title: '项目统计',
      description:
        '整体进度、按类型/优先级分布、人机负载分配、agent 心跳、7 日活跃度、当前 sprint 概览。监控 PM 用。',
      inputSchema: { projectKey: z.string() },
    },
    async ({ projectKey }) => json(await projectStats(ctx, projectKey)),
  );

  server.registerTool(
    'project.activity',
    {
      title: '项目活动流',
      description: '最近的人机活动审计（可按 actor / 来源过滤）。',
      inputSchema: {
        projectKey: z.string(),
        limit: z.number().int().min(1).max(200).optional().describe('默认 50'),
        actor: z.string().optional().describe('按账号名过滤'),
        source: z.enum(['WEB', 'API', 'MCP', 'SYSTEM']).optional(),
      },
    },
    async ({ projectKey, ...rest }) => {
      const { items } = await queryActivities(ctx, projectKey, rest);
      return json({
        items: items.map((a) => ({
          action: a.action,
          summary: a.summary,
          source: a.source,
          actor: a.actor ? `${a.actor.name}(${a.actor.type})` : null,
          issue: a.issue?.issueKey ?? null,
          createdAt: a.createdAt,
        })),
      });
    },
  );

  /* ------------------------- sprint / backlog ------------------------- */

  server.registerTool(
    'sprint.list',
    {
      title: 'Sprint 列表',
      description: '项目全部 sprint。',
      inputSchema: { projectKey: z.string() },
    },
    async ({ projectKey }) => json({ sprints: await listSprints(ctx, projectKey) }),
  );

  server.registerTool(
    'sprint.current',
    {
      title: '当前 Sprint',
      description: '当前 ACTIVE sprint 及其 issue 概览（含三列统计）。',
      inputSchema: { projectKey: z.string() },
    },
    async ({ projectKey }) => json({ sprint: await getCurrentSprint(ctx, projectKey) }),
  );

  server.registerTool(
    'report.agile',
    {
      title: '敏捷报表',
      description:
        '周期时长（控制图数据）、累积流图逐日快照、Epic 进度（递归子孙）。agent 汇报或巡检时用。',
      inputSchema: { projectKey: z.string() },
    },
    async ({ projectKey }) => json(await agileReport(ctx, projectKey)),
  );

  server.registerTool(
    'my.work',
    {
      title: '我的工作',
      description: '跨项目聚合：指派给我 / 我关注 / 我报告的 issue。',
      inputSchema: {},
    },
    async () => json(await myWork(ctx)),
  );

  server.registerTool(
    'backlog.list',
    {
      title: 'Backlog',
      description: '未排期且未完成的 issue（抢单的主要入口）。',
      inputSchema: {
        projectKey: z.string(),
        type: z.enum(['EPIC', 'STORY', 'TASK', 'BUG', 'SUBTASK']).optional(),
        label: z.string().optional(),
      },
    },
    async ({ projectKey, type, label }) =>
      json({ backlog: await listBacklog(ctx, projectKey, { type, label }) }),
  );

  /* ------------------------- resources ------------------------- */

  server.resource(
    'projects',
    'agentpm://projects',
    { description: '可访问的项目列表（只读）' },
    async () => ({
      contents: [
        {
          uri: 'agentpm://projects',
          mimeType: 'application/json',
          text: JSON.stringify(await listProjectsForActor(ctx)),
        },
      ],
    }),
  );

  server.resource(
    'board',
    new ResourceTemplate('agentpm://project/{projectKey}/board', { list: undefined }),
    { description: '项目看板只读视图：按状态分组的 issue' },
    async (uri, { projectKey }) => {
      const r = await searchIssues(ctx, String(projectKey), {
        page: 1,
        pageSize: 100,
        sort: 'priority_asc',
      } as never);
      const board: Record<string, string[]> = {};
      for (const i of r.items) (board[i.state] ??= []).push(`${i.issueKey} ${i.title}`);
      return {
        contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(board) }],
      };
    },
  );

  /* ------------------------- 其他工具组 ------------------------- */

  registerIssueTools(server, ctx);
  registerQualityTools(server, ctx);
  registerOpsTools(server, ctx);

  return server;
}

export function json(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}
