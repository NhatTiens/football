import { z } from 'zod';

const schema = z.object({
  API_PORT: z.coerce.number().int().positive().default(4000),
  API_HOST: z.string().default('0.0.0.0'),
  CORS_ORIGIN: z.string().default('http://localhost:3000'),
  ADMIN_API_TOKEN: z.string().min(8),
  AUTH_SESSION_COOKIE_NAME: z.string().default('fa_session'),
  AUTH_SESSION_TTL_DAYS: z.coerce.number().int().positive().default(30),
  AUTH_MAX_FAILED_LOGIN_ATTEMPTS: z.coerce.number().int().positive().default(5),
  AUTH_LOCK_MINUTES: z.coerce.number().int().positive().default(15),
  AUTH_EMAIL_CODE_EXPIRE_MINUTES: z.coerce.number().int().positive().default(15),
  AUTH_PASSWORD_RESET_CODE_EXPIRE_MINUTES: z.coerce.number().int().positive().default(15),
  AUTH_FREE_CHAT_DAILY_LIMIT: z.coerce.number().int().positive().default(20),
  AUTH_PRO_CHAT_DAILY_LIMIT: z.coerce.number().int().positive().default(250),
  AUTH_DISABLE_PENDING_LOGIN: z.coerce.boolean().default(true),
  PRO_PLAN_DAYS: z.coerce.number().int().positive().default(30),
  MAIL_SMTP_HOST: z.string().optional(),
  MAIL_SMTP_PORT: z.coerce.number().int().positive().optional(),
  MAIL_SMTP_SECURE: z.string().optional(),
  MAIL_SMTP_USERNAME: z.string().optional(),
  MAIL_SMTP_PASSWORD: z.string().optional(),
  MAIL_FROM_EMAIL: z.string().optional(),
  MAIL_FROM_NAME: z.string().optional(),
});

export const env = schema.parse(process.env);
