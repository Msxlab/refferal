const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const repoRoot = path.resolve(__dirname, '../../../..');
const publicClients = [
  {
    name: 'web',
    source: readFileSync(path.join(repoRoot, 'apps/web/src/app/i/[code]/page.tsx'), 'utf8'),
  },
  {
    name: 'mobile',
    source: readFileSync(path.join(repoRoot, 'apps/mobile/app/i/[code].tsx'), 'utf8'),
  },
];
const webPublicSource = publicClients[0].source;
const editorSource = readFileSync(path.join(repoRoot, 'apps/web/src/app/app/invite/page.tsx'), 'utf8');

test('public invite clients depend only on the tenant-safe display-name contract', () => {
  for (const client of publicClients) {
    assert.doesNotMatch(client.source, /\binviter(?:Name|Message)\b/, `${client.name} must not depend on inviter identity`);
    assert.match(
      client.source,
      /(?:You're invited to join|Join(?: the)?)[\s\S]{0,120}tenant\.displayName/,
      `${client.name} must identify the destination by the tenant display name`,
    );
  }
});

test('public funnel tracking remains wired after the privacy contract change', () => {
  assert.match(webPublicSource, /\/invites\/\$\{encodeURIComponent\(code\)\}\/event/);
  assert.match(webPublicSource, /utmSource/);
});

test('authenticated invite note editor remains available without promising a public preview', () => {
  assert.match(editorSource, /api\.get<\{ message: string \| null \}>\('\/app\/invites\/message'\)/);
  assert.match(editorSource, /api\.post\('\/app\/invites\/message'/);
  assert.doesNotMatch(editorSource, /shown on your invite page/i);
  assert.match(editorSource, /not displayed on the public signup page/i);
});
