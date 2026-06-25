import { z } from 'zod';

// Odul tutarlari integer cent.
const bonusCents = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);

export const prizeSchema = z.object({
  rank: z.number().int().min(1).max(100),
  bonusCents,
});

const baseFields = {
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(1000).optional(),
  metric: z.enum(['revenue', 'sales_count', 'new_recruits', 'invites']),
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date(),
  // her rank en fazla bir kez; bos olabilir (sembolik yaris)
  prizes: z.array(prizeSchema).max(100).default([]),
};

export const createCampaignSchema = z
  .object(baseFields)
  .refine((v) => v.endsAt > v.startsAt, { message: 'endsAt, startsAt sonrasinda olmali', path: ['endsAt'] })
  .refine((v) => new Set(v.prizes.map((p) => p.rank)).size === v.prizes.length, {
    message: 'her rank yalnizca bir kez tanimlanabilir',
    path: ['prizes'],
  });
export type CreateCampaignInput = z.infer<typeof createCampaignSchema>;

// Guncelleme: tum alanlar opsiyonel (yalniz draft duzenlenir — service kontrol eder).
export const updateCampaignSchema = z.object({
  name: baseFields.name.optional(),
  description: z.string().trim().max(1000).optional(),
  metric: baseFields.metric.optional(),
  startsAt: z.coerce.date().optional(),
  endsAt: z.coerce.date().optional(),
  prizes: z.array(prizeSchema).max(100).optional(),
  status: z.enum(['draft', 'active']).optional(), // ended yalniz finalize ile
});
export type UpdateCampaignInput = z.infer<typeof updateCampaignSchema>;
