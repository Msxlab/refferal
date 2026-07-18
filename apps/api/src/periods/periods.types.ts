import { z } from 'zod';

export const lockPeriodSchema = z.object({
  note: z.string().max(500).optional(),
});
export type LockPeriodInput = z.infer<typeof lockPeriodSchema>;
