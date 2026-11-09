# PM 替身使用指南（M5 / M5.5）

替身（AVATAR）是负责人在后台的 AI 分身：巡检项目 → 规则引擎识别风险（常开）→ LLM 增强叙述（可选）→ 产出日报与风险告警。设计边界见 [ADR 0005](./adr/0005-pm-avatar-design.md)：**只经 REST 干活，每一步进审计**。

## 快速开始（纯页面，零配置）

1. 项目 → 监控 → 「+ 创建替身」（自动加入项目，token 仅显示一次）。
2. 点 **「立即巡检」** —— 服务端进程内跑一遍规则引擎并当场发布报告（有非低危风险发告警，否则发日报），报告、通知、审计一步到位。

就这两步。定时自动巡检是可选项：把创建完成弹窗里给的命令放到你的电脑/服务器上用 cron 或计划任务定时执行：

```bash
pnpm --filter @agentpm/avatar-worker once -- --token <替身token>
# 可选：--url http://你的API地址:3000  --project 项目KEY（只巡检该项目）
# 常驻模式（默认每 15 分钟一轮，AVATAR_INTERVAL_MIN 可调）：去掉 once
pnpm --filter @agentpm/avatar-worker start -- --token <替身token>
```

（也支持环境变量 `AVATAR_TOKEN` / `AGENTPM_API_URL`，CLI 参数优先。）

产出会出现在：监控中心 → 替身报告；负责人的通知铃铛；`report.published` webhook（可接群机器人）。

### REST 方式创建（可选）

```bash
curl -X POST http://127.0.0.1:3000/v1/agents \
  -H "authorization: Bearer <你的token>" -H 'content-type: application/json' \
  -d '{"name":"pm-avatar","actorType":"AVATAR","description":"巡检项目产出日报"}'
# 复制返回的 token，然后把替身加进项目（AGENT 角色）
curl -X POST http://127.0.0.1:3000/v1/projects/APM/members \
  -H "authorization: Bearer <你的token>" -H 'content-type: application/json' \
  -d '{"actorName":"pm-avatar","role":"AGENT"}'
```

## 行为规则

- **采集**：项目统计、issue 列表、待审批、当前 Sprint 燃尽——worker 经 REST（审计可见）；「立即巡检」在 API 进程内采数，同样落审计。
- **风险识别（纯规则，无需 LLM）**：任务停滞（`avatarPolicy.stallDays` 天无更新）、逾期、Sprint 偏离（燃尽尾部 vs 理想线）、审批积压（>24h）、负载不均（max ≥ 3×avg）、agent 失联（有在办但心跳 >30min）。
- **报告决策（防打扰）**：出现**新的**中/高危 → 立即 `RISK_ALERT`；到 `avatarPolicy.digestHour`（默认 20 点）且当日无任何报告 → `DAILY_DIGEST`；其余轮询静默跳过。
- **可选动作**：`avatarPolicy.commentOnStalled=true` 时，替身会在停滞任务下评论提醒（每次最多 3 条）。
- **声明与追溯**：每份报告标注生成者、数据窗口、引擎（规则 / 规则+LLM），`data` 字段携带完整规则输出。

## LLM 增强（可选）

配置任意 OpenAI 兼容端点即可让报告多一段"结论（LLM）"与补充建议：

```bash
# .env —— 智谱 GLM 示例
LLM_BASE_URL=https://open.bigmodel.cn/api/paas/v4
LLM_API_KEY=<你的key>
LLM_MODEL=glm-4.7
# 本地 Ollama：LLM_BASE_URL=http://localhost:11434/v1  LLM_MODEL=qwen2.5:7b（无需 key）
```

LLM 失败/超时自动降级为纯规则，不影响报告产出。

## 项目级策略（`avatarPolicy`）

```jsonc
// PATCH /v1/projects/APM  { "avatarPolicy": { ... } }
{
  "digestHour": 20, // 日报时点（0-23）
  "stallDays": 3, // 停滞判定阈值
  "commentOnStalled": false, // 是否允许在停滞任务下评论
}
```

## 防失控

- 替身每轮先心跳（监控页可见"巡检 刚刚"）；`AgentProfile.status=paused` 可一键暂停（成员页/接口）。
- 写操作仅限：报告发布、心跳、（可选）停滞评论——不流转 issue、不改配置。
- 执行类高危动作仍由项目 `agentPolicy` 审批闸门约束（替身与其他 agent 同规矩）。
