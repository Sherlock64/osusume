import { createTransport } from 'nodemailer';
import type { Env } from '../config/env.ts';
import { ApiError } from './errors.ts';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

export interface Mailer {
  send: (message: MailMessage) => Promise<void>;
}

type SmtpEnv = Pick<
  Env,
  'SMTP_HOST' | 'SMTP_PORT' | 'SMTP_SECURE' | 'SMTP_USER' | 'SMTP_PASSWORD' | 'SMTP_FROM'
>;

/**
 * SMTP from env configuration, so any provider works. With SMTP_SECURE=false, nodemailer upgrades
 * through STARTTLS only if the server offers it. A server that does not, or anyone in between
 * removing the offer, would get the password in the clear, so with credentials it is required.
 */
export function createSmtpMailer(env: SmtpEnv): Mailer {
  const hasCredentials = env.SMTP_USER !== undefined && env.SMTP_PASSWORD !== undefined;
  const transport = createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    requireTLS: hasCredentials && !env.SMTP_SECURE,
    // Links are sent inside a transaction that holds locks, so a hung server must fail fast.
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
    ...(env.SMTP_USER !== undefined && env.SMTP_PASSWORD !== undefined
      ? { auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } }
      : {}),
  });
  return {
    send: async (message) => {
      await transport.sendMail({ from: env.SMTP_FROM, ...message });
    },
  };
}

/**
 * Sends a link the caller's transaction depends on. A link that cannot be sent is lost,
 * so the failure rolls the transaction back and the person can simply try again.
 */
export async function sendOrFail(mailer: Mailer, message: MailMessage): Promise<void> {
  try {
    await mailer.send(message);
  } catch (error) {
    console.error('Sending email failed:', error);
    throw new ApiError(503, 'email_failed', 'The email could not be sent. Try again later.');
  }
}
