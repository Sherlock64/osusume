import { z } from 'zod';

// Matches infra/compose.dev.yaml. Mailpit may hold other people's messages, so tests only
// ever look at recipients they generated themselves and never clear the mailbox.
const apiUrl = process.env.TEST_MAILPIT_URL ?? 'http://localhost:8025';

export const testSmtpEnv = {
  SMTP_HOST: process.env.TEST_SMTP_HOST ?? 'localhost',
  SMTP_PORT: Number(process.env.TEST_SMTP_PORT ?? 1025),
  SMTP_SECURE: false,
  SMTP_USER: undefined,
  SMTP_PASSWORD: undefined,
  SMTP_FROM: 'Osusume <no-reply@example.test>',
};

const searchSchema = z.object({
  messages: z.array(z.object({ ID: z.string(), To: z.array(z.object({ Address: z.string() })) })),
});
const messageSchema = z.object({ Subject: z.string(), Text: z.string() });

export interface ReceivedMail {
  subject: string;
  text: string;
}

async function search(address: string) {
  const query = new URLSearchParams({ query: `to:"${address}"` });
  const response = await fetch(`${apiUrl}/api/v1/search?${query.toString()}`);
  if (!response.ok) throw new Error(`Mailpit search failed: ${String(response.status)}`);
  const { messages } = searchSchema.parse(await response.json());
  return messages.filter((message) =>
    message.To.some((to) => to.Address.toLowerCase() === address.toLowerCase()),
  );
}

/** Everything delivered so far to an address, newest first. */
export async function mailsTo(address: string): Promise<ReceivedMail[]> {
  const found = await search(address);
  return Promise.all(
    found.map(async ({ ID }) => {
      const response = await fetch(`${apiUrl}/api/v1/message/${ID}`);
      const message = messageSchema.parse(await response.json());
      return { subject: message.Subject, text: message.Text };
    }),
  );
}

/** Waits until an address has received `count` messages and returns the newest. */
export async function waitForMail(address: string, count = 1): Promise<ReceivedMail> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const mails = await mailsTo(address);
    const [newest] = mails;
    if (newest && mails.length >= count) return newest;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`No mail for ${address} after waiting`);
}

/** The token from the link in a message. */
export function tokenFrom(mail: ReceivedMail): string {
  const match = /[?&]token=([^\s&]+)/.exec(mail.text);
  if (!match?.[1]) throw new Error(`No token in mail: ${mail.subject}`);
  return decodeURIComponent(match[1]);
}
