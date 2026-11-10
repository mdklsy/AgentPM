/**
 * M6 P1-5 敏捷报表（test-plan AGI-01 ~ AGI-08）
 * 周期时间 / CFD 逐日守恒 / Epic 递归 / 空项目。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createWorld, disposeWorld, type TestWorld } from './helpers.js';

let w: TestWorld;

const report = async () => {
  const r = await w.app.inject({
    method: 'GET',
    url: `/v1/projects/${w.projectKey}/reports/agile`,
    headers: { cookie: w.adminCookie },
  });
  expect(r.statusCode).toBe(200);
  return r.json();
};

async function createIssue(title: string, parentId?: string): Promise<string> {
  const r = await w.app.inject({
    method: 'POST',
    url: `/v1/projects/${w.projectKey}/issues`,
    headers: { cookie: w.adminCookie, 'content-type': 'application/json' },
    payload: {
      type: parentId ? 'SUBTASK' : 'TASK',
      title,
      ...(parentId ? { parentIssueKey: parentId } : {}),
    },
  });
  expect(r.statusCode).toBe(201);
  return r.json().issue.issueKey;
}

async function transition(key: string, category: 'IN_PROGRESS' | 'DONE') {
  const detail = await w.app.inject({
    method: 'GET',
    url: `/v1/projects/${w.projectKey}`,
    headers: { cookie: w.adminCookie },
  });
  const wf = detail.json().workflows.find((x: { issueType: string }) => x.issueType === 'TASK');
  const target = wf.states.find((s: { category: string }) => s.category === category).name;
  const r = await w.app.inject({
    method: 'POST',
    url: `/v1/issues/${key}/transition`,
    headers: { cookie: w.adminCookie, 'content-type': 'application/json' },
    payload: { toState: target },
  });
  expect(r.statusCode).toBe(200);
}

beforeAll(async () => {
  w = await createWorld();
});

afterAll(async () => {
  await disposeWorld(w);
});

describe('AGI 敏捷报表', () => {
  it('AGI-08 空项目不炸', async () => {
    const data = await report();
    expect(data.cycleTimes).toEqual([]);
    expect(Array.isArray(data.cfd)).toBe(true);
    expect(data.epics).toEqual([]);
  });

  it('AGI-01/02/03/04 周期时间 + CFD', async () => {
    const a = await createIssue('报表甲');
    const b = await createIssue('报表乙');
    const c = await createIssue('报表丙');
    // a 进入进行中再完成（有周期），b 未进入进行中直接完成（无周期）
    await transition(a, 'IN_PROGRESS');
    await transition(a, 'DONE');
    // 默认迁移表不允许待办直达完成：b 也走两步
    await transition(b, 'IN_PROGRESS');
    await transition(b, 'DONE');

    const data = await report();
    const cycles = data.cycleTimes.map((x: { issueKey: string }) => x.issueKey);
    expect(cycles).toContain(a);
    expect(cycles).toContain(b); // 默认迁移表完成必经进行中 → 有周期
    expect(cycles).not.toContain(c); // 未完成的永不进周期
    const hit = data.cycleTimes.find((x: { issueKey: string }) => x.issueKey === a);
    expect(hit.cycleDays).toBeGreaterThanOrEqual(0);

    // CFD：末日 done 至少含刚完成的 2 个；三态之和 = 当日全部 issue（守恒）
    const last = data.cfd[data.cfd.length - 1];
    expect(last.done).toBeGreaterThanOrEqual(2);
    const sum = last.todo + last.inProgress + last.done;
    const total = await w.app.inject({
      method: 'GET',
      url: `/v1/projects/${w.projectKey}/issues?pageSize=1`,
      headers: { cookie: w.adminCookie },
    });
    expect(sum).toBe(total.json().total);
    expect(c).toBeTruthy();
  });

  it('AGI-05/06 Epic 递归统计', async () => {
    const epic = await w.app.inject({
      method: 'POST',
      url: `/v1/projects/${w.projectKey}/issues`,
      headers: { cookie: w.adminCookie, 'content-type': 'application/json' },
      payload: { type: 'EPIC', title: '大 Epic' },
    });
    expect(epic.statusCode).toBe(201);
    const epicKey = epic.json().issue.issueKey;

    const story = await w.app.inject({
      method: 'POST',
      url: `/v1/projects/${w.projectKey}/issues`,
      headers: { cookie: w.adminCookie, 'content-type': 'application/json' },
      payload: { type: 'STORY', title: '故事', parentIssueKey: epicKey },
    });
    const storyKey = story.json().issue.issueKey;
    const grandchild = await createIssue('孙任务', storyKey);

    await transition(grandchild, 'IN_PROGRESS');
    await transition(grandchild, 'DONE');

    const data = await report();
    const e = data.epics.find((x: { key: string }) => x.key === epicKey);
    expect(e).toBeTruthy();
    expect(e.total).toBeGreaterThanOrEqual(2); // story + 孙
    expect(e.done).toBeGreaterThanOrEqual(1); // 孙完成计入
  });

  it('AGI-07 core 服务直调（MCP report.agile 同一封装）返回同构数据', async () => {
    const { agileReport } = await import('@agentpm/core');
    const admin = await w.db.actor.findUniqueOrThrow({ where: { name: 'admin' } });
    const data = await agileReport(
      { db: w.db, source: 'SYSTEM', actorId: admin.id, actorType: 'HUMAN' } as never,
      w.projectKey,
    );
    expect(Array.isArray(data.cycleTimes)).toBe(true);
    expect(Array.isArray(data.cfd)).toBe(true);
    expect(Array.isArray(data.epics)).toBe(true);
    expect(data.cycleTimes.length).toBeGreaterThanOrEqual(1);
  });
});
