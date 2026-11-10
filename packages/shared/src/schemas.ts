import { z } from 'zod';
import {
  ACTOR_NAME_REGEX,
  ISSUE_KEY_REGEX,
  MAX_COMMENT_LENGTH,
  MAX_DESCRIPTION_LENGTH,
  MAX_REGRESSION_CASES,
  MAX_TITLE_LENGTH,
  PROJECT_KEY_REGEX,
} from './constants.js';
import {
  ActivitySourceSchema,
  ApprovalStatusSchema,
  CaseStatusSchema,
  IssueTypeSchema,
  IssueLinkTypeSchema,
  MemberRoleSchema,
  PrioritySchema,
  ScopeSchema,
  SprintStatusSchema,
  VisibilitySchema,
} from './enums.js';
import { AgentPolicySchema } from './settings.js';

/* ------------------------------------------------------------------ auth */

export const RegisterSchema = z.object({
  username: z.string().regex(ACTOR_NAME_REGEX, '小写字母开头，仅小写字母/数字/中划线'),
  password: z.string().min(8).max(128),
  email: z.string().email().optional(),
  displayName: z.string().min(1).max(128).optional(),
});
export type RegisterInput = z.infer<typeof RegisterSchema>;

export const LoginSchema = z.object({
  username: z.string().min(1).max(64),
  password: z.string().min(1).max(128),
});
export type LoginInput = z.infer<typeof LoginSchema>;

export const CreateTokenSchema = z.object({
  name: z.string().min(1).max(128),
  scopes: z.array(ScopeSchema).min(1).default(['read', 'write', 'mcp']),
  expiresAt: z.coerce.date().optional(),
});
export type CreateTokenInput = z.infer<typeof CreateTokenSchema>;

/* ---------------------------------------------------------------- actors */

export const CreateAgentSchema = z.object({
  name: z.string().regex(ACTOR_NAME_REGEX),
  /** 创建 AGENT（一线干活）或 AVATAR（PM 替身，M5） */
  actorType: z.enum(['AGENT', 'AVATAR']).default('AGENT'),
  displayName: z.string().min(1).max(128).optional(),
  description: z.string().min(1).max(2000),
  model: z.string().max(128).optional(),
  capabilities: z.array(z.string().max(64)).max(32).default([]),
  tokenName: z.string().max(128).optional(),
});
export type CreateAgentInput = z.infer<typeof CreateAgentSchema>;

export const HeartbeatSchema = z.object({
  status: z.enum(['active', 'idle', 'paused']).optional(),
  currentIssueKeys: z.array(z.string().regex(ISSUE_KEY_REGEX)).max(50).optional(),
});
export type HeartbeatInput = z.infer<typeof HeartbeatSchema>;

/* ------------------------------------------------- users（M5.5 实例级团队管理） */

export const CreateUserSchema = z.object({
  name: z.string().regex(ACTOR_NAME_REGEX, '小写字母开头，仅小写字母/数字/中划线'),
  displayName: z.string().min(1).max(128),
  email: z.string().email().optional(),
  password: z.string().min(8).max(128),
  isAdmin: z.boolean().default(false),
  /** 首次登录强制改密（管理员代建账号时建议开启） */
  mustChangePassword: z.boolean().default(false),
});
export type CreateUserInput = z.infer<typeof CreateUserSchema>;

/** 管理员改用户：重置密码（置 mustChangePassword）、启停、管理员开关等 */
export const AdminUpdateUserSchema = z.object({
  displayName: z.string().min(1).max(128).optional(),
  email: z.string().email().nullable().optional(),
  isAdmin: z.boolean().optional(),
  isActive: z.boolean().optional(),
  newPassword: z.string().min(8).max(128).optional(),
});
export type AdminUpdateUserInput = z.infer<typeof AdminUpdateUserSchema>;

