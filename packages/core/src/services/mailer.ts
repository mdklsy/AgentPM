/**
 * 邮件外发（M6）：core 不直接依赖 nodemailer——由宿主（apps/api）注入发送函数。
 * notify() 落库后对本通知的 HUMAN 收件人（有 email）fire-and-forget 发信；失败静默。
 */

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

export type MailSender = (msg: MailMessage) => Promise<void>;

let sender: MailSender | null = null;

export function setMailSender(fn: MailSender | null): void {
  sender = fn;
}

export function mailConfigured(): boolean {
  return sender !== null;
}

/** 邮件标题/文案由调用方拼好传入。 */
export function queueMail(msg: MailMessage): void {
  if (!sender) return;
  void sender(msg).catch(() => {
    /* 邮件失败不影响主流程 */
  });
}

/** 通知邮件文案组装。 */
export function notificationMail(input: {
  to: string;
  title: string;
  body: string;
  url: string;
}): MailMessage {
  return {
    to: input.to,
    subject: `[AgentPM] ${input.title}`,
    text: `${input.body}\n\n查看详情：${input.url}\n\n—— AgentPM（AI 原生项目管理系统）`,
  };
}
