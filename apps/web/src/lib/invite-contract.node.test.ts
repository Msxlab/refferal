import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const clients = [
  {
    name: 'web',
    source: readFileSync(path.join(repoRoot, 'apps/web/src/app/i/[code]/page.tsx'), 'utf8'),
  },
  {
    name: 'mobile',
    source: readFileSync(path.join(repoRoot, 'apps/mobile/app/i/[code].tsx'), 'utf8'),
  },
];

test('public invite clients use only the privacy-safe tenant contract', () => {
  for (const client of clients) {
    assert.doesNotMatch(client.source, /\binviterName\b/, `${client.name} must not depend on inviterName`);
    assert.doesNotMatch(client.source, /undefined invited/, `${client.name} must not render an undefined inviter`);
    assert.match(
      client.source,
      /You're invited to join \$\{invite\.tenantName\}/,
      `${client.name} must title the invitation with tenantName`,
    );
  }
});
