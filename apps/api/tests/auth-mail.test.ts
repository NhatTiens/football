import { describe, expect, it } from 'vitest';

process.env.NODE_ENV = 'test';
process.env.ADMIN_API_TOKEN ??= 'test-admin-token';
process.env.MAIL_SMTP_HOST ??= 'smtp.gmail.com';
process.env.MAIL_SMTP_PORT ??= '587';
process.env.MAIL_SMTP_SECURE ??= 'tls';
process.env.MAIL_SMTP_USERNAME ??= 'footballai.vn@gmail.com';
process.env.MAIL_SMTP_PASSWORD ??= 'not-used-in-test';
process.env.MAIL_FROM_EMAIL ??= 'footballai.vn@gmail.com';
process.env.MAIL_FROM_NAME ??= 'footballAI';

const { buildAuthMailContent, sendAuthMail } = await import('../src/auth-mail.ts');

describe('real auth mail layer', () => {
  it('does not contact SMTP in test mode', async () => {
    const result = await sendAuthMail({
      to: 'recipient@example.com',
      name: 'Test User',
      purpose: 'EMAIL_VERIFICATION',
      code: '123456',
    });

    expect(result).toEqual({
      delivered: false,
      debugCode: '123456',
      provider: 'debug',
    });
  });

  it('builds a verification email containing the six-digit code', () => {
    const content = buildAuthMailContent({
      name: 'Test User',
      purpose: 'EMAIL_VERIFICATION',
      code: '654321',
    });

    expect(content.subject).toContain('xác minh');
    expect(content.text).toContain('654321');
    expect(content.text).toContain('15 phút');
    expect(content.html).toContain('654321');
  });

  it('builds reset email and escapes the display name in HTML', () => {
    const content = buildAuthMailContent({
      name: '<script>alert(1)</script>',
      purpose: 'PASSWORD_RESET',
      code: '111222',
    });

    expect(content.subject).toContain('đặt lại mật khẩu');
    expect(content.text).toContain('111222');
    expect(content.html).not.toContain('<script>');
    expect(content.html).toContain('&lt;script&gt;');
  });
});
