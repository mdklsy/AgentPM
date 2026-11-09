import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  addComment,
  assignIssue,
  claimIssue,
  createIssue,
  getIssue,
  linkIssue,
  releaseIssue,
  searchIssues,
  transitionIssue,
  updateIssue,
  watchIssue,
  type Ctx,
} from '@agentpm/core';
import { json } from '../server.js';

const issueKey = z.string().regex(/^[A-Z][A-Z0-9_]{1,9}-\d+$/, 'issue key 形如 APM-42');
const issueType = z.enum(['EPIC', 'STORY', 'TASK', 'BUG', 'SUBTASK']);
const priority = z.enum(['P0', 'P1', 'P2', 'P3', 'P4']);

export function registerIssueTools(server: McpServer, ctx: Ctx) {
  server.registerTool(
    'issue.search',
    {
      title: '搜索 issue',
      description: '全文 + 条件过滤搜索。q 匹配标题与描述。',
      inputSchema: {
        projectKey: z.string(),
        q: z.string().optional(),
        type: z.string().optional().describe('逗号分隔多类型，如 TASK,BUG'),
        state: z.string().optional().describe('状态名，如 进行中'),
        assignee: z.string().optional().describe('账号名，或 none=未指派'),
        label: z.string().optional(),
        limit: z.number().int().min(1).max(100).optional().describe('默认 20'),
      },
    },
    async ({ projectKey, limit, ...rest }) =>
      json(
        await searchIssues(ctx, projectKey, {
          ...(rest as {
            q?: string;
            type?: string;
            state?: string;
            assignee?: string;
            label?: string;
          }),
          page: 1,
          pageSize: limit ?? 20,
          sort: 'priority_asc',
        }),
      ),
  );

  server.registerTool(
    'issue.get',
    {
      title: 'issue 详情',
      description: '含描述、状态、评论、进度汇报与链接。做任务前先看这里。',
      inputSchema: { issueKey },
    },
    async ({ issueKey: key }) => json({ issue: await getIssue(ctx, key) }),
  );

  server.registerTool(
    'issue.create',
    {
      title: '创建 issue',
      description: '创建 STORY/TASK/BUG/SUBTASK/EPIC。SUBTASK 必须带 parentIssueKey。',
      inputSchema: {
        projectKey: z.string(),
        type: issueType,
        title: z.string().min(1).max(255),
        description: z.string().optional(),
        priority: priority.optional().describe('默认 P2'),
        parentIssueKey: issueKey.optional(),
        assigneeName: z.string().optional(),
        labelNames: z.array(z.string()).optional(),
        storyPoints: z.number().int().optional(),
        dueDate: z.string().optional().describe('ISO 日期'),
      },
    },
    async ({ projectKey, labelNames, dueDate, ...rest }) =>
      json({
        issue: await createIssue(ctx, projectKey, {
          ...(rest as Omit<Parameters<typeof createIssue>[2], 'labelNames' | 'dueDate'>),
          labelNames: labelNames ?? [],
          dueDate: dueDate ? new Date(dueDate) : undefined,
        }),
      }),
  );

  server.registerTool(
    'issue.update',
    {
      title: '更新 issue',
      description: '更新标题/描述/优先级/故事点/到期日/标签。',
      inputSchema: {
        issueKey,
        title: z.string().optional(),
        description: z.string().optional(),
        priority: priority.optional(),
        storyPoints: z.number().int().nullable().optional(),
        dueDate: z.string().nullable().optional(),
        labelNames: z.array(z.string()).optional(),
      },
    },
    async ({ issueKey: key, dueDate, ...rest }) =>
      json({
        issue: await updateIssue(ctx, key, {
          ...(rest as Parameters<typeof updateIssue>[2]),
          dueDate: dueDate === undefined ? undefined : dueDate === null ? null : new Date(dueDate),
        }),
      }),
  );

  server.registerTool(
    'issue.comment',
    {
      title: '评论',
      description: '给 issue 添加评论，可附结构化证据（日志、URL 等）。',
      inputSchema: {
        issueKey,
        body: z.string().min(1),
        evidence: z.record(z.unknown()).optional(),
      },
    },
    async ({ issueKey: key, body, evidence }) =>
      json({ ok: true, comment: await addComment(ctx, key, { body, evidence }) }),
  );

  server.registerTool(
    'issue.transition',
    {
      title: '流转状态',
      description:
        '按工作流流转 issue（如 待办 → 进行中 → 已完成）。非法迁移会被拒绝；agent 流转到完成态可能触发项目审批策略。',
      inputSchema: {
        issueKey,
        toState: z.string().describe('目标状态名，先 project.get 查可用状态'),
        comment: z.string().optional().describe('随流转附带的说明'),
      },
    },
    async ({ issueKey: key, toState, comment }) =>
      json(await transitionIssue(ctx, key, toState, comment)),
  );

  server.registerTool(
    'issue.claim',
    {
      title: '领取任务',
      description:
        '原子领取：指定 issueKey，或按 type/label/q 从待办池抢单（并发安全，同一任务只有一个赢家）。受项目 maxConcurrentClaims 限制。',
      inputSchema: {
        projectKey: z.string(),
        issueKey: issueKey.optional(),
        type: issueType.optional().describe('抢单过滤：issue 类型'),
        label: z.string().optional().describe('抢单过滤：标签'),
        q: z.string().optional().describe('抢单过滤：标题/描述关键词'),
      },
    },
    async (args) => json(await claimIssue(ctx, args.projectKey, args)),
  );

  server.registerTool(
    'issue.release',
    {
      title: '释放任务',
      description: '放弃已领取的任务（回待办池），建议附 reason。',
      inputSchema: { issueKey, reason: z.string().optional() },
    },
    async ({ issueKey: key, reason }) => json({ issue: await releaseIssue(ctx, key, reason) }),
  );

  server.registerTool(
    'issue.assign',
    {
      title: '指派',
      description: '指派/取消指派（管理员或自动指派场景）。',
      inputSchema: { issueKey, assigneeName: z.string().nullable() },
    },
    async ({ issueKey: key, assigneeName }) =>
      json({ issue: await assignIssue(ctx, key, assigneeName) }),
  );

  server.registerTool(
    'issue.link',
    {
      title: '关联 issue',
      description: '建立 BLOCKS / RELATES / DUPLICATES / CAUSES 链接。',
      inputSchema: {
        issueKey,
        toIssueKey: issueKey,
        type: z.enum(['BLOCKS', 'RELATES', 'DUPLICATES', 'CAUSES']).default('RELATES'),
      },
    },
    async ({ issueKey: key, toIssueKey, type }) =>
      json(await linkIssue(ctx, key, toIssueKey, type)),
  );

  server.registerTool(
    'issue.watch',
    {
      title: '关注/取关',
      description: '关注 issue 以接收后续通知（M4 通知中心）。',
      inputSchema: { issueKey, watch: z.boolean().default(true) },
    },
    async ({ issueKey: key, watch }) => json(await watchIssue(ctx, key, watch)),
  );
}
