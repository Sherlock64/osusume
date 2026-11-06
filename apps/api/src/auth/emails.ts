import type { MailMessage } from '../lib/mailer.ts';

/** Links open a web page, which then calls the api: a mail scanner following a link changes nothing. */
function link(publicBaseUrl: string, path: string, token: string): string {
  return `${publicBaseUrl}${path}?token=${encodeURIComponent(token)}`;
}

export function passwordResetMail(publicBaseUrl: string, to: string, token: string): MailMessage {
  return {
    to,
    subject: 'Reset your Osusume password',
    text: `Use this link to set a new password:\n\n${link(publicBaseUrl, '/reset-password', token)}\n\nIf you did not ask for this, ignore this email.\n`,
  };
}

export function firstRunSetupMail(publicBaseUrl: string, to: string, token: string): MailMessage {
  return {
    to,
    subject: 'Confirm your Osusume admin account',
    text: `Use this link to create the Osusume admin account:\n\n${link(publicBaseUrl, '/verify-email/setup', token)}\n\nThe account is created only when this link is used.\n`,
  };
}

export function emailChangeMail(publicBaseUrl: string, to: string, token: string): MailMessage {
  return {
    to,
    subject: 'Confirm your new Osusume email address',
    text: `Use this link to change your Osusume email address to this one:\n\n${link(publicBaseUrl, '/verify-email/change', token)}\n\nIf you did not ask for this, ignore this email.\n`,
  };
}

export function inviteMail(
  publicBaseUrl: string,
  to: string,
  token: string,
  expiresAt: Date,
): MailMessage {
  return {
    to,
    subject: 'You are invited to Osusume',
    text: `You have been invited to Osusume. Use this link to create your account:\n\n${link(publicBaseUrl, '/invites/accept', token)}\n\nThe link works once and expires on ${expiresAt.toUTCString()}.\n`,
  };
}
