import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isAnonymousMemberInitials,
  isOpaqueMemberNodeRef,
  parseAnonymousMemberInitials,
  parseOpaqueMemberNodeRef,
  // @ts-expect-error Node's native TypeScript runner requires an explicit extension.
} from './types.ts';

const VALID_REFERENCE = 'Zm9jdXM.MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTIzNDU2Nzg5MDE';

test('opaque references reject raw IDs, names, and emails before they reach anonymous nodes', () => {
  assert.equal(isOpaqueMemberNodeRef(VALID_REFERENCE), true);
  assert.equal(isOpaqueMemberNodeRef('550e8400-e29b-41d4-a716-446655440000'), false);
  assert.equal(isOpaqueMemberNodeRef('Taylor Jordan'), false);
  assert.equal(isOpaqueMemberNodeRef('member@example.com'), false);
  assert.throws(() => parseOpaqueMemberNodeRef('member@example.com'), /invalid opaque member node reference/);
});

test('anonymous initials are exactly two normalized uppercase letters', () => {
  assert.equal(isAnonymousMemberInitials('AB'), true);
  assert.equal(isAnonymousMemberInitials('A'), false);
  assert.equal(isAnonymousMemberInitials('Ab'), false);
  assert.equal(isAnonymousMemberInitials('A1'), false);
  assert.equal(isAnonymousMemberInitials('member@example.com'), false);
  assert.equal(parseAnonymousMemberInitials('AB'), 'AB');
  assert.throws(() => parseAnonymousMemberInitials('AB '), /invalid anonymous member initials/);
});
