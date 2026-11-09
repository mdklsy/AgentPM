/** 项目 key：2-10 位大写字母/数字/下划线，字母开头（如 APM） */
export const PROJECT_KEY_REGEX = /^[A-Z][A-Z0-9_]{1,9}$/;

/** issue key：项目 key + 序号（如 APM-42） */
export const ISSUE_KEY_REGEX = /^[A-Z][A-Z0-9_]{1,9}-\d+$/;

/** actor 登录名：字母开头，小写字母/数字/中划线（agent 常用 slug 形态） */
export const ACTOR_NAME_REGEX = /^[a-z][a-z0-9-]{1,63}$/;

/** API token 前缀标识 */
export const TOKEN_PREFIX = 'apm_';

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

/** 每次回归提交最多允许的用例数（防误传超大 payload） */
export const MAX_REGRESSION_CASES = 2000;

/** issue 标题/评论正文长度上限 */
export const MAX_TITLE_LENGTH = 255;
export const MAX_COMMENT_LENGTH = 20_000;
export const MAX_DESCRIPTION_LENGTH = 65_535;
