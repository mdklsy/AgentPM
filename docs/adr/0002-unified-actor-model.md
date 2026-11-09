# ADR 0002 — 人机统一 Actor 模型

- 状态：Accepted
- 日期：2026-11-09

## 背景

传统 PM 系统里"用户"只指人类，机器人/集成是二等公民（靠全局 webhook 或 API key 挂靠）。AgentPM 的核心假设是：**AI Agent 是项目的一线参与者**——领取任务、汇报进度、提 bug、跑回归，其行为需要与人类同样可见、可审计、可追责。

## 决策

- 单一 `Actor` 表承载三类主体：`HUMAN` / `AGENT` / `AVATAR`（PM 替身）。
- Agent 必须有 owner（人类）与 AgentProfile（能力声明、心跳、配置）；创建即生成 ApiToken。
- 项目成员表 `Member` 对 Actor 类型不敏感：role = OWNER|ADMIN|MEMBER|AGENT|VIEWER，agent 以 `AGENT` 角色加入项目后方可操作。
- 一切写操作经过服务层，统一写 `Activity`：记录 actor、来源（WEB/API/MCP/SYSTEM）、token、动作、前后差异。**审计是领域逻辑的一部分，不是横切日志**。

## 后果

- ✅ 权限、通知、活动流、负载统计对人机天然一致；"谁在干什么"一个 feed 看全。
- ✅ 替身（AVATAR）复用同一模型与 MCP 工具面，吃自己的狗粮。
- ⚠️ 人类身份系统（SSO/OAuth）将来接入时仍映射到 HUMAN actor，不改表结构。
