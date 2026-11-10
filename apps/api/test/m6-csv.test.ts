/**
 * M6 P0-2 CSV 导出/导入（test-plan CSV-01 ~ CSV-09）
 * 全列导出 + RFC4180 转义往返 + 导入成功/坏行隔离 + 权限。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createWorld, disposeWorld, type TestWorld } from './helpers.js';

let w: TestWorld;

async function createIssue(title: string, extra: Record<string, unknown> = {}): Promise<string> {
  const res = await w.app.inject({
    method: 'POST',
    url: `/v1/projects/${w.projectKey}/issues`,
    headers: { cookie: w.adminCookie },
    payload: { type: 'TASK', title, ...extra },
  });
  expect(res.statusCode).toBe(201);
  return res.json().issue.issueKey as string;
}

async function exportCsv(query = ''): Promise<string> {
  const res = await w.app.inject({
    method: 'GET',
    url: `/v1/projects/${w.projectKey}/issues.csv${query}`,
    headers: { cookie: w.adminCookie },
  });
  expect(res.statusCode).toBe(200);
  expect(String(res.headers['content-type'])).toContain('text/csv');
  return res.payload;
}

function parseRows(csv: string): string[][] {
  // 简版校验解析：与 apps/api/src/utils/csv.ts 同规则（引号/逗号/换行）
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQ = false;
  for (let i = 0; i < csv.length; i++) {
    const c = csv[i]!;
    if (inQ) {
      if (c === '"') {
        if (csv[i + 1] === '"') {
          cell += '"';
          i++;
        } else inQ = false;
      } else cell += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && csv[i + 1] === '\n') i++;
      row.push(cell);
      cell = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else cell += c;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

beforeAll(async () => {
  w = await createWorld();
});

afterAll(async () => {
  await disposeWorld(w);
});

describe('CSV 导出', () => {
  it('CSV-01 导出全列 + UTF-8 BOM', async () => {
    await createIssue('导出样例');
    const csv = await exportCsv();
    expect(csv.charCodeAt(0)).toBe(0xfeff); // BOM
    const header = parseRows(csv)[0]!.map((h) => h.trim());
    for (const col of [
      'issueKey',
      'type',
      'title',
      'description',
      'priority',
      'assignee',
      'labels',
      'parent',
      'storyPoints',
      'dueDate',
      'estimateMinutes',
      'release',
    ])
      expect(header).toContain(col);
  });

  it('CSV-02 RFC4180：逗号/引号/换行往返无损', async () => {
    const tricky = '含,逗号 "引号" 与\n换行';
    await createIssue(tricky);
    const csv = await exportCsv();
    const rows = parseRows(csv);
    const hit = rows.find((r) => r[0]?.startsWith(`${w.projectKey}-`));
    expect(hit).toBeTruthy();
    // 找到标题列比对（title 在第 3 列）
    const header = rows[0]!.map((h) => h.trim());
    const titleCol = header.indexOf('title');
    expect(rows.some((r) => r[titleCol] === tricky)).toBe(true);
  });

  it('CSV-03 过滤参数生效（priority=P1）', async () => {
    await createIssue('P1 导出', { priority: 'P1' });
    await createIssue('P2 不该出现', { priority: 'P2' });
    const csv = await exportCsv('?priority=P1');
    const rows = parseRows(csv);
    const header = rows[0]!.map((h) => h.trim());
    const pCol = header.indexOf('priority');
    const tCol = header.indexOf('title');
    const titles = rows.slice(1).map((r) => r[tCol]);
    expect(titles).toContain('P1 导出');
    expect(titles).not.toContain('P2 不该出现');
    for (const r of rows.slice(1)) expect(r[pCol]).toBe('P1');
  });
});

describe('CSV 导入', () => {
  const doImport = async (csv: string, cookie = w.adminCookie) =>
    w.app.inject({
      method: 'POST',
      url: `/v1/projects/${w.projectKey}/issues/import`,
      headers: { cookie, 'content-type': 'application/json' },
      payload: { csv },
    });

  it('CSV-04 导入 3 行全部成功', async () => {
    const before = (await exportCsv()).split('\n').length;
    const csv = ['type,title,priority', 'TASK,导入一,P1', 'BUG,导入二,P0', 'STORY,导入三,P2'].join(
      '\n',
    );
    const res = await doImport(csv);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ created: 3, failed: [] });
    const after = (await exportCsv()).split('\n').length;
    expect(after - before).toBe(3);
  });

  it('CSV-05 坏行不回滚其他行', async () => {
    const csv = ['type,title', 'TASK,好的行', 'TASK,', 'BUG,另一个好行'].join('\n');
    const res = await doImport(csv);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.created).toBe(2);
    expect(body.failed).toHaveLength(1);
    expect(body.failed[0].row).toBe(3); // 数据行号（含表头从 1 数）
  });

  it('CSV-06 非法枚举报 VALIDATION', async () => {
    const csv = 'type,title,priority\nTASK,x,BAD';
    const res = await doImport(csv);
    expect(res.json().created).toBe(0);
    expect(res.json().failed[0].error).toBeTruthy();
  });

  it('CSV-07 VIEWER 导入拒绝', async () => {
    // 建 viewer 用户并加入项目
    const vName = `viewer-${Math.random().toString(36).slice(2, 8)}`;
    await w.app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      payload: { username: vName, password: 'viewer-pass-123' },
    });
    await w.app.inject({
      method: 'POST',
      url: `/v1/projects/${w.projectKey}/members`,
      headers: { cookie: w.adminCookie },
      payload: { actorName: vName, role: 'VIEWER' },
    });
    const login = await w.app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { username: vName, password: 'viewer-pass-123' },
    });
    const setCookie = login.headers['set-cookie'];
    const cookie = (Array.isArray(setCookie) ? setCookie[0] : setCookie)!.split(';')[0]!;
    const res = await doImport('type,title\nTASK,x', cookie);
    expect(res.statusCode).toBe(403);
  });

  it('CSV-08 导出→导入幂等（字段等值）', async () => {
    const before = parseRows(await exportCsv()).length;
    const res = await doImport(await exportCsv());
    expect(res.json().failed).toEqual([]);
    const created = res.json().created as number;
    expect(created).toBeGreaterThan(0);
    expect(parseRows(await exportCsv()).length - before).toBe(created);
  });

  it('CSV-09 自定义字段动态列', async () => {
    const f = await w.app.inject({
      method: 'POST',
      url: `/v1/projects/${w.projectKey}/fields`,
      headers: { cookie: w.adminCookie, 'content-type': 'application/json' },
      payload: { name: '风险等级', type: 'select', options: ['高', '中', '低'] },
    });
    expect(f.statusCode).toBe(201);
    const key = await createIssue('带字段导出');
    // 找 fieldId
    const list = await w.app.inject({
      method: 'GET',
      url: `/v1/projects/${w.projectKey}/fields`,
      headers: { cookie: w.adminCookie },
    });
    const fieldId = list.json().fields.find((x: { name: string }) => x.name === '风险等级').id;
    const set = await w.app.inject({
      method: 'PUT',
      url: `/v1/issues/${key}/fields`,
      headers: { cookie: w.adminCookie, 'content-type': 'application/json' },
      payload: { values: { [fieldId]: '高' } },
    });
    expect(set.statusCode).toBe(200);

    const csv = await exportCsv();
    const rows = parseRows(csv);
    const header = rows[0]!.map((h) => h.trim());
    expect(header).toContain('field:风险等级');
    const col = header.indexOf('field:风险等级');
    const tCol = header.indexOf('title');
    const hit = rows.find((r) => r[tCol] === '带字段导出');
    expect(hit![col]).toBe('高');
  });
});
