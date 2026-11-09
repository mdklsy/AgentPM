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

## M3 Web UI ✅（2026-11-09）

- React 19 + Vite + Tailwind v4；登录/注册（首用户即管理员）、项目列表/创建
- 看板（HTML5 拖拽流转，按类型切换工作流列）、Backlog、issue 详情抽屉（评论/进度汇报/证据/流转/指派/领取）
- Agent 管理页（创建 + token 一次性签发、加入项目、心跳）、审批收件箱（批准=系统代执行）
- SSE 实时活动流（人机同源，来源过滤）+ 项目总览驾驶舱（进度/负载/agent 状态/活跃度）
- 回归历史页、成员管理页
- 已浏览器黑盒实测全链路（登录→流转→评论→SSE 实时→审批闭环）

## M4 协作与报表 ✅（2026-11-09）

- Sprint 面板：创建/启动/完成（未完成自动退回 Backlog）、双栏排期（Sprint ↔ Backlog）
- **燃尽图**：不存快照表，直接从审计流（Activity）逐日重建，含 reopen 修正；理想线对比；速率柱状图
- 通知中心：站内信（指派/完成/评论/审批请求与决定），顶栏铃铛未读徽标 + 跳转 issue 抽屉；绝不通知触发者本人
- Webhooks：项目事件 HMAC-SHA256 签名 POST（13 类事件可订阅）、投递日志、连通性测试；MCP=调进来，webhook=推出去
- 已浏览器实测（Sprint 面板/燃尽、通知触发与展示、webhook 创建-测试-日志）
- 后续增强（M4.x）：高级搜索/保存过滤器、邮件通知渠道、附件文件存储、负载热力图

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
