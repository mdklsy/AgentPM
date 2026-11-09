# Security Policy / 安全策略

## 支持版本 / Supported versions

| Version      | Supported |
| ------------ | --------- |
| 0.1.x (main) | ✅        |

## 报告漏洞 / Reporting a vulnerability

**请不要通过公开 issue 报告安全漏洞。**

Please report security vulnerabilities **privately** — do NOT open a public issue.

- 首选：GitHub Security Advisories（仓库 Security 标签页 → "Report a vulnerability"）
- 或邮件：security@agentpm.dev（占位，发布前替换为真实邮箱）

请包含：影响面描述、复现步骤（PoC）、受影响版本、你建议的修复方向。我们会在 **72 小时内** 确认收到，并在修复发布后致谢报告者（除非你希望匿名）。

## 安全设计要点 / Security notes

- AgentPM 中的 API token 只以 SHA-256 哈希落库，明文仅在创建时展示一次；
- 所有 Agent 的 MCP 调用按 token 限速并全量写入审计日志（Activity）；
- 项目级 agent 策略可把高危动作（提 bug、完成流转）设为需人工审批；
- 自托管部署请务必：设置强 `JWT_SECRET`、不要将 `.env` 提交进仓库、为 MySQL 启用网络访问控制。
