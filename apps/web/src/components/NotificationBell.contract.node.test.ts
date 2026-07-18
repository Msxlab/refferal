import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const source = readFileSync(new URL('./NotificationBell.tsx', import.meta.url), 'utf8');
const memberLayout = readFileSync(new URL('../app/app/layout.tsx', import.meta.url), 'utf8');
const adminLayout = readFileSync(new URL('../app/admin/layout.tsx', import.meta.url), 'utf8');

function functionBody(name: string): string {
  const match = source.match(new RegExp(`function ${name}\\([^)]*\\)[^{]*\\{([\\s\\S]*?)\\r?\\n\\}`));
  assert.ok(match, `${name} helper must remain directly testable`);
  return match[1];
}

test('inbox failures distinguish an unavailable first load from stale cached content', () => {
  assert.match(source, /function inboxFailureMessage\(hasInbox: boolean\): string/);
  assert.match(source, /Notifications could not be loaded\./);
  assert.match(source, /Notifications could not be refreshed\. Showing previously loaded notifications\./);
  assert.match(source, /\{inboxError && \(/);
  assert.match(source, /role="alert"/);
  assert.match(source, /onClick=\{handleRetry\}/);
  assert.match(source, /\{loading \? 'Refreshing\.\.\.' : 'Retry'\}/);
  assert.match(source, /inboxFailureMessage\(Boolean\(inbox\)\)/);
});

test('cached notifications remain visible while a refresh is pending or fails', () => {
  assert.match(source, /loading && inbox && !inboxError/);
  assert.match(source, />\s*Refreshing\.\.\.\s*<\/div>/);
  assert.match(source, /\{inbox && inbox\.items\.length === 0 && \(/);
  assert.match(source, /\{inbox\?\.items\.map\(\(it\) => \{/);
  assert.doesNotMatch(source, /!loading && inbox && inbox\.items\.length/);
  assert.doesNotMatch(source, /!loading && inbox\?\.items\.map/);
});

test('only the latest mounted inbox load may commit and mutations invalidate older loads', () => {
  const isCurrent = new Function(
    'requestGeneration',
    'currentGeneration',
    functionBody('requestIsCurrent'),
  ) as (requestGeneration: number, currentGeneration: number) => boolean;

  assert.equal(isCurrent(4, 4), true);
  assert.equal(isCurrent(3, 4), false);
  assert.match(source, /const mountedRef = useRef\(false\);/);
  assert.match(source, /const inboxRequestGeneration = useRef\(0\);/);
  assert.match(source, /mountedRef\.current = true;/);
  assert.match(source, /mountedRef\.current = false;/);
  assert.match(source, /const requestGeneration = \+\+inboxRequestGeneration\.current;/);
  assert.match(
    source,
    /const isCurrent = \(\) => mountedRef\.current && requestIsCurrent\(requestGeneration, inboxRequestGeneration\.current\);/,
  );
  assert.match(source, /if \(!isCurrent\(\)\) return;/);
  assert.match(source, /if \(isCurrent\(\)\) setInboxError\(true\);/);
  assert.match(source, /if \(isCurrent\(\)\) setLoading\(false\);/);
  assert.match(
    source,
    /function beginNotificationMutation\(\) \{[\s\S]*?invalidateNotificationLoads\(\);/,
  );
  assert.match(
    source,
    /async function markAll\(\) \{[\s\S]*?beginNotificationMutation\(\);/,
  );
  assert.match(
    source,
    /async function openItem\(it: Item\)[\s\S]*?if \(!it\.read\) \{\s*beginNotificationMutation\(\);/,
  );
});

test('unread writes are latest-only and count polling remains single-flight across mutations', () => {
  assert.match(source, /const unreadWriteGeneration = useRef\(0\);/);
  assert.match(source, /const countRequestFlight = useRef<Promise<void> \| null>\(null\);/);
  assert.match(source, /const notificationMutationPendingRef = useRef\(0\);/);
  assert.match(
    source,
    /if \(notificationMutationPendingRef\.current > 0 \|\| countRequestFlight\.current\) return countRequestFlight\.current;/,
  );
  assert.match(source, /const unreadGeneration = \+\+unreadWriteGeneration\.current;/);
  assert.match(source, /countRequestFlight\.current = flight;/);
  assert.match(
    source,
    /if \(countRequestFlight\.current === flight\) countRequestFlight\.current = null;/,
  );
  assert.match(
    source,
    /mountedRef\.current && requestIsCurrent\(unreadGeneration, unreadWriteGeneration\.current\)/,
  );
  assert.match(
    source,
    /const inboxUnreadGeneration = \+\+unreadWriteGeneration\.current;/,
  );
  assert.match(
    source,
    /requestIsCurrent\(inboxUnreadGeneration, unreadWriteGeneration\.current\)/,
  );
  assert.match(
    source,
    /inboxRequestGeneration\.current \+= 1;\s*unreadWriteGeneration\.current \+= 1;/,
  );
  assert.equal((source.match(/beginNotificationMutation\(\);/g) ?? []).length, 2);
  assert.equal((source.match(/endNotificationMutation\(\);/g) ?? []).length, 2);
});

test('mark all is unavailable without actionable inbox data and is guarded against double submit', () => {
  assert.match(source, /const \[markAllPending, setMarkAllPending\] = useState\(false\);/);
  assert.match(source, /const markAllPendingRef = useRef\(false\);/);
  assert.match(
    source,
    /async function markAll\(\) \{\s*if \(markAllPendingRef\.current\) return;\s*markAllPendingRef\.current = true;\s*setMarkAllPending\(true\);/,
  );
  assert.match(
    source,
    /finally \{[\s\S]*?markAllPendingRef\.current = false;[\s\S]*?setMarkAllPending\(false\);/,
  );
  assert.match(
    source,
    /disabled=\{loading \|\| markAllPending \|\| !inbox \|\| unread === 0\}/,
  );
  assert.match(source, /\{markAllPending \? 'Marking\.\.\.' : 'Mark all read'\}/);
});

test('Radix popover exposes a labelled dialog and moves initial and retry focus to Close', () => {
  assert.match(source, /PopoverTrigger asChild/);
  assert.match(source, /const headingId = useId\(\);/);
  assert.match(source, /const closeButtonRef = useRef<HTMLButtonElement>\(null\);/);
  assert.match(source, /aria-labelledby=\{headingId\}/);
  assert.match(source, /<strong id=\{headingId\}/);
  assert.match(source, /onOpenAutoFocus=\{handleOpenAutoFocus\}/);
  assert.match(
    source,
    /function handleOpenAutoFocus\(event: Event\) \{\s*event\.preventDefault\(\);\s*closeButtonRef\.current\?\.focus\(\{ preventScroll: true \}\);\s*\}/,
  );
  assert.match(
    source,
    /function handleRetry\(\) \{\s*closeButtonRef\.current\?\.focus\(\{ preventScroll: true \}\);\s*void loadInbox\(\);\s*\}/,
  );
  assert.match(source, /ref=\{closeButtonRef\}/);
  assert.match(source, /aria-label="Close notifications"/);
  assert.match(source, /onClick=\{\(\) => setOpen\(false\)\}/);
  assert.doesNotMatch(source, /document\.addEventListener|document\.removeEventListener/);
  assert.match(source, /max-h-\[var\(--radix-popover-content-available-height\)\]/);
});

test('member and admin shells each render exactly one notification bell', () => {
  assert.equal((memberLayout.match(/<NotificationBell\b/g) ?? []).length, 1);
  assert.equal((adminLayout.match(/<NotificationBell\b/g) ?? []).length, 1);
});

test('notification polling cadence and API route contracts remain unchanged', () => {
  assert.equal((source.match(/setInterval\(refreshCount, 45_000\)/g) ?? []).length, 1);
  assert.match(source, /api\.get<\{ count: number \}>\('\/me\/notifications\/unread-count'\)/);
  assert.match(source, /api\.get<Inbox>\('\/me\/notifications\?limit=12'\)/);
  assert.match(source, /api\.post\('\/me\/notifications\/read-all'\)/);
  assert.match(source, /api\.post\(`\/me\/notifications\/\$\{it\.id\}\/read`\)/);
});
