import { loadConfig } from './config.js';
import { buildApp } from './app.js';
import { setMailSender } from '@agentpm/core';

const cfg = loadConfig();

// 邮件外发装配（M6）：SMTP_HOST 未配置时保持 sender=null（notify 内部静默跳过）
if (cfg.SMTP_HOST) {
  const nodemailer = await import('nodemailer');
  const transport = nodemailer.createTransport({
    host: cfg.SMTP_HOST,
    port: cfg.SMTP_PORT,
    secure: cfg.SMTP_PORT === 465,
    ...(cfg.SMTP_USER ? { auth: { user: cfg.SMTP_USER, pass: cfg.SMTP_PASS ?? '' } } : {}),
  });
  setMailSender(async (msg) => {
    await transport.sendMail({
      from: cfg.SMTP_FROM ?? cfg.SMTP_USER ?? 'agentpm@localhost',
      to: msg.to,
      subject: msg.subject,
      text: msg.text,
    });
  });
}

const app = await buildApp();

await app.listen({ port: cfg.PORT, host: cfg.HOST });

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, async () => {
    await app.close();
    process.exit(0);
  });
}
