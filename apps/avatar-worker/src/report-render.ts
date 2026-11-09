import type { Insights, Risk } from './analysis.js';

/** 把规则洞察 +（可选）LLM 叙述渲染成报告 Markdown。纯函数。 */
export function renderReport(input: {
  projectName: string;
  kind: 'DAILY_DIGEST' | 'RISK_ALERT';
  insights: Insights;
  llm?: { summary?: string; keyRisks?: string[]; suggestions?: string[] } | null;
  window: { from: string; to: string };
  avatarName: string;
  engine: 'rules' | 'rules+llm';
}): { title: string; content: string } {
  const { insights, llm } = input;
  const sev = { HIGH: '【高】', MEDIUM: '【中】', LOW: '【低】' } as const;
  const lines: string[] = [];

  lines.push(input.kind === 'RISK_ALERT' ? '## 风险告警' : '## 日报');
  lines.push(insights.headline);
  lines.push('');

  if (llm?.summary) {
    lines.push('### 结论（LLM）');
    lines.push(llm.summary);
    lines.push('');
  }

  if (insights.risks.length || llm?.keyRisks?.length) {
    lines.push('### 风险');
    for (const r of insights.risks) {
      lines.push(`- ${sev[r.severity]} **${riskLabel(r)}**：${r.message}`);
    }
    for (const r of llm?.keyRisks ?? []) {
      lines.push(`- 【补充】${r}`);
    }
    lines.push('');
  } else {
    lines.push('### 风险');
    lines.push('- 未发现需要关注的风险');
    lines.push('');
  }

  const suggestions = [...insights.suggestions, ...(llm?.suggestions ?? [])];
  if (suggestions.length) {
    lines.push('### 建议');
    suggestions.forEach((s, i) => lines.push(`${i + 1}. ${s}`));
    lines.push('');
  }

  lines.push('---');
  lines.push(
    `> 由 PM 替身 **${input.avatarName}** 生成 · 数据窗口 ${input.window.from.slice(0, 16)} ~ ${input.window.to.slice(0, 16)} · 引擎：${input.engine === 'rules+llm' ? '规则 + LLM' : '规则（未配置 LLM）'} · 本报告基于审计流重建，可在监控中心追溯`,
  );

  const worst = insights.risks[0]?.severity;
  const title =
    input.kind === 'RISK_ALERT'
      ? `${input.projectName}：${insights.risks.length} 项风险（最高${worst === 'HIGH' ? '高危' : worst === 'MEDIUM' ? '中危' : '低危'}）`
      : `${input.projectName} 日报 ${new Date().toLocaleDateString('zh-CN')}`;
  return { title, content: lines.join('\n') };
}

function riskLabel(r: Risk): string {
  const labels: Record<string, string> = {
    STALLED_TASK: '任务停滞',
    OVERDUE: '逾期',
    SPRINT_BEHIND: '迭代偏离',
    APPROVAL_AGING: '审批积压',
    WORKLOAD_IMBALANCE: '负载不均',
    AGENT_SILENT: 'agent 失联',
  };
  return labels[r.code] ?? r.code;
}
