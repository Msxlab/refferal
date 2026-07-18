'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Building2,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  KeyRound,
  Mail,
  Search,
  ShieldAlert,
  ShieldCheck,
  Tags,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { Loading } from '@/components/ui';
import { Drawer } from '@/components/Drawer';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Field, FieldGroup, FieldLabel, FieldSet, FieldLegend } from '@/components/ui/field';
import { Input } from '@/components/ui/input';

interface AuditItem {
  id: string;
  action: string;
  entity: string;
  entityId: string | null;
  actorUserId: string | null;
  before: unknown;
  after: unknown;
  ip: string | null;
  createdAt: string;
}
interface AuditList { total: number; page: number; pageSize: number; items: AuditItem[] }

const ENTITY_ICON: Record<string, LucideIcon> = {
  sale: CircleDollarSign,
  payout: CircleDollarSign,
  membership: Users,
  invite: Mail,
  tenant: Building2,
  rbac: KeyRound,
  role: ShieldCheck,
  security: ShieldAlert,
};

function when(iso: string): string {
  return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function stringify(value: unknown): string {
  if (value === null || value === undefined) return '-';
  try {
    return JSON.stringify(value);
  } catch {
    return '[unavailable]';
  }
}

function EntityIcon({ entity, className }: { entity: string; className?: string }) {
  const Icon = ENTITY_ICON[entity] ?? Tags;
  return <Icon aria-hidden="true" className={cn('size-4', className)} />;
}

export default function AuditPage() {
  const [list, setList] = useState<AuditList | null>(null);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [entities, setEntities] = useState<Set<string>>(new Set());
  const [detail, setDetail] = useState<AuditItem | null>(null);
  const [page, setPage] = useState(1);

  const load = useCallback(async () => {
    try {
      setError('');
      setList(await api.get<AuditList>(`/admin/audit?page=${page}&pageSize=100`));
    } catch (e) {
      setError(String((e as ApiError).message));
    }
  }, [page]);
  useEffect(() => {
    void load();
  }, [load]);

  const allEntities = useMemo(() => Array.from(new Set((list?.items ?? []).map((a) => a.entity))).sort(), [list]);
  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (list?.items ?? []).filter((a) => {
      if (entities.size > 0 && !entities.has(a.entity)) return false;
      if (!term) return true;
      return a.action.toLowerCase().includes(term) || a.entity.toLowerCase().includes(term) || stringify(a.after).toLowerCase().includes(term);
    });
  }, [list, q, entities]);
  const pageCount = list ? Math.max(1, Math.ceil(list.total / list.pageSize)) : 1;

  function toggleEntity(entity: string) {
    setEntities((previous) => {
      const next = new Set(previous);
      if (next.has(entity)) next.delete(entity);
      else next.add(entity);
      return next;
    });
  }

  if (error) {
    return (
      <Alert variant="destructive" className="fade-in">
        <AlertCircle />
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }

  return (
    <div>
      <div className="eyebrow fade-in">{t('nav.audit')}</div>
      <h1 className="h1 fade-in">Audit Log</h1>
      <p className="sub fade-in">Every action affecting money, roles, and plans is recorded here.</p>

      <Card className="fade-in delay-1 my-4">
        <CardContent className="grid gap-4 lg:grid-cols-[minmax(220px,360px)_1fr_auto] lg:items-start">
          <FieldGroup>
            <Field>
              <div className="relative">
                <Search aria-hidden="true" className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  aria-label="Search audit events"
                  className="pl-8"
                  placeholder="Search action, entity, or data"
                  value={q}
                  onChange={(event) => setQ(event.target.value)}
                />
              </div>
            </Field>
          </FieldGroup>

          <FieldSet className="gap-2">
            <FieldLegend variant="label">Entity</FieldLegend>
            {allEntities.length === 0 ? (
              <span className="text-xs text-muted-foreground">No entities yet.</span>
            ) : (
              <div className="flex flex-wrap gap-2">
                {allEntities.map((entity) => {
                  const checked = entities.has(entity);
                  return (
                    <Field key={entity} orientation="horizontal" className="w-auto">
                      <FieldLabel
                        className={cn(
                          'h-8 cursor-pointer rounded-lg border px-2.5 text-xs transition-colors',
                          checked
                            ? 'border-primary/40 bg-primary/10 text-foreground'
                            : 'border-border bg-background hover:bg-muted',
                        )}
                      >
                        <Checkbox
                          aria-label={`Filter ${entity}`}
                          checked={checked}
                          onCheckedChange={() => toggleEntity(entity)}
                        />
                        <EntityIcon entity={entity} className="size-3.5 text-muted-foreground" />
                        <span>{entity}</span>
                      </FieldLabel>
                    </Field>
                  );
                })}
              </div>
            )}
          </FieldSet>

          <Badge variant="outline" className="justify-self-start lg:justify-self-end">
            {filtered.length} {filtered.length === 1 ? 'event' : 'events'}
          </Badge>
        </CardContent>
      </Card>

      <Card className="fade-in delay-2 py-0">
        {!list ? <CardContent className="py-4"><Loading rows={6} /></CardContent> : filtered.length === 0 ? (
          <CardContent className="py-5 text-sm text-muted-foreground">No matching events.</CardContent>
        ) : (
          <div>
            {filtered.map((a) => (
              <Button
                key={a.id}
                type="button"
                variant="ghost"
                onClick={() => setDetail(a)}
                className="h-auto w-full justify-start gap-3 rounded-none border-b px-4 py-3 text-left whitespace-normal last:border-b-0 hover:bg-muted/50"
              >
                <span className={cn(
                  'grid size-8 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground',
                  a.entity === 'security' && 'bg-destructive/10 text-destructive',
                )}>
                  <EntityIcon entity={a.entity} />
                </span>
                <span className="min-w-0 flex-1 text-left">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold">{a.action}</span>
                    <Badge variant={a.entity === 'security' ? 'destructive' : 'secondary'}>{a.entity}</Badge>
                  </span>
                  <span className="mt-1 block overflow-hidden text-ellipsis whitespace-nowrap font-mono text-xs text-muted-foreground">
                    {stringify(a.after)}
                  </span>
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">{when(a.createdAt)}</span>
              </Button>
            ))}
          </div>
        )}
        {list && list.total > list.pageSize && (
          <CardContent className="flex flex-wrap items-center justify-between gap-3 border-t py-3">
            <span className="text-xs text-muted-foreground">
              Page {list.page} of {pageCount} · {list.total} events
            </span>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={list.page <= 1}
                onClick={() => { setDetail(null); setPage((current) => Math.max(1, current - 1)); }}
              >
                <ChevronLeft data-icon="inline-start" />
                Previous
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={list.page >= pageCount}
                onClick={() => { setDetail(null); setPage((current) => Math.min(pageCount, current + 1)); }}
              >
                Next
                <ChevronRight data-icon="inline-end" />
              </Button>
            </div>
          </CardContent>
        )}
      </Card>

      {detail && (
        <Drawer title={detail.action} subtitle={`${detail.entity}${detail.entityId ? ` - ${detail.entityId.slice(0, 8)}` : ''}`} onClose={() => setDetail(null)} width={520}>
          <div className="grid gap-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <DetailField label="When" value={when(detail.createdAt)} />
              <DetailField label="Entity" value={detail.entity} />
              <DetailField label="Actor" value={detail.actorUserId ? detail.actorUserId.slice(0, 8) : 'system'} />
              <DetailField label="IP" value={detail.ip ?? '-'} />
            </div>
            <Diff label="Before" data={detail.before} />
            <Diff label="After" data={detail.after} />
          </div>
        </Drawer>
      )}
    </div>
  );
}

function DetailField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="mt-0.5 font-mono text-[13.5px]">{value}</div>
    </div>
  );
}

function Diff({ label, data }: { label: string; data: unknown }) {
  const empty = data === null || data === undefined || (typeof data === 'object' && Object.keys(data as object).length === 0);
  return (
    <div>
      <div className="mb-1.5 text-[11px] text-muted-foreground">{label}</div>
      {empty ? (
        <div className="text-xs text-muted-foreground">-</div>
      ) : (
        <pre className="m-0 overflow-auto whitespace-pre-wrap break-words rounded-lg border bg-muted/50 p-3 font-mono text-xs">
          {JSON.stringify(data, null, 2)}
        </pre>
      )}
    </div>
  );
}
