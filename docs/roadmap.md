# AgentPM 路线图

首期（M0–M2）交付：开源治理 + 核心领域 REST API + MCP 服务器。后续里程碑按序推进，每个里程碑结束都保持主干可发布状态。

## M0 治理与脚手架 ✅（本期）

- Apache-2.0（LICENSE + NOTICE）、README、CONTRIBUTING、SECURITY、CoC
- pnpm monorepo、ESLint 9 flat + Prettier、Conventional Commits（commitlint）
- GitHub Actions CI：lint → format → typecheck → test（MySQL service）→ MCP 冒烟
- ADR 0001–0005

## M1 核心领域 + REST API ✅（本期）

- 认证：注册（首用户即实例管理员）/ 登录（JWT cookie）/ API Token CRUD（SHA-256 落库、scopes）
- Actor 统一模型：HUMAN / AGENT / AVATAR；AgentProfile（owner、能力、心跳）
- 项目 & 成员 RBAC（OWNER/ADMIN/MEMBER/AGENT/VIEWER）、项目 key、agent 策略
- Issue 全生命周期：类型（EPIC/STORY/TASK/BUG/SUBTASK）、优先级、标签、父子、关注、链接
- **原子 claim / release**（并发安全）、指派、工作流流转（状态机校验）
- 评论、统一活动流（人机同源审计）、项目统计、OpenAPI/Swagger

## M2 MCP 服务器 + Agent 体系 ✅（本期）

- 官方 MCP SDK；`POST /v1/mcp`（Streamable HTTP、Bearer token、stateless）+ stdio 网关
- 21 个工具：project.* / issue.* / progress.report / bug.report（指纹去重）/ regression.submit（失败自动建 bug）/ agent.heartbeat / approvals.list 等
- 按 token 限速、成员校验、全量审计、策略级审批闸门
- 2 个资源（projects 列表 / 项目看板只读视图）

## M3 Web UI（下一步）

- React + Vite + Tailwind；登录、项目列表/详情
- 看板（拖拽流转）、Backlog、issue 详情（评论/活动/证据/进度汇报）
- Agent 管理页（token 签发、心跳、领取中任务）、审批收件箱
- SSE 实时活动流

## M4 协作与报表

- Sprint 面板（规划/激活/完成）、燃尽图、速率图、负载热力图
- 高级搜索与保存的过滤器（类 JQL 子集）
- 通知中心（站内 + 邮件可选）、Webhooks（issue 变更/审批事件）
- 附件文件存储（S3 兼容 / 本地磁盘）、MySQL FULLTEXT(ngram) 切换（scripts/db/fulltext.sql）
- Jira / CSV 导入

## M5 AI PM 替身 + 监控中心

- `apps/avatar-worker`：事件 + 定时驱动，按 ADR 0005 工作循环
- LLM 适配器（OpenAI 兼容：智谱 GLM / OpenAI / Ollama）
- 日报/周报实体、风险告警、负载建议、审批提醒
- 监控中心：人机活动流、agent 信誉分（bug 接受率等）、项目健康度
- agent 自主度策略增强（细粒度动作白名单）

## M6 v0.1 正式发布

- 中英双语 i18n、文档站、安全加固 pass（依赖审计、渗透自查清单）
- 一键部署（docker-compose / Helm 骨架）、演示数据一键导入
- GitHub 开源发布（banner、announce、Discussion 引导）
