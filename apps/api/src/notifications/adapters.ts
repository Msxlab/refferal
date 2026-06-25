import { Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import { Expo, ExpoPushMessage } from 'expo-server-sdk';

export const EMAIL_ADAPTER = Symbol('EMAIL_ADAPTER');
export const PUSH_ADAPTER = Symbol('PUSH_ADAPTER');

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface EmailAdapter {
  send(msg: EmailMessage): Promise<void>;
}

export interface PushMessage {
  tokens: string[];
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

export interface PushResult {
  invalidTokens?: string[];
}

export interface PushAdapter {
  send(msg: PushMessage): Promise<PushResult | void>;
}

/**
 * SMTP yoksa (dev) console'a yazar; outbox yine drenaj olur ve akis test edilebilir.
 * SMTP_HOST tanimliysa gercek nodemailer transport kullanir (SPEC 5).
 */
export class SmtpEmailAdapter implements EmailAdapter {
  private readonly logger = new Logger('EmailAdapter');
  private transport: nodemailer.Transporter | null = null;
  private readonly from: string;

  constructor() {
    this.from = process.env.SMTP_FROM ?? 'Refearn <no-reply@refearn.local>';
    if (process.env.SMTP_HOST) {
      this.transport = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT ?? 587),
        secure: process.env.SMTP_SECURE === 'true',
        auth: process.env.SMTP_USER
          ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
          : undefined,
      });
    }
  }

  async send(msg: EmailMessage): Promise<void> {
    if (!this.transport) {
      this.logger.log(`[DEV e-posta] → ${msg.to} | ${msg.subject}\n${msg.text}`);
      return;
    }
    await this.transport.sendMail({
      from: this.from,
      to: msg.to,
      subject: msg.subject,
      text: msg.text,
      html: msg.html,
    });
  }
}

/**
 * Transactional saglayici (HTTP API) — Resend uyumlu. Inbox teslimati icin SMTP'ye alternatif.
 * Self-hosted ilke korunur: yalniz e-posta gonderimi, kimlik/oturum dis serviste DEGIL (SPEC kilitli karar).
 */
export class ResendEmailAdapter implements EmailAdapter {
  private readonly logger = new Logger('EmailAdapter');
  private readonly from: string;
  private readonly apiKey: string;
  private readonly endpoint: string;

  constructor() {
    this.from = process.env.MAIL_FROM ?? process.env.SMTP_FROM ?? 'Refearn <no-reply@refearn.local>';
    this.apiKey = process.env.RESEND_API_KEY ?? '';
    this.endpoint = process.env.MAIL_API_URL ?? 'https://api.resend.com/emails';
  }

  async send(msg: EmailMessage): Promise<void> {
    if (!this.apiKey) {
      this.logger.warn(`[DEV e-posta/provider key yok] → ${msg.to} | ${msg.subject}`);
      return;
    }
    const res = await fetch(this.endpoint, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: this.from,
        to: [msg.to],
        subject: msg.subject,
        text: msg.text,
        html: msg.html,
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`mail provider ${res.status}: ${detail.slice(0, 200)}`);
    }
  }
}

/**
 * Esnek email adaptor secimi (DECISIONS — luxury tur 1):
 *   MAIL_PROVIDER=resend → ResendEmailAdapter (HTTP)
 *   MAIL_PROVIDER=smtp (veya SMTP_HOST tanimli) → SmtpEmailAdapter
 *   aksi halde → SmtpEmailAdapter (dev console fallback)
 */
export function createEmailAdapter(): EmailAdapter {
  const provider = (process.env.MAIL_PROVIDER ?? '').toLowerCase();
  if (provider === 'resend' || (!provider && process.env.RESEND_API_KEY)) {
    return new ResendEmailAdapter();
  }
  return new SmtpEmailAdapter();
}

/** Expo Push; token yoksa no-op. Kalici gecersiz token'lari raporlar. */
export class ExpoPushAdapter implements PushAdapter {
  private readonly logger = new Logger('PushAdapter');
  private readonly expo = new Expo();

  async send(msg: PushMessage): Promise<PushResult> {
    const valid = msg.tokens.filter((tok) => Expo.isExpoPushToken(tok));
    if (valid.length === 0) {
      this.logger.debug(`[push] gecerli token yok (${msg.title})`);
      return {};
    }
    const messages: ExpoPushMessage[] = valid.map((to) => ({
      to,
      title: msg.title,
      body: msg.body,
      data: msg.data,
      sound: 'default',
    }));
    const chunks = this.expo.chunkPushNotifications(messages);
    const invalidTokens: string[] = [];
    for (const chunk of chunks) {
      const tickets = await this.expo.sendPushNotificationsAsync(chunk);
      tickets.forEach((ticket, index) => {
        if (
          ticket.status === 'error' &&
          ticket.details?.error === 'DeviceNotRegistered' &&
          typeof chunk[index]?.to === 'string'
        ) {
          invalidTokens.push(chunk[index].to as string);
        }
      });
    }
    return { invalidTokens };
  }
}
