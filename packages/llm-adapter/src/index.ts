/**
 * LLM 适配器（ADR 0005）：OpenAI 兼容 chat/completions 协议，不锁定厂商——
 * 智谱 GLM（https://open.bigmodel.cn/api/paas/v4）/ OpenAI / 本地 Ollama（http://localhost:11434/v1）均可。
 * 未配置时 isConfigured()=false，调用方应降级为纯规则模式。
 */
export interface LlmOptions {
  baseUrl: string;
  apiKey?: string;
  model: string;
  timeoutMs?: number;
  maxTokens?: number;
}

export interface CompleteInput {
  system?: string;
  prompt: string;
  /** 期望 JSON 输出（设置 response_format） */
  json?: boolean;
  maxTokens?: number;
}

export class LlmAdapter {
  constructor(private readonly opts: LlmOptions) {}

  static fromEnv(env: NodeJS.ProcessEnv = process.env): LlmAdapter | null {
    const baseUrl = env.LLM_BASE_URL;
    const model = env.LLM_MODEL;
    if (!baseUrl || !model) return null;
    return new LlmAdapter({
      baseUrl: baseUrl.replace(/\/$/, ''),
      apiKey: env.LLM_API_KEY,
      model,
      timeoutMs: Number(env.LLM_TIMEOUT_MS ?? 30_000),
    });
  }

  get model(): string {
    return this.opts.model;
  }

  async complete(input: CompleteInput): Promise<string> {
    const res = await fetch(`${this.opts.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(this.opts.apiKey ? { authorization: `Bearer ${this.opts.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: this.opts.model,
        messages: [
          ...(input.system ? [{ role: 'system', content: input.system }] : []),
          { role: 'user', content: input.prompt },
        ],
        ...(input.json ? { response_format: { type: 'json_object' } } : {}),
        max_tokens: input.maxTokens ?? this.opts.maxTokens ?? 1024,
        temperature: 0.3,
      }),
      signal: AbortSignal.timeout(this.opts.timeoutMs ?? 30_000),
    });
    if (!res.ok) {
      throw new Error(`LLM HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    }
    const body = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const text = body.choices?.[0]?.message?.content;
    if (!text) throw new Error('LLM 返回为空');
    return text;
  }

  /** complete(json=true) 的安全包装：解析失败返回 null 而不抛。 */
  async completeJson<T>(input: CompleteInput): Promise<T | null> {
    try {
      const raw = await this.complete({ ...input, json: true });
      const start = raw.indexOf('{');
      const end = raw.lastIndexOf('}');
      if (start < 0 || end <= start) return null;
      return JSON.parse(raw.slice(start, end + 1)) as T;
    } catch {
      return null;
    }
  }
}
