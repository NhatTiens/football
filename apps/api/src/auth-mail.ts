import nodemailer from 'nodemailer';

import { env } from './env.js';

export type AuthMailPurpose = 'EMAIL_VERIFICATION' | 'PASSWORD_RESET';

export interface AuthMailPreview {
  delivered: boolean;
  debugCode: string | null;
  provider: 'debug' | 'smtp';
}

export interface AuthMailContent {
  subject: string;
  text: string;
  html: string;
}

let smtpTransport: ReturnType<typeof nodemailer.createTransport> | null = null;

function normalized(value: string | undefined): string {
  return value?.trim() ?? '';
}

function isUsableSecret(value: string | undefined): boolean {
  const secret = normalized(value);
  if (!secret) {
    return false;
  }

  const upper = secret.toUpperCase();
  return ![
    'ROTATION_REQUIRED',
    'CHANGE_ME',
    'CHANGEME',
    'REPLACE_ME',
    'PLACEHOLDER',
  ].includes(upper);
}

function isConfigured(): boolean {
  return Boolean(
    normalized(env.MAIL_SMTP_HOST) &&
      env.MAIL_SMTP_PORT &&
      normalized(env.MAIL_SMTP_USERNAME) &&
      isUsableSecret(env.MAIL_SMTP_PASSWORD) &&
      normalized(env.MAIL_FROM_EMAIL) &&
      normalized(env.MAIL_FROM_NAME),
  );
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function expiryMinutes(purpose: AuthMailPurpose): number {
  return purpose === 'PASSWORD_RESET'
    ? env.AUTH_PASSWORD_RESET_CODE_EXPIRE_MINUTES
    : env.AUTH_EMAIL_CODE_EXPIRE_MINUTES;
}

export function buildAuthMailContent(input: {
  name: string;
  purpose: AuthMailPurpose;
  code: string;
}): AuthMailContent {
  const minutes = expiryMinutes(input.purpose);
  const safeName = escapeHtml(input.name);
  const safeCode = escapeHtml(input.code);

  if (input.purpose === 'PASSWORD_RESET') {
    return {
      subject: 'Mã đặt lại mật khẩu Football AI',
      text: [
        `Xin chào ${input.name},`,
        '',
        `Mã đặt lại mật khẩu Football AI của bạn là: ${input.code}`,
        `Mã có hiệu lực trong ${minutes} phút.`,
        '',
        'Nếu bạn không yêu cầu đặt lại mật khẩu, hãy bỏ qua email này.',
        'Không chia sẻ mã này với bất kỳ ai.',
      ].join('\n'),
      html: `
        <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#111827">
          <h2 style="margin-bottom:8px">Football AI</h2>
          <p>Xin chào ${safeName},</p>
          <p>Mã đặt lại mật khẩu của bạn là:</p>
          <div style="font-size:32px;font-weight:700;letter-spacing:8px;padding:16px 0">${safeCode}</div>
          <p>Mã có hiệu lực trong <strong>${minutes} phút</strong>.</p>
          <p>Nếu bạn không yêu cầu đặt lại mật khẩu, hãy bỏ qua email này.</p>
          <p style="color:#6b7280;font-size:13px">Không chia sẻ mã này với bất kỳ ai.</p>
        </div>
      `.trim(),
    };
  }

  return {
    subject: 'Mã xác minh tài khoản Football AI',
    text: [
      `Xin chào ${input.name},`,
      '',
      `Mã xác minh tài khoản Football AI của bạn là: ${input.code}`,
      `Mã có hiệu lực trong ${minutes} phút.`,
      '',
      'Không chia sẻ mã này với bất kỳ ai.',
    ].join('\n'),
    html: `
      <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#111827">
        <h2 style="margin-bottom:8px">Football AI</h2>
        <p>Xin chào ${safeName},</p>
        <p>Mã xác minh tài khoản của bạn là:</p>
        <div style="font-size:32px;font-weight:700;letter-spacing:8px;padding:16px 0">${safeCode}</div>
        <p>Mã có hiệu lực trong <strong>${minutes} phút</strong>.</p>
        <p style="color:#6b7280;font-size:13px">Không chia sẻ mã này với bất kỳ ai.</p>
      </div>
    `.trim(),
  };
}

function smtpSecurity(): { secure: boolean; requireTLS: boolean } {
  const mode = normalized(env.MAIL_SMTP_SECURE).toLowerCase();

  if (mode === 'ssl' || mode === 'smtps' || mode === 'true' || mode === '1') {
    return { secure: true, requireTLS: false };
  }

  if (mode === 'none' || mode === 'false' || mode === '0' || mode === 'off') {
    return { secure: false, requireTLS: false };
  }

  // Legacy footballAI uses Gmail :587 with STARTTLS.
  return { secure: false, requireTLS: true };
}

function getTransport() {
  if (smtpTransport) {
    return smtpTransport;
  }

  if (!isConfigured()) {
    throw new Error('SMTP mail configuration is incomplete.');
  }

  const security = smtpSecurity();
  const host = normalized(env.MAIL_SMTP_HOST);

  smtpTransport = nodemailer.createTransport({
    host,
    port: env.MAIL_SMTP_PORT,
    secure: security.secure,
    requireTLS: security.requireTLS,
    auth: {
      user: normalized(env.MAIL_SMTP_USERNAME),
      pass: env.MAIL_SMTP_PASSWORD,
    },
    tls: {
      minVersion: 'TLSv1.2',
      servername: host,
    },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });

  return smtpTransport;
}

export async function sendAuthMail(input: {
  to: string;
  name: string;
  purpose: AuthMailPurpose;
  code: string;
}): Promise<AuthMailPreview> {
  // Unit/integration tests must never make real network calls.
  if (process.env.NODE_ENV === 'test') {
    return {
      delivered: false,
      debugCode: input.code,
      provider: 'debug',
    };
  }

  if (!isConfigured()) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('Mail configuration is required in production.');
    }

    return {
      delivered: false,
      debugCode: input.code,
      provider: 'debug',
    };
  }

  const content = buildAuthMailContent(input);
  const transport = getTransport();

  await transport.sendMail({
    from: {
      name: normalized(env.MAIL_FROM_NAME),
      address: normalized(env.MAIL_FROM_EMAIL),
    },
    to: input.to,
    subject: content.subject,
    text: content.text,
    html: content.html,
  });

  return {
    delivered: true,
    debugCode: process.env.NODE_ENV === 'production' ? null : input.code,
    provider: 'smtp',
  };
}
