import { type Server, type Socket, createServer } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { createSmtpMailer } from './mailer.ts';

const message = { to: 'to@example.test', subject: 'Hello', text: 'Hi' };

let server: Server | undefined;

afterEach(() => {
  server?.close();
});

/** An SMTP server that offers AUTH and never STARTTLS, recording every command it gets. */
async function plaintextServer(): Promise<{ port: number; commands: string[] }> {
  const commands: string[] = [];
  const sockets: Socket[] = [];
  const started = createServer((socket) => {
    sockets.push(socket);
    socket.write('220 test ESMTP\r\n');
    let inData = false;
    socket.on('data', (chunk) => {
      for (const line of chunk.toString().split('\r\n').filter(Boolean)) {
        commands.push(line);
        if (inData) {
          if (line === '.') {
            inData = false;
            socket.write('250 sent\r\n');
          }
        } else if (/^EHLO/i.test(line)) {
          socket.write('250-test\r\n250 AUTH PLAIN LOGIN\r\n');
        } else if (/^DATA/i.test(line)) {
          inData = true;
          socket.write('354 go\r\n');
        } else if (/^AUTH/i.test(line)) {
          socket.write('235 ok\r\n');
        } else {
          socket.write('250 ok\r\n');
        }
      }
    });
    socket.on('error', () => undefined);
  });
  server = started;
  await new Promise<void>((resolve) => {
    started.listen(0, '127.0.0.1', resolve);
  });
  started.on('close', () => {
    for (const socket of sockets) socket.destroy();
  });
  const address = started.address();
  if (address === null || typeof address === 'string') throw new Error('no port');
  return { port: address.port, commands };
}

function mailerFor(port: number, credentials: { SMTP_USER?: string; SMTP_PASSWORD?: string }) {
  return createSmtpMailer({
    SMTP_HOST: '127.0.0.1',
    SMTP_PORT: port,
    SMTP_SECURE: false,
    SMTP_FROM: 'Osusume <no-reply@example.test>',
    ...credentials,
  });
}

describe('createSmtpMailer', () => {
  it('refuses to send credentials to a server that does not offer STARTTLS', async () => {
    const { port, commands } = await plaintextServer();
    const mailer = mailerFor(port, { SMTP_USER: 'someone', SMTP_PASSWORD: 'hunter2hunter2' });

    await expect(mailer.send(message)).rejects.toThrow();

    expect(commands.some((command) => /^AUTH/i.test(command))).toBe(false);
    expect(commands.some((command) => /^MAIL FROM/i.test(command))).toBe(false);
  });

  it('sends without TLS when there are no credentials, as Mailpit needs', async () => {
    const { port, commands } = await plaintextServer();

    await mailerFor(port, {}).send(message);

    expect(commands.some((command) => /^MAIL FROM/i.test(command))).toBe(true);
  });
});
