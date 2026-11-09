/**
 * Node 环境专用工具（浏览器端不要从本入口导入）。
 * 通过 `@agentpm/shared/node` 访问。
 */
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TOKEN_PREFIX } from './constants.js';

/* ------------------------------------------------------------------- env */

/**
 * 加载根目录 .env 到 process.env（不覆盖已有值）。
 * 从任意 workspace 包内逐级向上定位仓库根目录下的 .env。
 */
export function loadEnv(): void {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    const candidate = join(dir, '.env');
    if (existsSync(candidate)) {
      for (const line of readFileSync(candidate, 'utf8').split(/\r?\n/)) {
        const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
        if (!m) continue;
        const key = m[1]!;
        let value = m[2]!;
        if (
          (value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))
        ) {
          value = value.slice(1, -1);
        }
        if (process.env[key] === undefined) process.env[key] = value;
      }
      return;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
}

export function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required environment variable: ${name}`);
  return v;
}

/* ---------------------------------------------------------------- tokens */

/** 生成 API token：明文形如 apm_<43 chars base64url>，仅创建时可见 */
export function generateApiToken(): string {
  return TOKEN_PREFIX + randomBytes(32).toString('base64url');
}

export function hashApiToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** token 展示前缀（用于后台识别是哪个 token） */
export function tokenDisplayPrefix(token: string): string {
  return token.slice(0, 12);
}

export { resolve };
