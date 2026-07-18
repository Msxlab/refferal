import assert from 'node:assert/strict';
import { test } from 'node:test';
import { accessChangeConfirmation, tenantStatusConfirmation } from './privileged-actions';

test('warns before elevating a teammate to an administrative tier', () => {
  const confirmation = accessChangeConfirmation({
    fullName: 'Jordan Lee',
    currentTier: 'tenant_staff',
    nextTier: 'tenant_admin',
  });

  assert.equal(confirmation.title, 'Confirm access change');
  assert.match(confirmation.message, /Jordan Lee/);
  assert.match(confirmation.message, /administrator/i);
  assert.match(confirmation.message, /takes effect immediately/i);
  assert.equal(confirmation.danger, true);
});

test('warns before reducing a teammate to member access', () => {
  const confirmation = accessChangeConfirmation({
    fullName: 'Jordan Lee',
    currentTier: 'tenant_admin',
    nextTier: 'member',
  });

  assert.match(confirmation.message, /remove their administrative access/i);
  assert.match(confirmation.confirmLabel, /change access/i);
});

test('explains the session impact before suspending a company', () => {
  const confirmation = tenantStatusConfirmation({
    companyName: 'Northstar Co',
    currentStatus: 'active',
  });

  assert.equal(confirmation.title, 'Suspend company');
  assert.match(confirmation.message, /Northstar Co/);
  assert.match(confirmation.message, /sign-ins/i);
  assert.match(confirmation.message, /session/i);
  assert.equal(confirmation.danger, true);
});

test('keeps reactivation explicit without presenting it as a destructive action', () => {
  const confirmation = tenantStatusConfirmation({
    companyName: 'Northstar Co',
    currentStatus: 'suspended',
  });

  assert.equal(confirmation.title, 'Reactivate company');
  assert.equal(confirmation.danger, false);
  assert.match(confirmation.message, /does not restore/i);
});
