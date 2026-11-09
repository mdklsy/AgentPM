import { describe, expect, it } from 'vitest';
import { ClaimIssueSchema, CreateIssueSchema, RegressionSubmitSchema } from '../src/schemas.js';
import { parseProjectSettings } from '../src/settings.js';

describe('CreateIssueSchema', () => {
  it('SUBTASK 必须带 parentIssueKey', () => {
    const bad = CreateIssueSchema.safeParse({ type: 'SUBTASK', title: 'x' });
    expect(bad.success).toBe(false);
    const ok = CreateIssueSchema.safeParse({
      type: 'SUBTASK',
      title: 'x',
      parentIssueKey: 'APM-1',
    });
    expect(ok.success).toBe(true);
  });
});

describe('ClaimIssueSchema', () => {
  it('空参数被拒绝', () => {
    expect(ClaimIssueSchema.safeParse({}).success).toBe(false);
  });
  it('只给 label 合法', () => {
    expect(ClaimIssueSchema.safeParse({ label: 'good-first' }).success).toBe(true);
  });
});

describe('RegressionSubmitSchema', () => {
  it('至少一条用例', () => {
    expect(RegressionSubmitSchema.safeParse({ suite: 'unit', results: [] }).success).toBe(false);
    expect(
      RegressionSubmitSchema.safeParse({
        suite: 'unit',
        results: [{ name: 'a', status: 'PASS' }],
      }).success,
    ).toBe(true);
  });
});

describe('parseProjectSettings', () => {
  it('坏数据回退默认值', () => {
    const s = parseProjectSettings({ agentPolicy: 'garbage' });
    expect(s.agentPolicy.maxConcurrentClaims).toBe(3);
  });
  it('正常解析并保留未知字段丢弃', () => {
    const s = parseProjectSettings({ agentPolicy: { maxConcurrentClaims: 9 } });
    expect(s.agentPolicy.maxConcurrentClaims).toBe(9);
    expect(s.agentPolicy.bugCreate).toBe('auto');
  });
});
