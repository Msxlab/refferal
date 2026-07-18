import { Logger } from '@nestjs/common';
import { ResendEmailAdapter, SmtpEmailAdapter } from './adapters';

const SECRET_MESSAGE = {
  to: 'private-user@test.refearn.local',
  subject: 'Reset your password',
  text: 'Use raw-password-reset-token to continue.',
};

const originalEnv = {
  SMTP_HOST: process.env.SMTP_HOST,
  RESEND_API_KEY: process.env.RESEND_API_KEY,
  MAIL_API_URL: process.env.MAIL_API_URL,
};
const originalFetch = globalThis.fetch;

function restoreEnv(name: keyof typeof originalEnv): void {
  const value = originalEnv[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

describe('email adapter secret-safe diagnostics', () => {
  beforeEach(() => {
    delete process.env.SMTP_HOST;
    delete process.env.RESEND_API_KEY;
    delete process.env.MAIL_API_URL;
  });

  afterEach(() => {
    restoreEnv('SMTP_HOST');
    restoreEnv('RESEND_API_KEY');
    restoreEnv('MAIL_API_URL');
    globalThis.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('SMTP dev fallback logs no recipient, subject, body or token', async () => {
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);

    await new SmtpEmailAdapter().send(SECRET_MESSAGE);

    const diagnostics = JSON.stringify(log.mock.calls);
    expect(diagnostics).not.toContain(SECRET_MESSAGE.to);
    expect(diagnostics).not.toContain(SECRET_MESSAGE.subject);
    expect(diagnostics).not.toContain('raw-password-reset-token');
  });

  it('Resend missing-key fallback logs no recipient, subject, body or token', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    await new ResendEmailAdapter().send(SECRET_MESSAGE);

    const diagnostics = JSON.stringify(warn.mock.calls);
    expect(diagnostics).not.toContain(SECRET_MESSAGE.to);
    expect(diagnostics).not.toContain(SECRET_MESSAGE.subject);
    expect(diagnostics).not.toContain('raw-password-reset-token');
  });

  it('provider failures expose only status and never echo response secrets', async () => {
    process.env.RESEND_API_KEY = 'test-provider-key';
    globalThis.fetch = jest.fn(async () =>
      new Response(`provider echoed ${SECRET_MESSAGE.to} raw-password-reset-token`, { status: 422 }),
    ) as typeof fetch;

    await expect(new ResendEmailAdapter().send(SECRET_MESSAGE)).rejects.toThrow('mail provider 422');
    await expect(new ResendEmailAdapter().send(SECRET_MESSAGE)).rejects.not.toThrow(SECRET_MESSAGE.to);
    await expect(new ResendEmailAdapter().send(SECRET_MESSAGE)).rejects.not.toThrow('raw-password-reset-token');
  });
});
