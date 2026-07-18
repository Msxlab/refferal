export interface RecommendationText {
  key: string;
  params: unknown;
}

export interface RecommendationAction {
  type: 'navigate';
  path: string;
}

export interface RecommendationItem {
  key: string;
  title: RecommendationText;
  body: RecommendationText;
  label: RecommendationText | null;
  action: RecommendationAction | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isText(value: unknown): value is RecommendationText {
  return isRecord(value) && typeof value.key === 'string';
}

function isAction(value: unknown): value is RecommendationAction | null {
  return value === null || (isRecord(value) && value.type === 'navigate' && typeof value.path === 'string');
}

function isItem(value: unknown): value is RecommendationItem {
  return (
    isRecord(value) &&
    typeof value.key === 'string' &&
    isText(value.title) &&
    isText(value.body) &&
    (value.label === null || isText(value.label)) &&
    isAction(value.action)
  );
}

/** Server-provided recommendation text and params are never rendered directly. */
export function recommendationItems(value: unknown): RecommendationItem[] {
  if (!isRecord(value) || !Array.isArray(value.items)) return [];
  return value.items.filter(isItem).slice(0, 3);
}

const mobilePaths: Record<string, string> = {
  '/app': '/(tabs)',
  '/app/wallet': '/(tabs)/wallet',
  '/app/team': '/(tabs)/team',
  '/app/invite': '/(tabs)/invite',
};

const directMobilePaths = new Set(['/mfa-setup', '/(tabs)', '/(tabs)/wallet', '/(tabs)/team', '/(tabs)/invite']);

/** Only map server routes that the native app actually supports. */
export function mobileRecommendationPath(action: RecommendationAction | null): string | null {
  if (!action || action.type !== 'navigate') return null;
  const { path } = action;
  if (!path.startsWith('/') || path.startsWith('//') || path.includes('\\')) return null;
  if (directMobilePaths.has(path)) return path;
  return mobilePaths[path] ?? null;
}
