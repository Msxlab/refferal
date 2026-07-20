import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

test('mobile team outline consumes only the privacy-safe member tree and stops at Tier 3', () => {
  const screen = readFileSync(new URL('../app/(tabs)/team.tsx', import.meta.url), 'utf8');
  const outline = readFileSync(new URL('../src/components/MemberNetworkOutline.tsx', import.meta.url), 'utf8');
  const adapter = readFileSync(new URL('../src/lib/member-network.ts', import.meta.url), 'utf8');

  assert.match(screen, /api\.get<unknown>\('\/app\/team\/tree'\)/);
  assert.match(screen, /\/app\/team\/tree\/children\?/);
  assert.doesNotMatch(screen, /api\.get<Team>\('\/app\/team'\)/);
  assert.match(screen, /<MemberNetworkOutline/);
  assert.match(screen, /const snapshotGeneration = useRef\(0\)/);
  assert.match(screen, /snapshotGeneration\.current !== generation/);

  assert.match(outline, /const terminal = node\.kind === 'anonymous' && node\.localTier === 3/);
  const terminalBlock = outline.slice(outline.indexOf('if (terminal) {'), outline.indexOf('if (!expandable) {'));
  assert.match(terminalBlock, /<View accessibilityLabel=/);
  assert.doesNotMatch(terminalBlock, /Pressable|accessibilityRole|accessibilityState|onPress/);
  assert.match(outline, /accessibilityState=\{\{ expanded, busy \}\}/);

  assert.match(adapter, /typeof decode !== 'function' \|\| typeof encode !== 'function'\) return true/);
  assert.match(adapter, /only\(selfPerformance, \['currency', 'period', 'visibleApprovedSales', 'visibleTeamVolumeCents'\], 'self\.performance'\)/);
  assert.match(adapter, /ISO_MONTH\.test\(requiredString\(selfPerformance\.period/);
  assert.doesNotMatch(`${screen}\n${outline}\n${adapter}`, /Tier 4/);
});
