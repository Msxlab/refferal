import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

test('mobile invite registration submits the server-issued consent before requesting an MFA challenge', () => {
  const source = readFileSync(new URL('../app/i/[code].tsx', import.meta.url), 'utf8');

  assert.match(
    source,
    /acceptDisclaimer: true,[\s\S]*?disclaimerVersion: registrationInvite\.disclaimer\.version,[\s\S]*?disclaimerLocale: registrationInvite\.disclaimer\.locale/,
  );
  assert.match(source, /disabled=\{challengeExpired \|\| \(!challengeToken && !acceptDisclaimer\)\}/);
  assert.match(source, /setChallengeToken\(session\.challengeToken\)/);
});
