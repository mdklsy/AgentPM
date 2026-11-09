# ADR 0005 — PM 替身（Avatar）设计预留

- 状态：Proposed（M5 实现，本 ADR 冻结接口边界）
- 日期：2026-11-09

## 背景

"项目负责人也可以有 AI 替身"：替身在后台持续监控项目，产出进度简报、风险告警、负载不均提示，并按策略代表负责人执行低风险动作。

## 决策（边界冻结）

- 替身 = `Actor(type=AVATAR)` + 绑定 `ownerId`（负责人本人）。一个负责人可有多替身（不同项目）。
- 替身**只通过现有接口工作**：MCP 工具 + REST API，不开后门。这样它的每一步也进审计。
- 替身工作循环（`apps/avatar-worker`，M5）：
  1. **采集**：`project.stats` / `project.activity` / sprint 状态（事件触发 + 定时轮询）；
  2. **分析**：LLM 适配器（OpenAI 兼容协议，可指向智谱 GLM / OpenAI / 本地 Ollama）生成结构化结论（风险、负载、预计偏离）；
  3. **行动**：写日报（Report 实体）、评论、@负责人、创建审批提醒；执行类动作一律走 `agentPolicy` 审批闸门；
  4. **声明**：所有产出标注"由替身生成 + 依据的数据窗口"，可追溯。
- LLM 适配器接口：`complete(prompt, {json?: boolean})`，实现放 `packages/llm-adapter`（M5），配置经环境变量，**不锁定任何厂商**。

## 后果

- ✅ 替身能力随 MCP 工具面自然增长；监控中心的"人类视角"与"替身视角"共用数据。
- ⚠️ 防替身失控：动作频率上限 + 高危动作强制人工审批 + 可一键暂停（AgentProfile.status=paused）。
