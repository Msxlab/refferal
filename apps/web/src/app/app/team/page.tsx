'use client';

import { MemberNetworkErrorBoundary } from '@/components/member-network/MemberNetworkErrorBoundary';
import { MemberNetworkTreeContent } from '@/components/member-network/MemberNetworkTreeContent';

export default function TeamPage() {
  return (
    <MemberNetworkErrorBoundary>
      <MemberNetworkTreeContent />
    </MemberNetworkErrorBoundary>
  );
}
