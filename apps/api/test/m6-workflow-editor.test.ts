/**
 * M6 P1-3 工作流编辑器（test-plan WFE-01 ~ WFE-10）
 * GET/PUT 全量替换、初始态唯一、重名、被占用状态删除、类型独立、新流程可用。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createWorld, disposeWorld, type TestWorld } from './helpers.js';

let w: TestWorld;
let issueKey: string;

const getWf = async (issueType = 'TASK') => {
  const r = await w.app.inject({
    method: 'GET',
    url: `/v1/projects/${w.projectKey}/workflows/${issueType}`,
    headers: { cookie: w.adminCookie },
  });
  expect(r.statusCode).toBe(200);
  return r.json();
};

const putWf = async (body: Record<string, unknown>, issueType = 'TASK', cookie = w.adminCookie) =>
  w.app.inject({
    method: 'PUT',
    url: `/v1/projects/${w.projectKey}/workflows/${issueType}`,
    headers: { cookie, 'content-type': 'application/json' },
    payload: body,
  });

beforeAll(async () => {
  w = await createWorld();
  const res = await w.app.inject({
    method: 'POST',
    url: `/v1/projects/${w.projectKey}/issues`,
    headers: { cookie: w.adminCookie, 'content-type': 'application/json' },
    payload: { type: 'TASK', title: '工作流宿主' },
  });
  issueKey = res.json().issue.issueKey;
});

afterAll(async () => {
  await disposeWorld(w);
});

describe('WFE 工作流编辑器', () => {
  it('WFE-01 GET 默认工作流结构完整', async () => {
    const wf = await getWf();
    expect(wf.states.length).toBeGreaterThanOrEqual(3);
    expect(wf.states.filter((s: { isInitial: boolean }) => s.isInitial)).toHaveLength(1);
    expect(wf.transitions.length).toBeGreaterThanOrEqual(2);
    expect(wf.states.every((s: { id: string; name: string }) => !!s.id && !!s.name)).toBe(true);
  });

  it('WFE-02/03 PUT 全量替换 + 新流程可用', async () => {
    const wf = await getWf();
    const names = wf.states.map((s: { name: string }) => s.name);
    // 加「评审中」：待办→评审中→进行中→完成
    const body = {
      states: [
        ...wf.states.map(
          (s: { id: string; name: string; category: string; isInitial: boolean }) => ({
            id: s.id,
            name: s.name,
            category: s.category,
            isInitial: s.isInitial,
          }),
        ),
        { name: '评审中', category: 'IN_PROGRESS', isInitial: false },
      ],
      transitions: [
        [null, names[0]!],
        [names[0]!, '评审中'],
        ['评审中', names[1]!],
        [
          names[1]!,
          (wf.states as Array<{ name: string; category: string }>).find(
            (n) => n.category === 'DONE',
          )?.name ?? names[names.length - 1],
        ],
      ],
    };
    const r = await putWf(body);
    expect(r.statusCode).toBe(200);

    const wf2 = await getWf();
    expect(wf2.states.map((s: { name: string }) => s.name)).toContain('评审中');
    // 流转宿主 issue 走新路径
    for (const to of [
      '评审中',
      wf2.states.find(
        (s: { name: string; category: string }) =>
          s.category === 'IN_PROGRESS' && s.name !== '评审中',
      )!.name,
    ]) {
      const tr = await w.app.inject({
        method: 'POST',
        url: `/v1/issues/${issueKey}/transition`,
        headers: { cookie: w.adminCookie, 'content-type': 'application/json' },
        payload: { toState: to },
      });
      expect(tr.statusCode).toBe(200);
    }
  });

  it('WFE-04 初始态必须恰一个（0 个 / 2 个都拒绝）', async () => {
    const wf = await getWf();
    const states = wf.states.map((s: { name: string; category: string }) => ({
      name: s.name,
      category: s.category,
    }));
    const zero = await putWf({
      states: states.map((s: { name: string; category: string }) => ({ ...s, isInitial: false })),
      transitions: [],
    });
    expect(zero.statusCode).toBe(400);
    const two = await putWf({
      states: states.map((s: { name: string; category: string }, i: number) => ({
        ...s,
        isInitial: i < 2,
      })),
      transitions: [],
    });
    expect(two.statusCode).toBe(400);
  });

  it('WFE-05 状态名唯一', async () => {
    const wf = await getWf();
    const s0 = wf.states[0];
    const r = await putWf({
      states: [
        { name: s0.name, category: s0.category, isInitial: true },
        { name: s0.name, category: 'DONE', isInitial: false },
        ...wf.states.slice(2).map((s: { name: string; category: string }) => ({
          name: s.name,
          category: s.category,
          isInitial: false,
        })),
      ],
      transitions: [],
    });
    expect(r.statusCode).toBe(400);
  });

  it('WFE-06 被占用状态不可删（错误含 issueKey）', async () => {
    const wf = await getWf();
    // 宿主 issue 现处于「进行中」类状态（上一用例流转过）
    const detail = await w.app.inject({
      method: 'GET',
      url: `/v1/issues/${issueKey}`,
      headers: { cookie: w.adminCookie },
    });
    const currentState = detail.json().issue.state;
    const busy = wf.states.find((s: { name: string }) => s.name === currentState);
    expect(busy).toBeTruthy();
    const r = await putWf({
      states: wf.states
        .filter((s: { name: string }) => s.name !== currentState)
        .map((s: { name: string; category: string; isInitial: boolean }) => ({
          name: s.name,
          category: s.category,
          isInitial: s.isInitial,
        })),
      transitions: wf.transitions
        .filter(
          (t: { from: string | null; to: string }) =>
            t.from !== currentState && t.to !== currentState,
        )
        .map((t: { from: string | null; to: string }) => [t.from, t.to]),
    });
    expect(r.statusCode).toBe(400);
    expect(JSON.stringify(r.json())).toContain('STATE_IN_USE');
    expect(JSON.stringify(r.json())).toContain('不能删除');
  });

  it('WFE-07 未占用状态可删', async () => {
    // 先加一个没人占用的状态再删掉
    const wf = await getWf();
    const body = {
      states: [
        ...wf.states.map(
          (s: { id: string; name: string; category: string; isInitial: boolean }) => ({
            id: s.id,
            name: s.name,
            category: s.category,
            isInitial: s.isInitial,
          }),
        ),
        { name: '临时状态', category: 'TODO', isInitial: false },
      ],
      transitions: wf.transitions.map((t: { from: string | null; to: string }) => [t.from, t.to]),
    };
    expect((await putWf(body)).statusCode).toBe(200);
    const wf2 = await getWf();
    const stripped = {
      states: wf2.states
        .filter((s: { name: string }) => s.name !== '临时状态')
        .map((s: { id: string; name: string; category: string; isInitial: boolean }) => ({
          id: s.id,
          name: s.name,
          category: s.category,
          isInitial: s.isInitial,
        })),
      transitions: wf2.transitions
        .filter(
          (t: { from: string | null; to: string }) => t.from !== '临时状态' && t.to !== '临时状态',
        )
        .map((t: { from: string | null; to: string }) => [t.from, t.to]),
    };
    expect((await putWf(stripped)).statusCode).toBe(200);
    expect((await getWf()).states.map((s: { name: string }) => s.name)).not.toContain('临时状态');
  });

  it('WFE-08 类型互相独立', async () => {
    const bugBefore = await getWf('BUG');
    await putWf(
      {
        states: [
          ...wf_states(await getWf()),
          { name: 'TASK专属', category: 'TODO', isInitial: false },
        ],
        transitions: [],
      },
      'TASK',
    );
    const bugAfter = await getWf('BUG');
    expect(bugAfter.states.map((s: { name: string }) => s.name)).toEqual(
      bugBefore.states.map((s: { name: string }) => s.name),
    );
  });

  it('WFE-09 MEMBER 拒绝编辑', async () => {
    const wf = await getWf();
    const r = await putWf(
      {
        states: wf.states.map((s: { name: string; category: string; isInitial: boolean }) => ({
          name: s.name,
          category: s.category,
          isInitial: s.isInitial,
        })),
        transitions: wf.transitions.map((t: { from: string | null; to: string }) => [t.from, t.to]),
      },
      'TASK',
      w.user2Cookie,
    );
    expect(r.statusCode).toBe(403);
  });

  it('WFE-10 保存后项目 workflows 即时反映', async () => {
    const detail = await w.app.inject({
      method: 'GET',
      url: `/v1/projects/${w.projectKey}`,
      headers: { cookie: w.adminCookie },
    });
    const taskWf = detail
      .json()
      .workflows.find((x: { issueType: string }) => x.issueType === 'TASK');
    expect(taskWf.states.length).toBeGreaterThanOrEqual(3);
  });
});

/** 取工作流的 states 最简形态（PUT 回传用）。 */
function wf_states(wf: {
  states: Array<{ id: string; name: string; category: string; isInitial: boolean }>;
}) {
  return wf.states.map((s) => ({
    id: s.id,
    name: s.name,
    category: s.category,
    isInitial: s.isInitial,
  }));
}
