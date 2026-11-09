/**
 * 替身 worker 入口：
 *   pnpm --filter @agentpm/avatar-worker once          # 跑一轮退出（cron / CI / 手动）
 *   pnpm --filter @agentpm/avatar-worker start         # 常驻轮询（AVATAR_INTERVAL_MIN，默认 15）
 * 参数：--token apm_xxx / --url http://... / --project KEY（定向巡检）；
 * 环境变量等价：AVATAR_TOKEN、AGENTPM_API_URL（CLI 参数优先），
 *               LLM_BASE_URL / LLM_MODEL / LLM_API_KEY（可选，启用 LLM 叙述增强）
 */
import { loadEnv } from '@agentpm/shared/node';
import { LlmAdapter } from '@agentpm/llm-adapter';
import { runOnce } from './run.js';

loadEnv();

const args = process.argv.slice(2);
const once = args.includes('--once') || args.includes('once');
const flag = (name: string): string | undefined => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const apiUrl = flag('--url') ?? process.env.AGENTPM_API_URL ?? 'http://127.0.0.1:3000';
const token = flag('--token') ?? process.env.AVATAR_TOKEN;
const projectKey = flag('--project');
const intervalMin = Number(process.env.AVATAR_INTERVAL_MIN ?? 15);

if (!token) {
  console.error(
    '缺少替身 token：加参数 --token apm_xxx，或在 .env 设置 AVATAR_TOKEN（创建替身见监控中心页）',
  );
  process.exit(1);
}
const AVATAR_TOKEN: string = token;

const llm = LlmAdapter.fromEnv();
const log = (m: string) => console.info(`[avatar] ${new Date().toLocaleTimeString('zh-CN')} ${m}`);

async function tick() {
  try {
    const r = await runOnce({ apiUrl, token: AVATAR_TOKEN, llm, log, projectKey });
    for (const p of r.projects) {
      log(
        `  ${p.key}: ${p.action}${p.risks ? `（${p.risks} 项风险）` : ''}${p.reason ? ` — ${p.reason}` : ''}`,
      );
    }
  } catch (e) {
    console.error(`[avatar] 运行失败：${(e as Error).message}`);
    if (once) process.exit(1);
  }
}

log(
  `替身 worker 启动 · API=${apiUrl} · 模式=${once ? '单次' : `每 ${intervalMin} 分钟`} · 范围=${projectKey ?? '全部项目'} · LLM=${llm ? llm.model : '未配置（纯规则）'}`,
);
await tick();
if (!once) {
  setInterval(() => void tick(), intervalMin * 60_000);
}
