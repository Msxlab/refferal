import { redactHierarchyRequestUrl } from './hierarchy-url-redaction';

describe('hierarchy request URL redaction', () => {
  it.each([
    ['/v1/admin/members/network-context?scope=focused&focusId=11111111-1111-4111-8111-111111111111', '/v1/admin/members/network-context'],
    ['/v1/admin/members/network-children?parentRef=signed-parent&cursor=signed-cursor&snapshotAt=2026-07-20T00%3A00%3A00.000Z', '/v1/admin/members/network-children'],
    ['/v1/admin/members/network-health?memberId=private', '/v1/admin/members/network-health'],
    ['/v1/app/team/tree?root=forbidden', '/v1/app/team/tree'],
    ['/v1/app/team/tree/children?parentRef=signed-member&cursor=signed-cursor', '/v1/app/team/tree/children'],
    ['/v1/app/team/tree/direct-search?query=private', '/v1/app/team/tree/direct-search'],
  ])('keeps only the safe pathname for hierarchy URL %s', (requestUrl, expected) => {
    expect(redactHierarchyRequestUrl(requestUrl)).toBe(expected);
  });

  it.each([
    '/v1/admin/members/tree?root=legacy-root',
    '/v1/app/team/recruits?campaign=summer',
    '/v1/sales?page=2',
    'https://example.test/v1/app/team?cursor=opaque',
  ])('preserves non-hierarchy URL %s unchanged', (requestUrl) => {
    expect(redactHierarchyRequestUrl(requestUrl)).toBe(requestUrl);
  });

  it('preserves an absent URL', () => {
    expect(redactHierarchyRequestUrl(undefined)).toBeUndefined();
  });
});
