import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * OFAC/AML yaptirim taramasi (#10). Self-hosted: liste acik veri.
 * MVP'de yerlesik ornek liste yuklenir; PROD'da refresh() OFAC SDN dosyasini (acik) ceker.
 * (Dis servis bagimliligi yok — self-hosted ilkesi.)
 */
const SAMPLE_OFAC: Array<{ name: string; country?: string }> = [
  { name: 'Dragan Asanin' },
  { name: 'Ali Sadr Hashemi Nejad', country: 'IR' },
  { name: 'Viktor Bout', country: 'RU' },
  { name: 'Joaquin Guzman Loera', country: 'MX' },
  { name: 'Test Sanctioned Person' }, // dev/test
];

export function normalizeName(name: string): string {
  return name.toLowerCase().trim().replace(/\s+/g, ' ');
}

@Injectable()
export class SanctionsService {
  private readonly logger = new Logger(SanctionsService.name);
  constructor(private readonly prisma: PrismaService) {}

  /** Listeyi yenile (MVP: yerlesik ornek). Donen: yuklenen kayit sayisi. */
  async refresh(): Promise<{ loaded: number }> {
    for (const e of SAMPLE_OFAC) {
      const normalizedName = normalizeName(e.name);
      await this.prisma.sanctionsEntry.upsert({
        where: { source_normalizedName: { source: 'OFAC', normalizedName } },
        create: { name: e.name, normalizedName, source: 'OFAC', country: e.country },
        update: { name: e.name, country: e.country },
      });
    }
    return { loaded: SAMPLE_OFAC.length };
  }

  async count(): Promise<number> {
    return this.prisma.sanctionsEntry.count();
  }

  /**
   * Ad listeyle eslesiyor mu (token-farkinda). Eslesen kayitlari doner.
   * Ham cift-yonlu substring yerine: bir entry'nin TUM token'lari girdide TAM KELIME olarak
   * geciyorsa eslesme. Bu, "chris" -> "christopher" gibi mid-word yanlis-pozitifleri keser;
   * "ali sadr hashemi nejad" -> "ali sadr hashemi nejad" gibi gercek eslesmeler korunur.
   */
  async screen(name: string): Promise<Array<{ name: string; source: string; country: string | null }>> {
    const n = normalizeName(name);
    if (n.length < 3) return [];
    const nTokens = new Set(n.split(' ').filter(Boolean));
    const entries = await this.prisma.sanctionsEntry.findMany({ select: { name: true, normalizedName: true, source: true, country: true } });
    return entries
      .filter((e) => {
        const eTokens = e.normalizedName.split(' ').filter(Boolean);
        return eTokens.length > 0 && eTokens.every((t) => nTokens.has(t));
      })
      .map((e) => ({ name: e.name, source: e.source, country: e.country }));
  }

  /** Ad eslesiyor mu (boolean kisayolu). */
  async isHit(name: string): Promise<boolean> {
    return (await this.screen(name)).length > 0;
  }
}
