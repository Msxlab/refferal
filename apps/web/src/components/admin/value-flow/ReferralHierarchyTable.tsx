'use client';

import { UserRound, Users } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { money } from '@/lib/format';
import type { ValueFlowMember, ValueFlowTreeScope } from './value-flow.types';
import type { ValueFlowSignal } from './value-flow.url';
import styles from './value-flow.module.css';

interface Props {
  members: ValueFlowMember[];
  currency: string;
  search: string;
  selectedId: string | null;
  signal: ValueFlowSignal | null;
  scope: ValueFlowTreeScope;
  expectedNoSaleCount: number | null;
  onSelect: (id: string) => void;
}

export function ReferralHierarchyTable({ members, currency, search, selectedId, signal, scope, expectedNoSaleCount, onSelect }: Props) {
  const term = search.trim().toLocaleLowerCase('en-US');
  const noSaleMembers = members.filter((member) => member.status === 'active' && member.salesCount === 0);
  const searchableMembers = signal === 'no-sale' ? noSaleMembers : members;
  const filtered = searchableMembers.filter((member) =>
    !term || `${member.name} ${member.referralCode} ${member.role} ${member.status}`.toLocaleLowerCase('en-US').includes(term),
  );
  const noSaleCountMismatch = signal === 'no-sale' && expectedNoSaleCount !== null && expectedNoSaleCount !== noSaleMembers.length;
  const noSaleMismatchMessage = noSaleCountMismatch
    ? `Network health reports ${expectedNoSaleCount} active member${expectedNoSaleCount === 1 ? '' : 's'} with no approved sale; this hierarchy snapshot contains ${noSaleMembers.length}. The sources cover different records or have not reconciled yet.`
    : null;
  const visible = filtered.slice(0, 50);

  if (filtered.length === 0) {
    const bounded = !scope.complete;
    const searchEmpty = Boolean(term);
    return (
      <div className={styles.emptyState} role="status" aria-live="polite">
        <Users aria-hidden="true" />
        <strong>{searchEmpty
          ? 'No members match this search'
          : signal === 'no-sale'
          ? noSaleCountMismatch ? 'No no-sale members are present in this hierarchy snapshot' : bounded ? 'No loaded members need follow-up' : 'No active members need follow-up'
          : bounded ? 'No members match this loaded snapshot' : 'No members match this search'}</strong>
        <span>{searchEmpty
          ? signal === 'no-sale' ? 'No loaded active members with no approved sale match this search.' : 'Try a name, referral code, role, or status.'
          : bounded
          ? `Search covers ${members.length} of ${scope.total} members in this bounded snapshot.`
          : signal === 'no-sale' ? 'Every active member has at least 1 approved sale.' : 'Try a name, referral code, role, or status.'}</span>
        {noSaleMismatchMessage && <span>{noSaleMismatchMessage}</span>}
      </div>
    );
  }

  return (
    <div id="value-flow-hierarchy-table" className={styles.tableFrame} tabIndex={-1}>
      <span className="sr-only" role="status" aria-live="polite">
        {filtered.length} member{filtered.length === 1 ? '' : 's'} match the current hierarchy filters.
      </span>
      <Table>
        <TableCaption className="sr-only">Referral hierarchy, current-month sales, revenue, commissions, and team size.</TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead>Member</TableHead>
            <TableHead>Level</TableHead>
            <TableHead className={styles.numeric}>Approved sales</TableHead>
            <TableHead className={styles.numeric}>Monthly revenue</TableHead>
            <TableHead className={styles.numeric}>Monthly commission</TableHead>
            <TableHead className={styles.numeric}>Team</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {visible.map((member) => (
            <TableRow key={member.id} aria-selected={selectedId === `member:${member.id}`} data-state={selectedId === `member:${member.id}` ? 'selected' : undefined}>
              <TableCell>
                <button type="button" className={styles.memberButton} onClick={() => onSelect(member.id)}>
                  <span className={styles.memberMark} aria-hidden="true"><UserRound /></span>
                  <span><strong>{member.name}</strong><small>{member.referralCode}</small></span>
                </button>
              </TableCell>
              <TableCell><Badge variant="outline">Level {member.depth}</Badge></TableCell>
              <TableCell className={styles.numeric}>{member.salesCount}</TableCell>
              <TableCell className={styles.numeric}>{money(member.revenueCents, currency)}</TableCell>
              <TableCell className={styles.numeric}>{money(member.monthlyCommissionCents, currency)}</TableCell>
              <TableCell className={styles.numeric}>{member.teamSize}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {(noSaleCountMismatch || filtered.length > visible.length || !scope.complete) && (
        <p className={styles.tableLimit} role="status">
          {noSaleMismatchMessage ? `${noSaleMismatchMessage} ` : ''}
          {filtered.length > visible.length ? `Showing the first 50 of ${filtered.length} matches. ` : ''}
          {!scope.complete ? `Hierarchy data is limited to ${members.length} of ${scope.total} members. ` : ''}
          {(filtered.length > visible.length || !scope.complete) ? 'Search to narrow the loaded results.' : ''}
        </p>
      )}
    </div>
  );
}
