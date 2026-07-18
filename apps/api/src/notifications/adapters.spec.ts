import { Logger } from '@nestjs/common';
import { redactSensitiveEmailText, ResendEmailAdapter, SmtpEmailAdapter } from './adapters';

const SECRET_MESSAGE = {
  to: 'private-user@test.refearn.local',
  subject: 'Reset your password',
  text: 'Use raw-password-reset-token to continue.',
};

describe('email adapters', () => {
  const originalEnv = { ...process.env };
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    process.env = { ...originalEnv };
    globalThis.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('redacts token-bearing email text', () => {
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

  it('logs no recipient, subject, body, or token for the SMTP development fallback', async () => {
    delete process.env.SMTP_HOST;
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);

    await new SmtpEmailAdapter().send(SECRET_MESSAGE);

    const diagnostics = JSON.stringify(log.mock.calls);
    expect(diagnostics).not.toContain(SECRET_MESSAGE.to);
    expect(diagnostics).not.toContain(SECRET_MESSAGE.subject);
    expect(diagnostics).not.toContain('raw-password-reset-token');
  });

  it('logs no recipient, subject, body, or token for the missing-key development fallback', async () => {
    delete process.env.RESEND_API_KEY;
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    await new ResendEmailAdapter().send(SECRET_MESSAGE);

    const diagnostics = JSON.stringify(warn.mock.calls);
    expect(diagnostics).not.toContain(SECRET_MESSAGE.to);
    expect(diagnostics).not.toContain(SECRET_MESSAGE.subject);
    expect(diagnostics).not.toContain('raw-password-reset-token');
  });

  it('fails closed in production when SMTP is not configured', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.SMTP_HOST;

    await expect(new SmtpEmailAdapter().send(SECRET_MESSAGE)).rejects.toThrow('email provider is not configured');
  });

  it('fails closed in production when the HTTP mail provider key is missing', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.RESEND_API_KEY;

    await expect(new ResendEmailAdapter().send(SECRET_MESSAGE)).rejects.toThrow('email provider is not configured');
  });

  it('exposes only the provider status when an HTTP provider response includes secrets', async () => {
    process.env.RESEND_API_KEY = 'test-provider-key';
    globalThis.fetch = jest.fn(async () =>
      new Response(`provider echoed ${SECRET_MESSAGE.to} raw-password-reset-token`, { status: 422 }),
    ) as typeof fetch;

    await expect(new ResendEmailAdapter().send(SECRET_MESSAGE)).rejects.toThrow('mail provider 422');
    await expect(new ResendEmailAdapter().send(SECRET_MESSAGE)).rejects.not.toThrow(SECRET_MESSAGE.to);
    await expect(new ResendEmailAdapter().send(SECRET_MESSAGE)).rejects.not.toThrow('raw-password-reset-token');
  });
});