/** 本人改自己：只能改显示名（头像走独立端点，密码走 change-password） */
export const SelfUpdateSchema = z.object({
  displayName: z.string().min(1).max(128).optional(),
});
export type SelfUpdateInput = z.infer<typeof SelfUpdateSchema>;

/** 头像 data URL（image/*，base64 解码后 ≤256KB；前端上传前压缩到 128px） */
export const AvatarDataSchema = z
  .string()
  .regex(
    /^data:image\/(png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/=]+$/,
    '仅支持 png/jpeg/webp/gif 的 data URL',
  )
  .refine((s) => (s.split(',')[1]?.length ?? 0) * 0.75 <= 256 * 1024, '头像不能超过 256KB');
export type AvatarData = z.infer<typeof AvatarDataSchema>;

/* --------------------------------------------------------------- project */

export const CreateProjectSchema = z.object({
  key: z.string().regex(PROJECT_KEY_REGEX, '2-10 位大写字母/数字/下划线，字母开头'),
  name: z.string().min(1).max(128),
  description: z.string().max(MAX_DESCRIPTION_LENGTH).optional(),
  visibility: VisibilitySchema.default('PRIVATE'),
  agentPolicy: AgentPolicySchema.partial().optional(),
});
export type CreateProjectInput = z.infer<typeof CreateProjectSchema>;

export const UpdateProjectSchema = z.object({
  name: z.string().min(1).max(128).optional(),
  description: z.string().max(MAX_DESCRIPTION_LENGTH).nullable().optional(),
  visibility: VisibilitySchema.optional(),
  archived: z.boolean().optional(),
  agentPolicy: AgentPolicySchema.partial().optional(),
});

export const AddMemberSchema = z.object({
  actorName: z.string().min(1).max(64),
  role: MemberRoleSchema,
});
export type AddMemberInput = z.infer<typeof AddMemberSchema>;

export const UpdateMemberSchema = z.object({
  role: MemberRoleSchema.exclude(['OWNER']),
});

export const CreateSprintSchema = z.object({
  name: z.string().min(1).max(128),
  goal: z.string().max(2000).optional(),
  startsAt: z.coerce.date().optional(),
  endsAt: z.coerce.date().optional(),
  status: SprintStatusSchema.default('PLANNED'),
});
export type CreateSprintInput = z.infer<typeof CreateSprintSchema>;

/* ----------------------------------------------------------------- issue */

export const CreateIssueSchema = z
  .object({
    type: IssueTypeSchema,
    title: z.string().min(1).max(MAX_TITLE_LENGTH),
    description: z.string().max(MAX_DESCRIPTION_LENGTH).optional(),
    priority: PrioritySchema.default('P2'),
    assigneeName: z.string().max(64).optional(),
    parentIssueKey: z.string().regex(ISSUE_KEY_REGEX).optional(),
    labelNames: z.array(z.string().min(1).max(64)).max(20).default([]),
    storyPoints: z.number().int().min(0).max(200).optional(),
    dueDate: z.coerce.date().optional(),
    /** BUG 专用：稳定指纹（如 test:Class#method），用于去重 */
    fingerprint: z.string().min(3).max(191).optional(),
    environment: z.string().max(255).optional(),
    sprintId: z.string().min(1).optional(),
    /** 版本 id（M6） */
    releaseId: z.string().min(1).optional(),
    /** 工时预估（分钟，M6） */
    estimateMinutes: z.number().int().min(0).max(1_000_000).optional(),
  })
  .refine((v) => v.type !== 'SUBTASK' || !!v.parentIssueKey, {
    message: 'SUBTASK 必须指定 parentIssueKey',
    path: ['parentIssueKey'],
  });
export type CreateIssueInput = z.infer<typeof CreateIssueSchema>;

