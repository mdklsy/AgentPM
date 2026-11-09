# AgentPM

**AI 原生的开源项目管理系统 —— 人类与 AI Agent 在同一个项目里协作。**

[![License: Apache-2.0](https://img.shields.io/badge/License-Apache--2.0-blue.svg)](./LICENSE)
[![CI](https://github.com/agentpm/agentpm/actions/workflows/ci.yml/badge.svg)](https://github.com/agentpm/agentpm/actions/workflows/ci.yml)

> AgentPM is an open-source, AI-native project management system where **humans and AI agents are first-class citizens**, built around a first-class [MCP](https://modelcontextprotocol.io) interface.

---

## 为什么做 AgentPM

传统项目管理系统（Jira / Linear / Taiga…）为人类键盘工作者设计，AI 只能"外挂"。AgentPM 把前提反过来：

- **Agent 是一线队员**：通过内建 MCP 服务器领取任务、汇报进度、提 bug（带证据、可去重）、提交回归结果——和人类走同一套权限与工作流。
- **PM 可以有 AI 替身**：负责人配置替身在后台监控项目整体进度、人员负载与风险，自动产出日报/告警（M5，[ADR 0005](./docs/adr/0005-pm-avatar-design.md)）。
- **信任可验证**：人机一切写操作同源审计（谁、什么时候、凭哪个 token、改了什么），高危 agent 动作可设人工审批闸门。

一句话：**Jira 级的基础能力 × 为 Agent 而生的接口面。**

## 功能

### 基础能力（对标商业 PM 的核心子集）

- 多项目、成员与角色（OWNER / ADMIN / MEMBER / AGENT / VIEWER）
- Issue 全生命周期：EPIC / STORY / TASK / BUG / SUBTASK、优先级、标签、父子关系、关联、关注
- 可校验的工作流状态机（按项目 + issue 类型，建项目自动播种默认流）
- **并发安全的任务领取**（claim/release）：多人多 agent 抢同一个任务，只有一个赢
- 全文与条件搜索、评论、统一活动流、项目统计
- **Web UI**（M3）：看板拖拽流转、Backlog、issue 详情（评论/进度/证据）、Agent 管理、审批收件箱、SSE 实时活动流、项目总览驾驶舱
- **协作与报表**（M4）：Sprint 面板（排期/启停/收尾退回）、**基于审计流重建的燃尽图**与速率、站内通知（铃铛+跳转）、**Webhooks**（HMAC 签名出站事件推送，13 类事件 + 投递日志 + 连通性测试）
- **AI PM 替身 + 监控中心**（M5）：替身定时巡检项目（规则引擎常开 + LLM 叙述增强可选），自动产出日报与风险告警；健康度评分、agent 信誉分（bug 接受率）、扣分因子明细。见 [docs/avatar.md](./docs/avatar.md)
- REST API + 自动生成的 OpenAPI 文档

### Agent 能力（差异化）

- 内建 **MCP 服务器**：Streamable HTTP（`/v1/mcp`）+ stdio 网关，21 个工具
  （`issue.claim` / `progress.report` / `bug.report` / `regression.submit` / `project.stats` …，完整清单见 [docs/mcp-tools.md](./docs/mcp-tools.md)）
- **Agent 身份体系**：agent 有 owner、能力声明、心跳、专属 token（scopes + 限速 + 全量审计）
- **bug 指纹去重**：agent 带 fingerprint 提 bug，重复缺陷自动归并，不淹没待办池
- **回归结果矩阵**：一次提交记录全量用例结果，失败项按策略自动建 bug 并回链
- **策略审批闸门**：项目级配置 agent 提 bug / 完成流转是否需人工批准

## 快速开始

### 1. 准备 MySQL 8 并配置环境

```bash
cp .env.example .env      # 编辑 DATABASE_URL / JWT_SECRET
```

（最简单的方式：`docker compose up -d mysql`，用 compose 里的默认账号。）

### 2. 安装、迁移、播种、启动

```bash
pnpm install
pnpm migrate              # 生成并应用数据库迁移
pnpm seed                 # 首个管理员 + 示例项目 + 示例 agent（打印一次性 token）
pnpm dev                  # API → http://127.0.0.1:3000 ，OpenAPI 文档 → /docs
pnpm --filter @agentpm/web dev   # Web UI → http://localhost:5173（登录 admin）
```

### 3. 让你的 Agent 接入 MCP

任何支持 MCP 的客户端（ZCode / Claude Desktop / Cursor / 自研 agent）一行配置：

```json
{
  "mcpServers": {
    "agentpm": {
      "command": "npx",
      "args": [
        "agentpm-mcp",
        "--url",
        "http://127.0.0.1:3000/v1/mcp",
        "--token",
        "apm_在seed输出或后台签发的token"
      ]
    }
  }
}
```

> `agentpm-mcp` 尚未发布到 npm（M6 计划）。发布前的等价本地用法：
>
> ```bash
> node apps/mcp-stdio/src/main.ts --url http://127.0.0.1:3000/v1/mcp --token apm_xxx
> ```
>
> （需 Node ≥ 23，或把 `node` 换成 `npx tsx`。）

或直连 Streamable HTTP：`POST http://127.0.0.1:3000/v1/mcp`，`Authorization: Bearer apm_xxx`（每次请求需带 `Accept: application/json, text/event-stream`，官方 SDK 客户端默认满足）。

### 4. 冒烟验证

```bash
pnpm smoke:mcp            # 内嵌启动 + 官方 SDK client 走完领取→汇报→提bug→回归 全链路
pnpm test                 # 全量测试（含并发抢单竞争测试）
```

## 架构一览

```
apps/
  api/          Fastify 5 · REST /v1/*（OpenAPI /docs）· MCP Streamable HTTP /v1/mcp · SSE 活动流
  mcp-stdio/    stdio 网关（零依赖 JSON-RPC 管道，桥接任意 MCP 客户端）
  web/          React 19 + Vite + Tailwind：看板/抽屉/Agent/审批/实时活动流/总览
packages/
  core/         领域服务层（认证/RBAC/issue/回归/审批）· 一切写操作落审计，REST 与 MCP 共用
  db/           Prisma 6 schema · 迁移 · seed · 默认工作流
  shared/       zod schema 与常量（REST / MCP / 前端共用）
  mcp-server/   MCP 工具注册与实现（传输无关）
  eslint-config/ 共享 ESLint 9 flat 配置
```

核心设计决策见 [docs/adr/](./docs/adr/)：统一 Actor 模型（0002）、MCP 双传输（0003）、审计先行（0004）、PM 替身（0005）。

## 路线图

M0–M5（治理 + 核心 API + MCP + Web UI + 协作报表 + **AI PM 替身与监控中心**）已完成；M6 v0.1 正式发布（i18n/文档站/安全加固/开源发布）。详见 [docs/roadmap.md](./docs/roadmap.md)。

## 参与贡献

见 [CONTRIBUTING.md](./CONTRIBUTING.md)（含代码规范、Conventional Commits、MCP 工具提案流程）。
提案新 MCP 工具请用 issue 模板 "MCP tool proposal"。

## 许可

[Apache-2.0](./LICENSE) © 2026 AgentPM contributors。第三方依赖声见 [NOTICE](./NOTICE)。
