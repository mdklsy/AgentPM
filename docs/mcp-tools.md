# AgentPM MCP 工具面（v1）

AgentPM 内建 MCP（Model Context Protocol）服务器。**推荐用你本人的个人 Token 接入**（团队成员页「我的自动化渠道」签发）——身份即渠道：同一个账号，网页是 WEB 手动，token 是自动化，共享同一套领域服务与审计。「独立机器人」身份是可选项，仅用于给第三方 bot 建立隔离身份。

- **Streamable HTTP**：`POST /v1/mcp`，`Authorization: Bearer apm_xxx`
- **stdio 网关**：`npx agentpm-mcp --url http://host:3000/v1/mcp --token apm_xxx`
- 所有工具调用：校验 token → 校验项目成员身份 → 按 token 限速 → 全量写 Activity（source=MCP）

## project.*

| 工具               | 说明                                     | 关键参数                         |
| ------------------ | ---------------------------------------- | -------------------------------- |
| `project.list`     | 列出我有成员身份的项目                   | —                                |
| `project.get`      | 项目详情（含 agent 策略、成员）          | `projectKey`                     |
| `project.stats`    | 进度统计：按状态/负责人/类型的分布与负载 | `projectKey`                     |
| `project.activity` | 最近活动流（可按 actor/source 过滤）     | `projectKey`, `limit?`, `since?` |

## issue.*

| 工具               | 说明                                                                                    | 关键参数                                                                                     |
| ------------------ | --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `issue.search`     | 搜索：全文 + 类型/状态/负责人/标签/父级过滤                                             | `projectKey`, `q?`, `type?`, `state?`, `assignee?`, `label?`, `limit?`                       |
| `issue.get`        | 单个 issue 详情（含评论、进度、状态）                                                   | `issueKey`                                                                                   |
| `issue.create`     | 创建 issue（BUG 需受 agent 策略约束）                                                   | `projectKey`, `type`, `title`, `description?`, `priority?`, `parentIssueKey?`, `labelNames?` |
| `issue.update`     | 更新标题/描述/优先级/到期日/故事点等                                                    | `issueKey`, 字段可选                                                                         |
| `issue.comment`    | 评论（可附 evidence 结构化证据）                                                        | `issueKey`, `body`, `evidence?`                                                              |
| `issue.transition` | 工作流流转（校验状态机；DONE 受策略约束）                                               | `issueKey`, `toState`, `comment?`                                                            |
| `issue.claim`      | **原子领取**：指定 key，或按过滤器从待办池抢单（并发安全，受 maxConcurrentClaims 限制） | `projectKey`, `issueKey?`, `type?`, `label?`, `q?`                                           |
| `issue.release`    | 释放任务（回待办池，记录原因）                                                          | `issueKey`, `reason?`                                                                        |

## 进度与缺陷

| 工具              | 说明                                                                                                             | 关键参数                                                                                                                    |
| ----------------- | ---------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `progress.report` | 结构化进度汇报（percent/notes/blockers/artifacts）                                                               | `issueKey`, `percent`, `notes?`, `blockers?`, `artifacts?`                                                                  |
| `bug.report`      | 提 bug，带复现步骤与证据；**fingerprint 去重**（同项目未关闭同指纹 → 自动转为追加评论）；受 `bugCreate` 策略约束 | `projectKey`, `title`, `description?`, `severity(P0-P4)?`, `stepsToReproduce?`, `evidence?`, `fingerprint?`, `environment?` |

## 回归

| 工具                | 说明                                                                         | 关键参数                                                                                                                                              |
| ------------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `regression.submit` | 提交一次回归结果矩阵；失败项按策略自动提 bug（走 bug.report 去重逻辑）并回链 | `projectKey`, `suite`, `branch?`, `commitSha?`, `durationMs?`, `results[]: {name, status(PASS/FAIL/ERROR/SKIP), message?, fingerprint?, durationMs?}` |

## sprint / backlog

| 工具             | 说明                                            |
| ---------------- | ----------------------------------------------- |
| `sprint.list`    | 列出项目 sprint（M1 先建数据模型，M4 完整面板） |
| `sprint.current` | 当前 ACTIVE sprint 及其 issue 概览              |
| `backlog.list`   | 未排期 issue 列表（可过滤类型/标签）            |

## agent / approvals

| 工具              | 说明                                               |
| ----------------- | -------------------------------------------------- |
| `agent.heartbeat` | 心跳：上报状态与当前任务列表，刷新 lastHeartbeatAt |
| `approvals.list`  | 我触发的待审批请求及状态                           |

## 资源（read-only）

- `agentpm://projects` — 可访问项目列表
- `agentpm://project/{key}/board` — 项目看板只读视图（按状态分组的 issue）

## 审计与安全约定

1. token 仅哈希落库；限速默认 120 次/分钟/token（可配，`MCP_RATE_LIMIT_PER_MIN`）。
2. **写操作全量审计**：所有变更类工具调用产生的领域事件（`task.claimed` / `progress.reported` / `issue.transitioned` / `bug.deduplicated` / `regression.submitted` …）落 Activity，`source=MCP` 且 `meta.mcpTool` 记录触发工具名；读操作不产生审计行（防膨胀）。
3. agent 必须是项目成员（AGENT 角色）；越权返回权限错误。
4. `bugCreate` / `completeTransition` 设为 `approval` 时，工具返回"待审批"并生成 ApprovalRequest，人类批准后系统代执行（source=SYSTEM）。
5. 每次请求需带 `Accept: application/json, text/event-stream`（MCP 规范要求，官方 SDK 客户端默认满足）。
