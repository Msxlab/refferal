import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

test('invite registration keeps an MFA challenge out of session storage and submits the displayed consent', () => {
  const source = readFileSync(join(__dirname, 'page.tsx'), 'utf8');

  assert.match(source, /api\.post<Session \| MfaChallenge>\(\s*'\/auth\/register-by-invite'/);
  assert.match(
    source,
    /acceptDisclaimer: true,[\s\S]*?disclaimerVersion: registrationInvite\.disclaimer\.version,[\s\S]*?disclaimerLocale: registrationInvite\.disclaimer\.locale/,
  );
  assert.match(source, /if \(isMfaChallenge\(result\)\) \{[\s\S]*?setMfaChallenge\(result\);[\s\S]*?return;/);
  assert.match(source, /await loginMfa\(mfaChallenge\.challengeToken, mfaCode\.trim\(\)\)/);
  assert.doesNotMatch(source, /api\.post<Session>\('\/auth\/register-by-invite'/);
});
