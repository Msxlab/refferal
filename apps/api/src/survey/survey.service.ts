import { Injectable } from '@nestjs/common';
import { ActorContext } from '../common/actor';
import { PrismaService } from '../prisma/prisma.service';

const PROMPT_COOLDOWN_DAYS = 90;

@Injectable()
export class SurveyService {
  constructor(private readonly prisma: PrismaService) {}

  /** Uyenin son yaniti + tekrar sorulmali mi (90 gun). */
  async mine(membershipId: string) {
    const last = await this.prisma.surveyResponse.findFirst({ where: { membershipId }, orderBy: { createdAt: 'desc' } });
    const shouldPrompt = !last || Date.now() - last.createdAt.getTime() > PROMPT_COOLDOWN_DAYS * 86_400_000;
    return { shouldPrompt, lastScore: last?.score ?? null, lastAt: last?.createdAt ?? null };
  }

  async submit(actor: ActorContext, membershipId: string, score: number, comment?: string) {
    const r = await this.prisma.surveyResponse.create({
      data: { tenantId: actor.tenantId, membershipId, score, comment: comment?.trim() || null },
    });
    return { id: r.id, score: r.score };
  }

  /** Admin: NPS skoru (promoter% - detractor%) + son yorumlar. */
  async summary(tenantId: string) {
    const rows = await this.prisma.surveyResponse.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: { /* membership adi gizlilik: yalniz yorum + skor */ },
    });
    const total = rows.length;
    const promoters = rows.filter((r) => r.score >= 9).length;
    const passives = rows.filter((r) => r.score >= 7 && r.score <= 8).length;
    const detractors = rows.filter((r) => r.score <= 6).length;
    const nps = total > 0 ? Math.round(((promoters - detractors) / total) * 100) : null;
    return {
      nps, total, promoters, passives, detractors,
      recent: rows.filter((r) => r.comment).slice(0, 10).map((r) => ({ score: r.score, comment: r.comment, createdAt: r.createdAt })),
    };
  }

  /** Bir uyenin en son NPS skoru (member 360 churn sinyali). */
  async latestForMember(membershipId: string): Promise<number | null> {
    const last = await this.prisma.surveyResponse.findFirst({ where: { membershipId }, orderBy: { createdAt: 'desc' }, select: { score: true } });
    return last?.score ?? null;
  }
}
