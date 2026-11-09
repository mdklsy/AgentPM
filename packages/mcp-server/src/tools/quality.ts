import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { reportBug, reportProgress, submitRegression, type Ctx } from '@agentpm/core';
import { json } from '../server.js';

const issueKey = z.string().regex(/^[A-Z][A-Z0-9_]{1,9}-\d+$/);

export function registerQualityTools(server: McpServer, ctx: Ctx) {
  server.registerTool(
    'progress.report',
    {
      title: '汇报进度',
      description:
        '对已领取的 issue 做结构化进度汇报：百分比 + 备注 + 阻塞项（可指向其他 issue，会自动建立 BLOCKS 链接）+ 产物链接。',
      inputSchema: {
        issueKey,
        percent: z.number().int().min(0).max(100),
        notes: z.string().optional(),
        blockers: z
          .array(z.object({ description: z.string(), issueKey: issueKey.optional() }))
          .optional()
          .describe('阻塞项列表'),
        artifacts: z
          .array(z.object({ name: z.string(), url: z.string().url() }))
          .optional()
          .describe('产物链接：PR、构建日志、截图等'),
      },
    },
    async ({ issueKey: key, blockers, artifacts, ...rest }) =>
      json(
        await reportProgress(ctx, key, {
          ...rest,
          blockers: blockers ?? [],
          artifacts: artifacts ?? [],
        }),
      ),
  );

  server.registerTool(
    'bug.report',
    {
      title: '提交 bug',
      description:
        '带证据提 bug。强烈建议带 fingerprint（稳定指纹，如 test:Class#method 或栈哈希）：同项目存在未关闭的同指纹 bug 时自动并入而不重复建单。项目策略可要求人工审批。',
      inputSchema: {
        projectKey: z.string(),
        title: z.string().min(3).max(255),
        description: z.string().optional(),
        severity: z.enum(['P0', 'P1', 'P2', 'P3', 'P4']).optional().describe('默认 P2'),
        stepsToReproduce: z.string().optional(),
        evidence: z.record(z.unknown()).optional().describe('结构化证据：日志、断言输出、截图 URL'),
        fingerprint: z.string().optional().describe('去重指纹'),
        environment: z.string().optional(),
        parentIssueKey: issueKey.optional(),
        labelNames: z.array(z.string()).optional(),
      },
      annotations: { readOnlyHint: false },
    },
    async ({ projectKey, severity, labelNames, ...rest }) =>
      json(
        await reportBug(ctx, projectKey, {
          ...(rest as Omit<Parameters<typeof reportBug>[2], 'severity' | 'labelNames'>),
          severity: severity ?? 'P2',
          labelNames: labelNames ?? [],
        }),
      ),
  );

  server.registerTool(
    'regression.submit',
    {
      title: '提交回归结果',
      description:
        '提交一次回归的用例矩阵。失败用例按项目策略自动建 bug（fingerprint 去重）并回链运行记录；也可作为 CI 的回归上报通道。',
      inputSchema: {
        projectKey: z.string(),
        suite: z.string().describe('套件名，如 unit / e2e / api'),
        branch: z.string().optional(),
        commitSha: z.string().optional(),
        durationMs: z.number().int().optional(),
        results: z
          .array(
            z.object({
              name: z.string(),
              className: z.string().optional(),
              status: z.enum(['PASS', 'FAIL', 'ERROR', 'SKIP']),
              message: z.string().optional(),
              fingerprint: z.string().optional(),
              durationMs: z.number().int().optional(),
            }),
          )
          .min(1)
          .max(2000),
      },
    },
    async (args) => json(await submitRegression(ctx, args.projectKey, args)),
  );
}
