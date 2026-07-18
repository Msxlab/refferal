import { api } from './api';

export interface OverviewResp {
  totals: {
    grossRevenueCents: string; netCents: string; payableCents: string;
    activeMembers: number; companies: number;
  };
  leaderboard: Array<{
    id: string; slug: string; name: string; status: string; currency: string;
    revenueThisMonthCents: string; members: number; activeMembers: number;
  }>;
  attention: { payoutApprovals: number; riskReviews: number; overdueInvoices: number; campaignsToFinalize: number };
}

export function getOverview(): Promise<OverviewResp> {
  return api.get<OverviewResp>('/platform/overview');
}

/** Sahip adina bir sirket icin god token alir (drill-in). */
export function actAsCompany(companyId: string): Promise<{ accessToken: string }> {
  return api.post<{ accessToken: string }>(`/platform/companies/${companyId}/act-as`);
}
