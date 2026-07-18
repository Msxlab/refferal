import { CookieOptions, Request, Response } from 'express';
import { configuredCorsOrigins } from '../common/cors';
import { authConfig } from './auth.config';

export const REFRESH_COOKIE_NAME = 'refearn_refresh';
const REFRESH_COOKIE_PATH = '/v1/auth';

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function isBrowserAuthRequest(req: Request): boolean {
  const origin = headerValue(req.headers.origin);
  if (origin && configuredCorsOrigins().includes(origin)) return true;

  const site = headerValue(req.headers['sec-fetch-site']);
  const mode = headerValue(req.headers['sec-fetch-mode']);
  return site === 'same-origin' && (mode === 'cors' || mode === 'same-origin');
}

export function readCookie(req: Request, name: string): string | undefined {
  const cookieHeader = headerValue(req.headers.cookie);
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() !== name) continue;
    const value = part.slice(separator + 1).trim();
    return value || undefined;
  }
  return undefined;
}

function refreshCookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: REFRESH_COOKIE_PATH,
    maxAge: authConfig.refreshTtlMs,
  };
}

export function setRefreshCookie(res: Response, refreshToken: string): void {
  res.cookie(REFRESH_COOKIE_NAME, refreshToken, refreshCookieOptions());
}

export function clearRefreshCookie(res: Response): void {
  const { maxAge: _maxAge, ...options } = refreshCookieOptions();
  res.clearCookie(REFRESH_COOKIE_NAME, options);
}
