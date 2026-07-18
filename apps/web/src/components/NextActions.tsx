'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { api } from '@/lib/api';
import { recommendationCopy, t } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

interface RecommendationText {
  key: string;
  params: unknown;
}

interface RecommendationAction {
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

export function recommendationHref(action: RecommendationAction | null): string | null {
  if (!action || action.type !== 'navigate') return null;
  const { path } = action;
  return path.startsWith('/') && !path.startsWith('//') && !path.includes('\\') ? path : null;
}

export function NextActions({ endpoint }: { endpoint: string }) {
  const [items, setItems] = useState<RecommendationItem[] | null>(null);

  useEffect(() => {
    let active = true;
    setItems(null);
    void api
      .get<unknown>(endpoint)
      .then((response) => {
        if (active) setItems(recommendationItems(response));
      })
      .catch(() => {
        if (active) setItems([]);
      });
    return () => {
      active = false;
    };
  }, [endpoint]);

  if (!items?.length) return null;

  return (
    <section className="mb-4 fade-in" aria-labelledby="next-actions-heading">
      <Card size="sm">
        <CardHeader className="border-b">
          <CardTitle id="next-actions-heading">{t('recommendation.heading')}</CardTitle>
          <CardDescription>{t('recommendation.sub')}</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="grid gap-3" aria-label={t('recommendation.heading')}>
            {items.map((item) => {
              const copy = recommendationCopy(item.key);
              const href = recommendationHref(item.action);
              return (
                <li key={item.key} className="flex flex-col gap-3 rounded-lg border bg-muted/30 p-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="grid gap-1">
                    <div className="text-sm font-medium">{copy.title}</div>
                    <p className="m-0 text-sm text-muted-foreground">{copy.body}</p>
                  </div>
                  {href ? (
                    <Button variant="outline" size="sm" asChild>
                      <Link href={href}>
                        {copy.action}
                        <ArrowRight data-icon="inline-end" aria-hidden="true" />
                      </Link>
                    </Button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>
    </section>
  );
}
