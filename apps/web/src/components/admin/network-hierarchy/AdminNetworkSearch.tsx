'use client';

import { LoaderCircle, Search, UserRoundSearch } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { AdminHierarchyMemberNode } from '@/components/network-hierarchy/types';
import { api, ApiError } from '@/lib/api';
import styles from './admin-network-hierarchy.module.css';

interface SearchPage {
  items: AdminHierarchyMemberNode[];
  nextCursor: string | null;
  snapshotAt: string;
}

interface Props {
  onSelect: (member: AdminHierarchyMemberNode) => void;
}

/**
 * This is intentionally an ephemeral, body-backed search. The typed query is
 * neither encoded in the hierarchy URL nor persisted in browser storage.
 */
export function AdminNetworkSearch({ onSelect }: Props) {
  const [draft, setDraft] = useState('');
  const [items, setItems] = useState<AdminHierarchyMemberNode[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const requestGeneration = useRef(0);

  const request = async (query: string, cursor?: string, append = false) => {
    const generation = ++requestGeneration.current;
    if (append) setLoadingMore(true);
    else {
      setLoading(true);
      setError('');
    }
    try {
      const page = await api.post<SearchPage>('/admin/members/network-search', {
        query,
        ...(cursor ? { cursor } : {}),
      });
      if (generation !== requestGeneration.current) return;
      setItems((current) => (append ? [...current, ...page.items] : page.items));
      setNextCursor(page.nextCursor);
    } catch (reason) {
      if (generation !== requestGeneration.current) return;
      setError(reason instanceof ApiError ? reason.message : 'Network search could not be completed.');
      if (!append) {
        setItems([]);
        setNextCursor(null);
      }
    } finally {
      if (generation === requestGeneration.current) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  };

  useEffect(() => {
    const query = draft.trim();
    if (query.length < 2) {
      requestGeneration.current += 1;
      setItems([]);
      setNextCursor(null);
      setError('');
      setLoading(false);
      return;
    }
    const timer = window.setTimeout(() => {
      void request(query);
    }, 260);
    return () => window.clearTimeout(timer);
  }, [draft]);

  const query = draft.trim();
  return (
    <section className={styles.searchPanel} aria-label="Find a network member">
      <label className={styles.searchLabel} htmlFor="admin-network-search">
        <Search aria-hidden="true" />
        Find a person
      </label>
      <div className={styles.searchInputWrap}>
        <input
          id="admin-network-search"
          type="search"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Name or referral code"
          autoComplete="off"
        />
        {loading ? <LoaderCircle className={styles.spinner} aria-label="Searching network" /> : null}
      </div>
      <p className={styles.searchAssist}>Search stays in this screen and never changes the hierarchy scope.</p>

      {error ? <p className={styles.searchError} role="status">{error}</p> : null}
      {!loading && !error && query.length >= 2 && items.length === 0 ? (
        <p className={styles.searchEmpty}>No members match this search.</p>
      ) : null}

      {items.length > 0 ? (
        <ul className={styles.searchResults} aria-label="Network member search results">
          {items.map((member) => (
            <li key={member.membershipId}>
              <button type="button" onClick={() => onSelect(member)}>
                <span className={styles.searchAvatar} aria-hidden="true">{member.initials}</span>
                <span>
                  <strong>{member.displayName}</strong>
                  <small>{member.referralCode} · Global tier {member.globalTier}</small>
                </span>
                <UserRoundSearch aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {nextCursor ? (
        <button
          type="button"
          className={styles.moreResultsButton}
          disabled={loadingMore}
          onClick={() => void request(query, nextCursor, true)}
        >
          {loadingMore ? 'Loading more…' : 'Show more results'}
        </button>
      ) : null}
    </section>
  );
}
