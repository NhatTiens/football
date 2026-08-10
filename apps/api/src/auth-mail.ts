import { env } from './env.js';

export type AuthMailPurpose = 'EMAIL_VERIFICATION' | 'PASSWORD_RESET';

export interface AuthMailPreview {
  delivered: boolean;
  debugCode: string | null;
  provider: 'debug' | 'smtp-placeholder';
}

function isConfigured(): boolean {
  return Boolean(
    env.MAIL_SMTP_HOST &&
      env.MAIL_SMTP_PORT &&
      env.MAIL_SMTP_USERNAME &&
      env.MAIL_SMTP_PASSWORD &&
      env.MAIL_FROM_EMAIL &&
      env.MAIL_FROM_NAME,
  );
}

export async function sendAuthMail(input: {
  to: string;
  name: string;
  purpose: AuthMailPurpose;
  code: string;
}): Promise<AuthMailPreview> {
  if (process.env.NODE_ENV === 'production' && !isConfigured()) {
    throw new Error('Mail configuration is required in production.');
  }

  const debugCode = process.env.NODE_ENV === 'production' ? null : input.code;
  return {
    delivered: isConfigured(),
    debugCode,
    provider: isConfigured() ? 'smtp-placeholder' : 'debug',
  };
}
