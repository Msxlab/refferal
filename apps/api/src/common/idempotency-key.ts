import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';

const idempotencyKeySchema = z.string().trim().min(16).max(200).regex(/^[\x21-\x7e]+$/).optional();

export function parseIdempotencyKey(value: string | undefined): string | undefined {
  const parsed = idempotencyKeySchema.safeParse(value);
  if (!parsed.success) throw new BadRequestException('Idempotency-Key must be 16-200 printable characters');
  return parsed.data;
}
