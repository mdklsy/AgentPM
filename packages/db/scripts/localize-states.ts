/**
 * 存量数据库工作流状态中文化（一次性维护脚本，幂等）：
 * 1. WorkflowState.name：精确匹配旧英文默认名（Open/In Progress/Done/…）才改；
 * 2. Activity.detail：issue.transitioned 历史里的 from/to 名字字符串同步改写
 *    （燃尽回放按"当前状态名"映射 category，不改历史会导致改名前的完成点被当成未完成）；
 * 3. ApprovalRequest.payload.toState：审批通过后要按它重放流转，必须同步。
 * 用法：pnpm --filter @agentpm/db exec tsx scripts/localize-states.ts
 */
import { loadEnv } from '@agentpm/shared/node';
import { createPrisma } from '../src/index.js';
import { LEGACY_STATE_NAME_MAP } from '../src/workflows.js';

loadEnv();

const db = createPrisma();

const OLD_NAMES = Object.keys(LEGACY_STATE_NAME_MAP);

async function main() {
  // 1. 改状态名
  const states = await db.workflowState.findMany({
    where: { name: { in: OLD_NAMES } },
    select: { id: true, name: true },
  });
  for (const s of states) {
    const next = LEGACY_STATE_NAME_MAP[s.name];
    if (!next || next === s.name) continue;
    await db.workflowState.update({ where: { id: s.id }, data: { name: next } });
    console.info(`[states] ${s.name} → ${next}`);
  }
  console.info(`[states] 共改写 ${states.length} 个状态`);

  // 2. 改历史审计里的状态名字符串（Activity.detail.from / detail.to）
  const activities = await db.activity.findMany({
    where: { action: 'issue.transitioned' },
    select: { id: true, detail: true },
  });
  let actCount = 0;
  for (const a of activities) {
    const detail = (a.detail ?? {}) as { from?: string; to?: string };
    const from = detail.from ? (LEGACY_STATE_NAME_MAP[detail.from] ?? detail.from) : detail.from;
    const to = detail.to ? (LEGACY_STATE_NAME_MAP[detail.to] ?? detail.to) : detail.to;
    if (from !== detail.from || to !== detail.to) {
      await db.activity.update({ where: { id: a.id }, data: { detail: { ...detail, from, to } } });
      actCount += 1;
    }
  }
  console.info(`[activity] issue.transitioned 改写 ${actCount} 条`);

  // 3. 改待审批 payload 里的 toState
  const approvals = await db.approvalRequest.findMany({
    where: { status: 'PENDING' },
    select: { id: true, payload: true },
  });
  let apCount = 0;
  for (const ap of approvals) {
    const payload = (ap.payload ?? {}) as { toState?: string };
    const toState = payload.toState
      ? (LEGACY_STATE_NAME_MAP[payload.toState] ?? payload.toState)
      : payload.toState;
    if (toState !== payload.toState) {
      await db.approvalRequest.update({
        where: { id: ap.id },
        data: { payload: { ...payload, toState } },
      });
      apCount += 1;
    }
  }
  console.info(`[approvals] payload.toState 改写 ${apCount} 条`);
}

main()
  .catch((e) => {
    console.error('[localize-states] failed:', e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
