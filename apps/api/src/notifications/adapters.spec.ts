import { redactSensitiveEmailText, ResendEmailAdapter, SmtpEmailAdapter } from './adapters';

describe('email adapters', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('redacts token-bearing email text before development logging', () => {
    const text = [
      'Use this link:',
      'https://example.test/reset-password?token=secret-token-123',
      'token=another-secret',
    ].join('\n');

    const redacted = redactSensitiveEmailText(text);

    expect(redacted).not.toContain('secret-token-123');
    expect(redacted).not.toContain('another-secret');
    expect(redacted).toContain('token=[redacted]');
  });

  it('fails closed in production when SMTP is not configured', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.SMTP_HOST;

    await expect(
      new SmtpEmailAdapter().send({
        to: 'person@example.test',
        subject: 'Password reset',
        text: 'https://example.test/reset-password?token=secret-token',
      }),
    ).rejects.toThrow('email provider is not configured');
  });

  it('fails closed in production when the HTTP mail provider key is missing', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.RESEND_API_KEY;

    await expect(
      new ResendEmailAdapter().send({
        to: 'person@example.test',
        subject: 'Verify email',
        text: 'https://example.test/verify-email?token=secret-token',
      }),
    ).rejects.toThrow('email provider is not configured');
  });
});
