import { describe, expect, it } from 'vitest';
import { qs } from '../src/api/client.js';

describe('qs 查询串构造', () => {
  it('过滤空值并编码', () => {
    expect(qs({ a: 'x', b: undefined, c: '', d: null, e: 1 })).toBe('?a=x&e=1');
  });
  it('无有效参数返回空串', () => {
    expect(qs({})).toBe('');
    expect(qs({ a: undefined })).toBe('');
  });
  it('中文与特殊字符编码', () => {
    expect(qs({ q: '乱码 测试' })).toBe(`?q=${encodeURIComponent('乱码 测试')}`);
  });
});