export const UpdateIssueSchema = z.object({
  title: z.string().min(1).max(MAX_TITLE_LENGTH).optional(),
  description: z.string().max(MAX_DESCRIPTION_LENGTH).optional(),
  priority: PrioritySchema.optional(),
  storyPoints: z.number().int().min(0).max(200).nullable().optional(),
  dueDate: z.coerce.date().nullable().optional(),
  labelNames: z.array(z.string().min(1).max(64)).max(20).optional(),
  /** 版本 id；null = 移出版本（M6） */
  releaseId: z.string().min(1).nullable().optional(),
  /** 工时预估分钟；null = 清除（M6） */
  estimateMinutes: z.number().int().min(0).max(1_000_000).nullable().optional(),
});
export type UpdateIssueInput = z.infer<typeof UpdateIssueSchema>;

/* ---------------------------------------------------- worklog（M6 工时） */

export const AddWorklogSchema = z.object({
  minutes: z.number().int().min(1).max(100_000),
  spentAt: z.coerce.date().optional(),
  comment: z.string().max(1000).optional(),
});
export type AddWorklogInput = z.infer<typeof AddWorklogSchema>;

/* ---------------------------------------------------- bulk（M6 批量操作） */

export const BulkIssueSchema = z
  .object({
    issueKeys: z.array(z.string().regex(ISSUE_KEY_REGEX)).min(1).max(100),
    action: z.enum(['transition', 'assign', 'priority', 'sprint']),
    toState: z.string().min(1).max(64).optional(),
    assigneeName: z.string().max(64).nullable().optional(),
    priority: PrioritySchema.optional(),
    sprintId: z.string().min(1).nullable().optional(),
  })
  .refine(
    (v) =>
      (v.action === 'transition' && !!v.toState) ||
      (v.action === 'assign' && v.assigneeName !== undefined) ||
      (v.action === 'priority' && !!v.priority) ||
      (v.action === 'sprint' && v.sprintId !== undefined),
    { message: 'action 与对应参数不匹配' },
  );
export type BulkIssueInput = z.infer<typeof BulkIssueSchema>;

export const TransitionIssueSchema = z.object({
  toState: z.string().min(1).max(64),
  comment: z.string().max(MAX_COMMENT_LENGTH).optional(),
});
export type TransitionIssueInput = z.infer<typeof TransitionIssueSchema>;

export const AssignIssueSchema = z.object({
  /** 传 null 表示取消指派 */
  assigneeName: z.string().max(64).nullable(),
});
export type AssignIssueInput = z.infer<typeof AssignIssueSchema>;

export const LinkIssueSchema = z.object({
  toIssueKey: z.string().regex(ISSUE_KEY_REGEX),
  type: IssueLinkTypeSchema.default('RELATES'),
});

export const SearchIssuesQuerySchema = z.object({
  q: z.string().max(255).optional(),
  type: z.string().optional(), // 逗号分隔多个类型
  state: z.string().max(64).optional(),
  stateCategory: z.enum(['TODO', 'IN_PROGRESS', 'DONE']).optional(),
  assignee: z.string().max(64).optional(), // actor name 或 "none"
  reporter: z.string().max(64).optional(),
  priority: z.string().max(20).optional(), // 逗号分隔多个，如 "P0,P1"
  label: z.string().max(64).optional(),
  parent: z.string().regex(ISSUE_KEY_REGEX).optional(),
  sprintId: z.string().optional(),
  releaseId: z.string().optional(), // 或 "none"=未设版本
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  sort: z
    .enum(['created_desc', 'created_asc', 'updated_desc', 'updated_asc', 'priority_asc'])
    .default('created_desc'),
});
export type SearchIssuesQuery = z.infer<typeof SearchIssuesQuerySchema>;

export const ClaimIssueSchema = z
  .object({
    issueKey: z.string().regex(ISSUE_KEY_REGEX).optional(),
    type: IssueTypeSchema.optional(),
    label: z.string().max(64).optional(),
    q: z.string().max(255).optional(),
  })
  .refine((v) => !!v.issueKey || !!v.type || !!v.label || !!v.q, {
    message: 'issueKey 与 type/label/q 至少提供其一',
  });
export type ClaimIssueInput = z.infer<typeof ClaimIssueSchema>;

