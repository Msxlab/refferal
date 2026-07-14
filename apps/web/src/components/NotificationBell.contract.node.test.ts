import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const source = readFileSync(new URL('./NotificationBell.tsx', import.meta.url), 'utf8');

function helperBody(name: string): string {
  const match = source.match(new RegExp(`function ${name}\\([^)]*\\)[^{]*\\{([\\s\\S]*?)\\r?\\n\\}`));
  assert.ok(match, `${name} helper must remain directly testable`);
  return match[1];
}

test('inbox failures distinguish an unavailable first load from stale cached content', () => {
  const message = new Function('hasInbox', helperBody('inboxFailureMessage')) as (hasInbox: boolean) => string;

  assert.equal(message(false), 'Notifications could not be loaded.');
  assert.equal(message(true), 'Notifications could not be refreshed. Showing previously loaded notifications.');
  assert.match(source, /\{inboxError && \(/);
  assert.match(source, /role="alert"/);
  assert.match(source, /'Retry'/);
  assert.match(source, /\{inbox && inbox\.items\.length === 0/);
  assert.match(source, /\{inbox\?\.items\.map/);
});

test('retry moves focus to the persistent close control before its pending state disables the action', () => {
  assert.doesNotMatch(source, /setLoading\(true\);\s*setInboxError\(false\);/);
  assert.equal((source.match(/setInboxError\(false\)/g) ?? []).length, 1);
  assert.match(source, /setUnread\(data\.unreadCount\);\s*setInboxError\(false\);/);
  assert.match(source, /loading && !inbox && !inboxError/);

  const retryBody = helperBody('handleRetry');
  assert.match(
    retryBody,
    /initialFocusRef\.current\?\.focus\(\{ preventScroll: true \}\);\s*void loadInbox\(\);/,
  );
  assert.match(
    source,
    /ref=\{initialFocusRef\}[\s\S]*?aria-label="Close notifications"/,
  );
  assert.match(
    source,
    /onClick=\{handleRetry\}[\s\S]*?disabled=\{loading\}[\s\S]*?>\s*\{loading \? 'Refreshing\.\.\.' : 'Retry'\}\s*<\/Button>/,
  );
});

test('mark all cannot invalidate the first inbox load before notifications exist', () => {
  assert.match(
    source,
    /onClick=\{markAll\}\s+disabled=\{loading \|\| !inbox \|\| unread === 0\}/,
  );
});

test('only the latest mounted inbox load may commit after notification mutations', () => {
  const isCurrent = new Function(
    'requestGeneration',
    'currentGeneration',
    helperBody('inboxRequestIsCurrent'),
  ) as (requestGeneration: number, currentGeneration: number) => boolean;

  assert.equal(isCurrent(3, 3), true);
  assert.equal(isCurrent(2, 3), false);
  assert.match(source, /const inboxRequestGeneration = useRef\(0\);/);
  assert.match(source, /const requestGeneration = \+\+inboxRequestGeneration\.current;/);
  assert.match(
    source,
    /const isCurrent = \(\) => inboxRequestIsCurrent\(requestGeneration, inboxRequestGeneration\.current\);/,
  );
  assert.match(source, /if \(!isCurrent\(\)\) return;/);
  assert.match(source, /if \(isCurrent\(\)\) setInboxError\(true\);/);
  assert.match(source, /if \(isCurrent\(\)\) setLoading\(false\);/);
  assert.match(
    source,
    /useEffect\(\(\) => \(\) => \{\s*inboxRequestGeneration\.current \+= 1;\s*\}, \[\]\);/,
  );
  assert.match(
    source,
    /async function markAll\(\) \{\s*invalidateInboxLoads\(\);[\s\S]*?await api\.post\('\/me\/notifications\/read-all'\)/,
  );
  assert.match(
    source,
    /async function openItem\(it: Item\)[\s\S]*?if \(!it\.read\) \{\s*invalidateInboxLoads\(\);/,
  );
});

test('notification trigger and dialog keep stable labelled relationships', () => {
  assert.match(source, /const triggerId = useId\(\);/);
  assert.match(source, /const dialogId = useId\(\);/);
  assert.match(source, /const titleId = useId\(\);/);
  assert.match(source, /id=\{triggerId\}/);
  assert.match(source, /aria-controls=\{dialogId\}/);
  assert.match(source, /aria-haspopup="dialog"/);
  assert.match(source, /id=\{dialogId\}/);
  assert.match(source, /aria-labelledby=\{titleId\}/);
  assert.match(source, /id=\{titleId\}/);
});

test('notification dialog focuses a control and restores focus only for intentional keyboard or toggle closes', () => {
  const shouldRestore = new Function('reason', helperBody('shouldRestoreTriggerFocus')) as (reason: string) => boolean;

  assert.equal(shouldRestore('escape'), true);
  assert.equal(shouldRestore('toggle'), true);
  assert.equal(shouldRestore('close-button'), true);
  assert.equal(shouldRestore('outside-pointer'), false);
  assert.match(source, /const triggerRef = useRef<HTMLButtonElement>\(null\);/);
  assert.match(source, /const initialFocusRef = useRef<HTMLButtonElement>\(null\);/);
  assert.match(source, /initialFocusRef\.current\?\.focus/);
  assert.match(source, /triggerRef\.current\?\.focus/);
  assert.match(source, /closeInbox\('escape'\)/);
  assert.match(source, /closeInbox\('toggle'\)/);
  assert.match(source, /closeInbox\('outside-pointer'\)/);
  assert.match(source, /document\.addEventListener\('pointerdown', onPointerDown\)/);
});

test('notification polling and API contracts remain unchanged', () => {
  assert.equal((source.match(/setInterval\(refreshCount, 45_000\)/g) ?? []).length, 1);
  for (const path of [
    '/me/notifications/unread-count',
    '/me/notifications?limit=12',
    '/me/notifications/read-all',
  ]) {
    assert.ok(source.includes(path), `${path} must remain unchanged`);
  }
  assert.match(source, /`\/me\/notifications\/\$\{it\.id\}\/read`/);
});
