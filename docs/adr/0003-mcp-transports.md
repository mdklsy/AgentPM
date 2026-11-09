# ADR 0003 — MCP 双传输：Streamable HTTP 一等端点 + stdio 网关

- 状态：Accepted
- 日期：2026-11-09

## 背景

Agent 接入方式多样：远程 SaaS 上的 agent 只能走 HTTP；桌面端 agent（ZCode/Claude Desktop/Cursor）习惯 stdio 配置。我们只有一个 MCP 工具面，不想维护两份实现。

## 决策

- **唯一真相**：`packages/mcp-server` 以传输无关方式注册全部工具（基于官方 `@modelcontextprotocol/sdk` 的 `McpServer`），工具 handler 调用 `apps/api/src/services` 的服务函数。
- **Streamable HTTP**：`POST /v1/mcp`，`Authorization: Bearer <api-token>`，**stateless 模式**（`sessionIdGenerator: undefined` + JSON 响应），每请求新建 server 实例——无服务端会话粘性，天然水平扩展。
- **stdio 网关**（`apps/mcp-stdio`）：零依赖 JSON-RPC 管道——stdin 逐行读消息 → 原样 POST 到 `/v1/mcp`（带 token）→ 响应写回 stdout。配置形态：`npx agentpm-mcp --url http://host:3000/v1/mcp --token apm_xxx`。
- 限速按 token 计（令牌桶），工具调用全量入 Activity（含工具名与参数摘要）。

## 后果

- ✅ 一份工具实现，两种接入面；stdio 网关 ~100 行、无 SDK 依赖，极稳。
- ⚠️ stateless 模式不支持服务端主动通知（如订阅 issue 变更）——将来做 MCP subscription 时再引入有状态会话。
- ⚠️ stdio 网关透传所有消息，包括它不认识的新协议方法——这是特性（前向兼容）。
