import { Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import { Expo, ExpoPushMessage } from 'expo-server-sdk';

export const EMAIL_ADAPTER = Symbol('EMAIL_ADAPTER');
export const PUSH_ADAPTER = Symbol('PUSH_ADAPTER');

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
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

export interface PushAdapter {
  send(msg: PushMessage): Promise<void>;
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
    await this.transport.sendMail({ from: this.from, to: msg.to, subject: msg.subject, text: msg.text });
  }
}

/** Expo Push; token yoksa no-op. Gecersiz token'lari yutar (best-effort). */
export class ExpoPushAdapter implements PushAdapter {
  private readonly logger = new Logger('PushAdapter');
  private readonly expo = new Expo();

  async send(msg: PushMessage): Promise<void> {
    const valid = msg.tokens.filter((tok) => Expo.isExpoPushToken(tok));
    if (valid.length === 0) {
      this.logger.debug(`[push] gecerli token yok (${msg.title})`);
      return;
    }
    const messages: ExpoPushMessage[] = valid.map((to) => ({
      to,
      title: msg.title,
      body: msg.body,
      data: msg.data,
      sound: 'default',
    }));
    const chunks = this.expo.chunkPushNotifications(messages);
    for (const chunk of chunks) {
      await this.expo.sendPushNotificationsAsync(chunk);
    }
  }
}
