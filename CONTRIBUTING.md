# 贡献指南 / Contributing to AgentPM

感谢你对 AgentPM 感兴趣！这是一个把 **人类与 AI Agent 当作一等公民** 的开源项目管理系统。欢迎代码、文档、MCP 工具提案、bug 反馈等一切形式的贡献。

## 行为准则

参与本项目即表示你同意遵守 [Code of Conduct](./CODE_OF_CONDUCT.md)。请保持友善、专业。

## 开发环境

要求：

- Node.js ≥ 20
- pnpm ≥ 9（仓库通过 `packageManager` 字段锁定版本，`corepack enable` 即可）
- MySQL 8（本机 Docker：`docker compose up -d mysql`，或任何可访问的 MySQL 8 实例）

```bash
git clone <your-fork>
cd agentpm
pnpm install

cp .env.example .env          # 修改 DATABASE_URL / JWT_SECRET
pnpm migrate                  # 生成并应用数据库迁移
pnpm seed                     # 写入首个管理员 + 示例项目 + 示例 agent（会打印一次性 token）

pnpm dev                      # 启动 API（默认 http://127.0.0.1:3000）
```

常用命令（均在仓库根目录执行）：

| 命令                                | 说明                                             |
| ----------------------------------- | ------------------------------------------------ |
| `pnpm lint` / `pnpm lint:fix`       | ESLint 检查 / 自动修复                           |
| `pnpm format:check` / `pnpm format` | Prettier 检查 / 格式化                           |
| `pnpm typecheck`                    | 全仓 TypeScript 类型检查                         |
| `pnpm test`                         | Vitest 全部测试（需要测试库可用）                |
| `pnpm smoke:mcp`                    | MCP 端到端冒烟（启动内嵌服务 + 官方 SDK client） |
| `pnpm --filter @agentpm/api dev`    | 只启动 API 开发模式                              |

## 代码规范

- **语言与风格**：TypeScript strict 模式；ESLint 9（flat config，共享配置在 `packages/eslint-config`）+ Prettier。提交前 `pnpm lint && pnpm format:check && pnpm typecheck` 必须通过。
- **导入约定**：ESM（`"type": "module"`）；相对导入不带扩展名（由 tsx / bundler resolution 解析）；内部包通过 `@agentpm/*` 导入。
- **验证层**：所有 API 输入用 zod schema 校验（schema 定义在 `packages/shared`，REST 与 MCP 共用同一套服务层，**不要在路由里绕过服务层直连 Prisma**——那会绕过审计）。
- **审计先行**：任何写操作必须通过 `services/*` 中的服务函数完成，服务内部负责写 `Activity`。新增 MCP 工具同理。
- **数据库**：schema 改动必须通过 `pnpm --filter @agentpm/db migrate -- --name <desc>` 生成迁移文件并提交，不允许 `db push` 进主干。
- **测试**：新增/修改行为需带测试。测试放在就近的 `test/` 目录，使用 `fastify.inject` 做集成测试，不依赖外部进程。
- **错误处理**：抛 `AppError`（带 statusCode 与机器可读 code），不要裸抛字符串。

## 提交规范（Conventional Commits）

```
<type>(<scope>): <subject>

feat(api): issue claim 支持按标签过滤
fix(mcp): 修复 bug.report 指纹去重大小写问题
docs: 补充 MCP 工具表
```

`type`：`feat` `fix` `docs` `style` `refactor` `perf` `test` `build` `ci` `chore`
`scope`（常用）：`api` `mcp` `db` `shared` `web` `docs` `ci`

## 分支与 PR 流程

1. Fork 并从 `main` 切出分支：`feat/<short-name>` 或 `fix/<short-name>`。
2. 保持小而聚焦的提交；一个 PR 解决一件事。
3. PR 描述填写模板；确保 CI（lint / typecheck / test / smoke）全绿。
4. 维护者 review 通过后 squash 或 rebase 合入 `main`。

## 新增 MCP 工具的流程

AgentPM 的差异化核心在 MCP 工具面。新增工具请：

1. 先开 issue（用 "MCP tool proposal" 模板）讨论动机与安全边界；
2. 实现放在 `packages/mcp-server/src/tools/`，业务逻辑放进 `apps/api/src/services/`（REST 与 MCP 共用）；
3. 在 `docs/mcp-tools.md` 登记工具名、参数、返回与审计行为；
4. 为工具写集成测试（参考 `apps/api/test/mcp.e2e.test.ts`）。

## 安全问题

不要在 issue / PR / 截图中暴露任何真实 token、密码、内网地址。发现安全漏洞请按 [SECURITY.md](./SECURITY.md) 私下报告。

## 许可

提交贡献即表示你同意以 Apache-2.0 许可发布（含专利授权，见 [LICENSE](./LICENSE)）。

---

# English summary

Contributions welcome (code, docs, MCP tool proposals, bug reports). Setup: Node ≥ 20, pnpm ≥ 9, MySQL 8; `pnpm install && pnpm migrate && pnpm seed && pnpm dev`. All writes must go through the service layer so audit trails are preserved. Conventional Commits enforced; ESLint + Prettier + strict TS. By contributing you license your work under Apache-2.0.
