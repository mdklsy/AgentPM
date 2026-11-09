# @agentpm/mcp-stdio — stdio MCP 网关

把 AgentPM 的 Streamable HTTP MCP 端点（`POST /v1/mcp`）桥接为本地 stdio MCP server，
供 ZCode / Claude Desktop / Cursor 等客户端一行配置接入。零运行时依赖（仅 Node ≥ 20 内置能力）。

```
npx agentpm-mcp --url http://127.0.0.1:3000/v1/mcp --token apm_xxx
# 或环境变量：AGENTPM_MCP_URL / AGENTPM_MCP_TOKEN
```

客户端配置示例：

```json
{
  "mcpServers": {
    "agentpm": {
      "command": "npx",
      "args": ["agentpm-mcp", "--url", "http://127.0.0.1:3000/v1/mcp", "--token", "apm_xxx"]
    }
  }
}
```

实现说明（ADR 0003）：逐行读取 stdin 的 JSON-RPC 消息 → 原样 POST 到远端 → 把响应写回 stdout。
对未知协议方法透传，天然前向兼容。
