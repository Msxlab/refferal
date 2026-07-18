import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const authorityKeys = [
  'bulk_scope',
  'invite_acceptance',
  'mfa_assurance',
  'mfa_recovery',
  'payout_readiness',
  'payment_lifecycle',
  'capability_tenancy',
  'sensitive_reveal',
  'multi_currency',
  'member_sale_entry',
  'nps_eligibility',
  'telemetry',
] as const;

type AuthorityKey = (typeof authorityKeys)[number];
type Authority = 'implemented' | 'partial' | 'absent' | 'not-applicable';

type AuthorityEvidence = {
  key: AuthorityKey;
  sourceFiles: string[];
  endpoints: string[];
  authority: Authority;
  safeFallback: string;
  testCommand: string;
};

const allowedAuthorities: Authority[] = [
  'implemented',
  'partial',
  'absent',
  'not-applicable',
];
const matrixPath = resolve(
  __dirname,
  '../../../../docs/superpowers/plans/evidence/earnica-p0-authority-matrix.json',
);

function loadMatrix(): AuthorityEvidence[] {
  return JSON.parse(readFileSync(matrixPath, 'utf8')) as AuthorityEvidence[];
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

describe('Earnica P0 authority evidence', () => {
  it('contains exactly one row for each required authority key', () => {
    const matrix = loadMatrix();
    const keys = matrix.map((row) => row.key);

    expect(matrix).toHaveLength(authorityKeys.length);
    expect(new Set(keys).size).toBe(authorityKeys.length);
    expect([...keys].sort()).toEqual([...authorityKeys].sort());
  });

  it('keeps every row within the evidence contract', () => {
    const matrix = loadMatrix();

    for (const row of matrix) {
      expect(Object.keys(row).sort()).toEqual(
        [
          'authority',
          'endpoints',
          'key',
          'safeFallback',
          'sourceFiles',
          'testCommand',
        ].sort(),
      );
      expect(authorityKeys).toContain(row.key);
      expect(allowedAuthorities).toContain(row.authority);
      expect(Array.isArray(row.sourceFiles)).toBe(true);
      expect(Array.isArray(row.endpoints)).toBe(true);
      expect(row.sourceFiles.every(isNonEmptyString)).toBe(true);
      expect(row.endpoints.every(isNonEmptyString)).toBe(true);

      if (row.authority !== 'not-applicable') {
        expect(row.sourceFiles.length).toBeGreaterThan(0);
        expect(row.endpoints.length).toBeGreaterThan(0);
      }

      expect(isNonEmptyString(row.safeFallback)).toBe(true);
      expect(isNonEmptyString(row.testCommand)).toBe(true);
    }
  });

  it('fails closed when telemetry authority is absent', () => {
    const telemetry = loadMatrix().find((row) => row.key === 'telemetry');

    expect(telemetry).toBeDefined();
    expect(telemetry?.authority).toBe('absent');
    expect(telemetry?.safeFallback).toMatch(/KPIs?[^.]*unmeasured/i);
    expect(telemetry?.safeFallback).toMatch(
      /new analytics?[^.]*approval-required/i,
    );
  });
});