/* --------------------------------------------------------------- comment */

export const CreateCommentSchema = z.object({
  body: z.string().min(1).max(MAX_COMMENT_LENGTH),
  evidence: z.record(z.unknown()).optional(),
});
export type CreateCommentInput = z.infer<typeof CreateCommentSchema>;

/* --------------------------------------------------------------- progress */

export const ProgressReportSchema = z.object({
  percent: z.number().int().min(0).max(100),
  notes: z.string().max(MAX_DESCRIPTION_LENGTH).optional(),
  blockers: z
    .array(
      z.object({
        description: z.string().min(1).max(2000),
        issueKey: z.string().regex(ISSUE_KEY_REGEX).optional(),
      }),
    )
    .max(20)
    .default([]),
  artifacts: z
    .array(z.object({ name: z.string().max(255), url: z.string().url().max(1024) }))
    .max(20)
    .default([]),
});
export type ProgressReportInput = z.infer<typeof ProgressReportSchema>;

/* -------------------------------------------------------------- bug report */

export const BugReportSchema = z.object({
  title: z.string().min(3).max(MAX_TITLE_LENGTH),
  description: z.string().max(MAX_DESCRIPTION_LENGTH).optional(),
  severity: PrioritySchema.default('P2'),
  stepsToReproduce: z.string().max(MAX_DESCRIPTION_LENGTH).optional(),
  /** 结构化证据：日志片段、截图 URL、断言输出等 */
  evidence: z.record(z.unknown()).optional(),
  fingerprint: z.string().min(3).max(191).optional(),
  environment: z.string().max(255).optional(),
  parentIssueKey: z.string().regex(ISSUE_KEY_REGEX).optional(),
  labelNames: z.array(z.string().min(1).max(64)).max(20).default([]),
});
export type BugReportInput = z.infer<typeof BugReportSchema>;

/* -------------------------------------------------------------- regression */

export const RegressionCaseSchema = z.object({
  name: z.string().min(1).max(512),
  className: z.string().max(512).optional(),
  status: CaseStatusSchema,
  message: z.string().max(MAX_DESCRIPTION_LENGTH).optional(),
  fingerprint: z.string().min(3).max(191).optional(),
  durationMs: z.number().int().min(0).max(86_400_000).optional(),
});

export const RegressionSubmitSchema = z.object({
  suite: z.string().min(1).max(128),
  branch: z.string().max(128).optional(),
  commitSha: z.string().max(64).optional(),
  durationMs: z.number().int().min(0).optional(),
  results: z.array(RegressionCaseSchema).min(1).max(MAX_REGRESSION_CASES),
});
export type RegressionSubmitInput = z.infer<typeof RegressionSubmitSchema>;

/* --------------------------------------------------------------- approval */

export const ApprovalDecisionSchema = z.object({
  decision: z.enum(['APPROVED', 'REJECTED']),
  reason: z.string().max(2000).optional(),
});
export type ApprovalDecisionInput = z.infer<typeof ApprovalDecisionSchema>;

export const ActivityQuerySchema = z.object({
  actor: z.string().max(64).optional(),
  source: ActivitySourceSchema.optional(),
  issueKey: z.string().regex(ISSUE_KEY_REGEX).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  before: z.coerce.date().optional(),
});
export type ActivityQuery = z.infer<typeof ActivityQuerySchema>;

export const ApprovalStatusEnum = ApprovalStatusSchema;

/* ----------------------------------------------------------------- reports (M5) */

export const ReportKinds = ['DAILY_DIGEST', 'RISK_ALERT'] as const;
export type ReportKind = (typeof ReportKinds)[number];

export const CreateReportSchema = z.object({
  kind: z.enum(ReportKinds),
  title: z.string().min(1).max(255),
  content: z.string().min(1).max(65_535),
  data: z.record(z.unknown()).optional(),
});
export type CreateReportInput = z.infer<typeof CreateReportSchema>;
