import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

test('mobile invite registration submits the server-issued consent before requesting an MFA challenge', () => {
  const source = readFileSync(join(__dirname, '..', 'app', 'i', '[code].tsx'), 'utf8');

  assert.match(
    source,
    /acceptDisclaimer: true,[\s\S]*?disclaimerVersion: registrationInvite\.disclaimer\.version,[\s\S]*?disclaimerLocale: registrationInvite\.disclaimer\.locale/,
  );
  assert.match(source, /disabled=\{challengeExpired \|\| \(!challengeToken && !acceptDisclaimer\)\}/);
  assert.match(source, /setChallengeToken\(session\.challengeToken\)/);
});
