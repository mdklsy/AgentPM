import { z } from 'zod';

/**
 * 项目级 agent 策略（存于 Project.settings，见 ADR 0004）。
 * conservative preset：高危动作全部需要审批；open preset：agent 全自动。
 */
export const AgentPolicySchema = z.object({
  /** 单个 agent 在本项目内同时"领取中"的 issue 上限 */
  maxConcurrentClaims: z.number().int().min(1).max(50).default(3),
  /** agent 提 bug：auto 直接建单；approval 需人工审批后建单 */
  bugCreate: z.enum(['auto', 'approval']).default('auto'),
  /** agent 把 issue 流转到 DONE 类状态：auto 直接流转；approval 需人工审批 */
  completeTransition: z.enum(['auto', 'approval']).default('auto'),
  /** regression.submit 的失败用例是否自动建 bug（仍走指纹去重） */
  autoFileRegressionBugs: z.boolean().default(true),
});
export type AgentPolicy = z.infer<typeof AgentPolicySchema>;

export const ProjectSettingsSchema = z.object({
  agentPolicy: AgentPolicySchema.default(AgentPolicySchema.parse({})),
});
export type ProjectSettings = z.infer<typeof ProjectSettingsSchema>;

export const DEFAULT_PROJECT_SETTINGS: ProjectSettings = ProjectSettingsSchema.parse({});

/** 审批策略预设，创建项目/改设置时可直接引用 */
export const AGENT_POLICY_PRESETS = {
  open: {
    maxConcurrentClaims: 5,
    bugCreate: 'auto',
    completeTransition: 'auto',
    autoFileRegressionBugs: true,
  },
  balanced: {
    maxConcurrentClaims: 3,
    bugCreate: 'auto',
    completeTransition: 'approval',
    autoFileRegressionBugs: true,
  },
  conservative: {
    maxConcurrentClaims: 2,
    bugCreate: 'approval',
    completeTransition: 'approval',
    autoFileRegressionBugs: false,
  },
} as const;

/** 从任意 JSON（DB 列）解析出合法项目设置，坏数据时回退默认值。 */
export function parseProjectSettings(raw: unknown): ProjectSettings {
  const parsed = ProjectSettingsSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : DEFAULT_PROJECT_SETTINGS;
}
