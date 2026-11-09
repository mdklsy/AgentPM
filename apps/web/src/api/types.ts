/** 后端响应的视图类型（与 REST 序列化一一对应） */

export type IssueType = 'EPIC' | 'STORY' | 'TASK' | 'BUG' | 'SUBTASK';
export type Priority = 'P0' | 'P1' | 'P2' | 'P3' | 'P4';
export type StateCategory = 'TODO' | 'IN_PROGRESS' | 'DONE';
export type MemberRole = 'OWNER' | 'ADMIN' | 'MEMBER' | 'AGENT' | 'VIEWER';
export type ActorType = 'HUMAN' | 'AGENT' | 'AVATAR';
export type ActivitySource = 'WEB' | 'API' | 'MCP' | 'SYSTEM';

export interface ProjectSummary {
  key: string;
  name: string;
  description: string | null;
  visibility: 'PRIVATE' | 'INTERNAL' | 'PUBLIC';
  myRole: MemberRole | null;
  openIssues: number;
  archived: boolean;
}

export interface ProjectDetail {
  project: {
    key: string;
    name: string;
    description: string | null;
    visibility: string;
    settings: {
      agentPolicy: {
        maxConcurrentClaims: number;
        bugCreate: 'auto' | 'approval';
        completeTransition: 'auto' | 'approval';
        autoFileRegressionBugs: boolean;
      };
    };
    archived: boolean;
    createdAt: string;
  };
  myRole: MemberRole | null;
  members: Array<{
    name: string;
    displayName: string;
    type: ActorType;
    role: MemberRole;
    isActive: boolean;
    avatarUrl: string | null;
    lastHeartbeatAt: string | null;
  }>;
  workflows: Array<{
    issueType: IssueType;
    name: string;
    states: Array<{ name: string; category: StateCategory; isInitial: boolean }>;
    transitions: Array<{ from: string | null; to: string }>;
  }>;
}

export interface IssueListItem {
  issueKey: string;
  type: IssueType;
  title: string;
  state: string;
  stateCategory: StateCategory;
  priority: Priority;
  assignee: string | null;
  reporter: string;
  labels: string[];
  parent: string | null;
  sprint: { id: string; name: string } | null;
  storyPoints: number | null;
  dueDate: string | null;
  fingerprint: string | null;
  environment: string | null;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface IssueDetail extends IssueListItem {
  description: string | null;
  comments: Array<{
    author: string;
    authorType: ActorType;
    body: string;
    evidence: Record<string, unknown> | null;
    createdAt: string;
  }>;
  progressReports: Array<{
    actor: string;
    percent: number;
    notes: string | null;
    blockers: Array<{ description: string; issueKey?: string }>;
    artifacts: Array<{ name: string; url: string }>;
    createdAt: string;
  }>;
  links: Array<{ type: string; from: string; to: string }>;
}

export interface ActivityItem {
  id?: string;
  action: string;
  summary: string;
  source: ActivitySource;
  actor: { name: string; type: ActorType } | null;
  issue: string | null;
  createdAt: string;
}

export interface ProjectStats {
  project: string;
  name: string;
  totals: {
    total: number;
    done: number;
    todo: number;
    inProgress: number;
    completionRate: number;
  };
  byType: Record<string, number>;
  byPriority: Record<string, number>;
  workload: {
    unassigned: number;
    members: Array<{ name: string; type: ActorType; open: number; inProgress: number }>;
  };
  agents: Array<{
    name: string;
    displayName: string;
    status: string;
    lastHeartbeatAt: string | null;
    activeIssues: number;
  }>;
  sprint: {
    id: string;
    name: string;
    endsAt: string | null;
    totals: Record<string, number>;
  } | null;
  activity7d: { total: number; bySource: Record<ActivitySource, number> };
}

export interface ApprovalItem {
  id: string;
  actionType: string;
  payload: Record<string, unknown>;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED';
  requestedBy: string;
  requestedByType: ActorType;
  decidedBy: string | null;
  decidedAt: string | null;
  reason: string | null;
  createdAt: string;
}

export interface AgentItem {
  id: string;
  name: string;
  displayName: string;
  type: ActorType;
  agentProfile: {
    description: string;
    model: string | null;
    capabilities: string[];
    status: string;
    lastHeartbeatAt: string | null;
    owner: { name: string; displayName: string };
  };
}

export interface RegressionRunItem {
  id: string;
  suite: string;
  branch: string | null;
  commitSha: string | null;
  status: 'PASSED' | 'FAILED';
  total: number;
  passed: number;
  failed: number;
  errors: number;
  skipped: number;
  finishedAt: string;
  triggeredBy: { name: string; type: ActorType };
}

export interface BurndownPoint {
  date: string;
  remaining: number;
  ideal: number;
}
