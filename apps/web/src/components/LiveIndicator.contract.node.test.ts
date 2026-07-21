import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const source = readFileSync(new URL('./LiveIndicator.tsx', import.meta.url), 'utf8');
const adminLayout = readFileSync(new URL('../app/admin/layout.tsx', import.meta.url), 'utf8');

test('live event stream sends credentials only in an authorization header', () => {
  assert.doesNotMatch(source, /\bEventSource\b/);
  assert.doesNotMatch(source, /events\/stream\?token/);
  assert.match(source, /fetch\(`\$\{API_BASE\}\/events\/stream`,/);
  assert.match(source, /Authorization:\s*`Bearer \$\{token\}`/);
  assert.match(source, /Accept:\s*'text\/event-stream'/);
});

test('live event stream parses SSE frames and reconnects safely after a transport close', () => {
  assert.match(source, /function parseSseFrame\(/);
  assert.match(source, /response\.body\.getReader\(\)/);
  assert.match(source, /scheduleReconnect\(connect\)/);
  assert.match(source, /abort\.abort\(\)/);
  assert.match(source, /response\.status !== 401 && response\.status !== 403/);
});

test('tenant staff do not mount the privileged live event client', () => {
  assert.match(adminLayout, /\{!isStaff && <LiveIndicator \/>\}/);
});
