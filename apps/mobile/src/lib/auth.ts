import AsyncStorage from '@react-native-async-storage/async-storage';

export interface MembershipSummary {
  id: string;
  tenantId: string;
  tenantSlug: string;
  tenantName: string;
  role: string;
  referralCode: string;
  depth: number;
}

export interface Session {
  accessToken: string;
  refreshToken: string;
  user: { id: string; email: string; fullName: string; locale: string; emailVerified: boolean };
  activeMembershipId: string | null;
  memberships: MembershipSummary[];
}

const KEY = 'refearn.session';

// Bellek ici onbellek: AsyncStorage async oldugu icin senkron erisim gerektiginde
let cached: Session | null = null;

export async function loadSession(): Promise<Session | null> {
  if (cached) return cached;
  const raw = await AsyncStorage.getItem(KEY);
  cached = raw ? (JSON.parse(raw) as Session) : null;
  return cached;
}

export async function saveSession(s: Session): Promise<void> {
  cached = s;
  await AsyncStorage.setItem(KEY, JSON.stringify(s));
}

export async function clearSession(): Promise<void> {
  cached = null;
  await AsyncStorage.removeItem(KEY);
}

export function activeMembership(s: Session): MembershipSummary | null {
  return s.memberships.find((m) => m.id === s.activeMembershipId) ?? s.memberships[0] ?? null;
}
