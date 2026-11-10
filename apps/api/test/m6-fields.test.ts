/**
 * M6 P1-1 自定义字段（test-plan FLD-01 ~ FLD-12）
 * CRUD / 类型校验 / upsert / 权限 / 级联。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createWorld, disposeWorld, type TestWorld } from './helpers.js';

let w: TestWorld;
let issueKey: string;
const ids: Record<string, string> = {};

const createField = async (payload: Record<string, unknown>, cookie = w.adminCookie) =>
  w.app.inject({
    method: 'POST',
    url: `/v1/projects/${w.projectKey}/fields`,
    headers: { cookie, 'content-type': 'application/json' },
    payload,
  });

const setValues = async (values: Record<string, unknown>, cookie = w.adminCookie) =>
  w.app.inject({
    method: 'PUT',
    url: `/v1/issues/${issueKey}/fields`,
    headers: { cookie, 'content-type': 'application/json' },
    payload: { values },
  });

async function getDetail() {
  const r = await w.app.inject({
    method: 'GET',
    url: `/v1/issues/${issueKey}`,
    headers: { cookie: w.adminCookie },
  });
  return r.json().issue;
}

beforeAll(async () => {
  w = await createWorld();
  const res = await w.app.inject({
    method: 'POST',
    url: `/v1/projects/${w.projectKey}/issues`,
    headers: { cookie: w.adminCookie, 'content-type': 'application/json' },
    payload: { type: 'TASK', title: '字段宿主' },
  });
  issueKey = res.json().issue.issueKey;
  for (const [name, payload] of [
    ['备注', { name: '备注', type: 'text' }],
    ['工时估分', { name: '工时估分', type: 'number' }],
    ['截止日', { name: '截止日', type: 'date' }],
    ['风险', { name: '风险', type: 'select', options: ['高', '中', '低'] }],
  ] as const) {
    const r = await createField(payload as Record<string, unknown>);
    expect(r.statusCode).toBe(201);
    ids[name] = r.json().field.id;
  }
});

afterAll(async () => {
  await disposeWorld(w);
});

describe('FLD 自定义字段', () => {
  it('FLD-01 四类字段创建可见', async () => {
    const r = await w.app.inject({
      method: 'GET',
      url: `/v1/projects/${w.projectKey}/fields`,
      headers: { cookie: w.adminCookie },
    });
    const names = r.json().fields.map((f: { name: string }) => f.name);
    expect(names).toEqual(expect.arrayContaining(['备注', '工时估分', '截止日', '风险']));
  });

  it('FLD-02 同名拒绝', async () => {
    const r = await createField({ name: '备注', type: 'text' });
    expect([400, 409]).toContain(r.statusCode);
  });

  it('FLD-03 select 缺 options 拒绝', async () => {
    const r = await createField({ name: '坏选项', type: 'select' });
    expect(r.statusCode).toBe(400);
  });

  it('FLD-04 number 类型拒绝文本', async () => {
    expect((await setValues({ [ids['工时估分']!]: 'abc' })).statusCode).toBe(400);
    expect((await setValues({ [ids['工时估分']!]: 42 })).statusCode).toBe(200);
  });

  it('FLD-05 date 类型校验', async () => {
    expect((await setValues({ [ids['截止日']!]: 'not-a-date' })).statusCode).toBe(400);
    expect((await setValues({ [ids['截止日']!]: '2026-11-10' })).statusCode).toBe(200);
  });

  it('FLD-06 select 限选项', async () => {
    expect((await setValues({ [ids['风险']!]: '超高' })).statusCode).toBe(400);
    expect((await setValues({ [ids['风险']!]: '高' })).statusCode).toBe(200);
  });

  it('FLD-07 重复写值 = upsert 单条', async () => {
    await setValues({ [ids['备注']!]: '第一遍' });
    await setValues({ [ids['备注']!]: '第二遍' });
    const detail = await getDetail();
    const vals = detail.fields.filter((f: { fieldId: string }) => f.fieldId === ids['备注']);
    expect(vals).toHaveLength(1);
    expect(vals[0].value).toBe('第二遍');
  });

  it('FLD-08 传 null 清空值', async () => {
    await setValues({ [ids['备注']!]: null });
    const detail = await getDetail();
    const row = detail.fields.find((f: { fieldId: string }) => f.fieldId === ids['备注']);
    expect(row?.value === null || row?.value === undefined).toBe(true);
  });

  it('FLD-09 详情带出 name/type/value/options', async () => {
    await setValues({ [ids['风险']!]: '中' });
    const detail = await getDetail();
    const risk = detail.fields.find((f: { fieldId: string }) => f.fieldId === ids['风险']);
    expect(risk.type).toBe('select');
    expect(risk.value).toBe('中');
    expect(risk.options).toEqual(['高', '中', '低']);
  });

  it('FLD-10 MEMBER 不能管理字段但能写值', async () => {
    expect((await createField({ name: '越权', type: 'text' }, w.user2Cookie)).statusCode).toBe(403);
    expect((await setValues({ [ids['备注']!]: '成员可写' }, w.user2Cookie)).statusCode).toBe(200);
  });

  it('FLD-11 删除字段后详情不再带出', async () => {
    const extra = await createField({ name: '临时字段', type: 'text' });
    const tempId = extra.json().field.id;
    await setValues({ [tempId]: '会有值' });
    await w.app.inject({
      method: 'DELETE',
      url: `/v1/projects/${w.projectKey}/fields/${tempId}`,
      headers: { cookie: w.adminCookie },
    });
    const detail = await getDetail();
    expect(detail.fields.some((f: { fieldId: string }) => f.fieldId === tempId)).toBe(false);
  });

  it('FLD-12 PATCH 改名不改已存值', async () => {
    await setValues({ [ids['工时估分']!]: 7 });
    await w.app.inject({
      method: 'PATCH',
      url: `/v1/projects/${w.projectKey}/fields/${ids['工时估分']}`,
      headers: { cookie: w.adminCookie, 'content-type': 'application/json' },
      payload: { name: '工时估分改' },
    });
    const detail = await getDetail();
    const row = detail.fields.find((f: { fieldId: string }) => f.fieldId === ids['工时估分']);
    expect(row.name).toBe('工时估分改');
    expect(row.value).toBe(7);
  });
});
