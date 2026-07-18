export type RecommendationScope = 'member' | 'tenant' | 'platform';

export type RecommendationParamName = 'count' | 'oldestAgeHours';
export type RecommendationParams = Partial<Record<RecommendationParamName, number>>;

export interface RecommendationMessage {
  key: string;
  params: RecommendationParams;
}

export type RecommendationRoute =
  | '/app/wallet'
  | '/app/invite'
  | '/mfa-setup'
  | '/admin/sales'
  | '/admin/payouts'
  | '/platform';

export interface RecommendationAction {
  type: 'navigate';
  path: RecommendationRoute;
}

export interface RecommendationItem {
  key: string;
  title: RecommendationMessage;
  body: RecommendationMessage;
  label: RecommendationMessage | null;
  action: RecommendationAction | null;
}

export interface RecommendationResponse {
  scope: RecommendationScope;
  policyVersion: 'v1';
  generatedAt: string;
  items: RecommendationItem[];
}
