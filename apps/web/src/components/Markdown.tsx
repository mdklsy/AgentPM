import { useMemo } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';

/** Markdown 渲染（M6）：marked 解析 + DOMPurify 消毒；空文本回退纯显示。 */
export function Markdown({ text, className = '' }: { text: string | null; className?: string }) {
  const html = useMemo(() => {
    if (!text?.trim()) return null;
    const raw = marked.parse(text, { async: false, breaks: true }) as string;
    return DOMPurify.sanitize(raw);
  }, [text]);

  if (!html) return <div className={`text-sm text-slate-300 ${className}`}>（无内容）</div>;
  return (
    <div
      className={`md-body text-sm leading-relaxed text-slate-700 ${className}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
