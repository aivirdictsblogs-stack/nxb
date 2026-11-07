import type { Env } from '../env';
export type Mail = { to: string; subject: string; text: string };
/** Email adapter. Connect a real provider (Resend, MailChannels, SES...) by implementing the branch below. */
export async function sendEmail(env: Env, mail: Mail) {
  if (env.ENVIRONMENT === 'test') { ((globalThis as any).__mailbox ||= []).push(mail); return; }
  if (!env['EMAIL_PROVIDER']) { console.log(`[email:not-configured] to=${mail.to} subject=${mail.subject}`); return; }
  throw new Error('EMAIL_PROVIDER set but no adapter implemented - see docs/EMAIL.md');
}
