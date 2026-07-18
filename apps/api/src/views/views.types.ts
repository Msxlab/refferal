import { z } from 'zod';

// config: hedefe gore degisen serbest JSON (filtre+siralama seti). Boyut sinirli.
const config = z.record(z.any()).refine((v) => JSON.stringify(v).length <= 8000, { message: 'config cok buyuk' });

export const listViewsSchema = z.object({
  target: z.string().trim().min(1).max(40),
});
export type ListViewsInput = z.infer<typeof listViewsSchema>;

export const createViewSchema = z.object({
  target: z.string().trim().min(1).max(40),
  name: z.string().trim().min(1).max(80),
  shared: z.boolean().default(false),
  config: config.default({}),
});
export type CreateViewInput = z.infer<typeof createViewSchema>;

export const updateViewSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  shared: z.boolean().optional(),
  config: config.optional(),
});
export type UpdateViewInput = z.infer<typeof updateViewSchema>;
