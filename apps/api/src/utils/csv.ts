/**
 * 小型 RFC4180 CSV 解析/序列化（M6）：
 * - 解析支持引号包裹、内嵌逗号/换行、双引号转义
 * - 序列化按需给字段加引号；CRLF 行尾
 */

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  const s = text.replace(/^\uFEFF/, ''); // BOM

  while (i < s.length) {
    const c = s[i]!;
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += c;
      i += 1;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (c === ',') {
      row.push(field);
      field = '';
      i += 1;
      continue;
    }
    if (c === '\r' || c === '\n') {
      if (c === '\r' && s[i + 1] === '\n') i += 1;
      row.push(field);
      field = '';
      rows.push(row);
      row = [];
      i += 1;
      continue;
    }
    field += c;
    i += 1;
  }
  // 收尾：最后一行未以换行结束
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  // 去掉全空行
  return rows.filter((r) => !(r.length === 1 && r[0] === ''));
}

function escapeCell(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(headers: string[], rows: Array<Array<unknown>>): string {
  const lines = [
    headers.map(escapeCell).join(','),
    ...rows.map((r) => r.map(escapeCell).join(',')),
  ];
  // UTF-8 BOM：让 Excel 直接打开不乱码
  return '\uFEFF' + lines.join('\r\n') + '\r\n';
}
