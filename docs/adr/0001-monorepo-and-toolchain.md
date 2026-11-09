# ADR 0001 — pnpm monorepo 与 ESM 工具链

- 状态：Accepted
- 日期：2026-11-09

## 背景

AgentPM 由 API 服务、MCP 服务器、stdio 网关、共享 schema、前端等多个可独立演进的部件组成，且 REST 与 MCP 必须共享同一套领域服务与审计逻辑。

## 决策

- **pnpm workspace monorepo**：`apps/*`（api、mcp-stdio、web）+ `packages/*`（core、db、shared、mcp-server、eslint-config）。
- **领域服务独立成包 `@agentpm/core`**：认证/RBAC/issue/回归/审批等服务层放在 package 而非 app 内——`packages/mcp-server` 依赖 core 调用服务，`apps/api` 依赖两者；避免"包反向依赖 app"的环，REST 与 MCP 严格共用同一套审计。
- **全仓 ESM**（`"type": "module"`），Node ≥ 20，TS strict。
- **内部包直接导出 TS 源码**（`exports → src/index.ts`），由 tsx / Vitest / bundler resolution 消费；不维护内部包的 dist 构建产物，避免双份真相。
- 生产与开发一致使用 `tsx` 作为运行时；`pnpm build` 语义 = 全仓类型检查。
- Fastify 5 + Prisma 6 + MySQL 8 + zod 3（MCP SDK 的 peer 约束）。

## 后果

- ✅ 改内部包无需预编译，贡献者体验简单；REST/MCP 强制共享服务层（审计天然一致）。
- ⚠️ 未来若需要发布独立 npm 包（如 `@agentpm/sdk`），需为该包补构建配置。
- ⚠️ tsx 运行时有轻微启动开销；对 PM 系统的可接受。
