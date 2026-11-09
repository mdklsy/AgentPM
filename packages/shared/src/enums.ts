import { z } from 'zod';

/** 三类身份主体：人类 / AI Agent / PM 替身（见 ADR 0002） */
export const ActorTypes = ['HUMAN', 'AGENT', 'AVATAR'] as const;
export type ActorType = (typeof ActorTypes)[number];
export const ActorTypeSchema = z.enum(ActorTypes);

/** 项目成员角色。AGENT 角色是 agent 操作项目的前提。 */
export const MemberRoles = ['OWNER', 'ADMIN', 'MEMBER', 'AGENT', 'VIEWER'] as const;
export type MemberRole = (typeof MemberRoles)[number];
export const MemberRoleSchema = z.enum(MemberRoles);

export const IssueTypes = ['EPIC', 'STORY', 'TASK', 'BUG', 'SUBTASK'] as const;
export type IssueType = (typeof IssueTypes)[number];
export const IssueTypeSchema = z.enum(IssueTypes);

/** P0 最高（紧急）→ P4 最低 */
export const Priorities = ['P0', 'P1', 'P2', 'P3', 'P4'] as const;
export type Priority = (typeof Priorities)[number];
export const PrioritySchema = z.enum(Priorities);

/** 状态类别：看板三列的锚点，DONE 类别触发 closedAt */
export const StateCategories = ['TODO', 'IN_PROGRESS', 'DONE'] as const;
export type StateCategory = (typeof StateCategories)[number];
export const StateCategorySchema = z.enum(StateCategories);

export const Visibilities = ['PRIVATE', 'INTERNAL', 'PUBLIC'] as const;
export type Visibility = (typeof Visibilities)[number];
export const VisibilitySchema = z.enum(Visibilities);

export const SprintStatuses = ['PLANNED', 'ACTIVE', 'COMPLETED'] as const;
export type SprintStatus = (typeof SprintStatuses)[number];
export const SprintStatusSchema = z.enum(SprintStatuses);

export const RegressionStatuses = ['PASSED', 'FAILED'] as const;
export type RegressionStatus = (typeof RegressionStatuses)[number];
export const RegressionStatusSchema = z.enum(RegressionStatuses);

export const CaseStatuses = ['PASS', 'FAIL', 'ERROR', 'SKIP'] as const;
export type CaseStatus = (typeof CaseStatuses)[number];
export const CaseStatusSchema = z.enum(CaseStatuses);

export const ApprovalStatuses = ['PENDING', 'APPROVED', 'REJECTED', 'EXPIRED'] as const;
export type ApprovalStatus = (typeof ApprovalStatuses)[number];
export const ApprovalStatusSchema = z.enum(ApprovalStatuses);

/** 一切写操作的来源，进审计。 */
export const ActivitySources = ['WEB', 'API', 'MCP', 'SYSTEM'] as const;
export type ActivitySource = (typeof ActivitySources)[number];
export const ActivitySourceSchema = z.enum(ActivitySources);

export const IssueLinkTypes = ['BLOCKS', 'RELATES', 'DUPLICATES', 'CAUSES'] as const;
export type IssueLinkType = (typeof IssueLinkTypes)[number];
export const IssueLinkTypeSchema = z.enum(IssueLinkTypes);

/** API token 权限范围 */
export const Scopes = ['read', 'write', 'mcp', 'admin'] as const;
export type Scope = (typeof Scopes)[number];
export const ScopeSchema = z.enum(Scopes);
