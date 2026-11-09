# ADR 0004 — 审计先行（Audit-first）与策略审批

- 状态：Accepted
- 日期：2026-11-09

## 背景

让 AI 参与项目管理的前提是**信任可验证**：人类负责人需要随时回答"哪些工作是谁（人还是 agent）做的、依据什么、改了什么"。同时不同团队对 agent 自主度的容忍度不同。

## 决策

- 所有写操作（REST 与 MCP 同源）统一经服务层落 `Activity`：`actor + source(WEB|API|MCP|SYSTEM) + apiTokenId? + action + detail(diff) + meta(ip/ua/mcp 工具名)`。
- 项目级 **agent 策略**（`Project.settings.agentPolicy`）：
  - `maxConcurrentClaims`：单 agent 并发领取上限（默认 3）；
  - `bugCreate: auto | approval`：agent 提 bug 是否需人工审批；
  - `completeTransition: auto | approval`：agent 把 issue 流转入 DONE 是否需审批。
- 需审批的动作生成 `ApprovalRequest`（存 payload），人类批准后由系统代为执行（source=SYSTEM，detail 指回审批单）。
- bug 去重：agent 提 bug 可带 `fingerprint`（稳定指纹，如 `test:Class#method` 或栈哈希）；同项目内未关闭的同指纹 bug 自动转为追加评论，不重复建单。

## 后果

- ✅ 审计即产品功能（活动流/监控中心直接消费），不是事后补的日志。
- ✅ 审批闸门让保守团队也能放心引入 agent。
- ⚠️ 服务层函数签名都带 `Ctx`（actor/source 等），略微增加样板代码——有意为之。
