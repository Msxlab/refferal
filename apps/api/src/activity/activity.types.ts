import { z } from 'zod';

/**
 * Alan adlari + type union, gelecekteki ActivityEvent tablosunu birebir taklit eder
 * (type / ts / subject / amount). Bugun derive-on-read; kaynak sonradan gercek tabloya
 * degistirilebilir (read/unread + realtime) — istemci sozlesmesi degismez.
 */
export type ActivityType =
  | 'team_join'
  | 'sale_approved'
  | 'commission_credited'
  | 'check_mailed'
  | 'check_paid';

export interface ActivityItem {
  id: string;            // kaynak-benzersiz id (ts sirasi icin stabil)
  type: ActivityType;
  ts: string;            // ISO datetime
  title: string;         // uye-dostu satir
  amountCents?: string;  // para satirlarinda (BigInt string)
  subject?: string;      // opsiyonel ad (yalniz gizlilik-guvenli: direkt recruit)
}

export const ACTIVITY_PAGE_SIZE = 20;

// Cursor: "<isoTs>|<id>" (ts,id) desc anahtari. Opsiyonel — yoksa bastan.
export const activityQuerySchema = z.object({
  cursor: z.string().trim().max(120).optional(),
});
export type ActivityQuery = z.infer<typeof activityQuerySchema>;
