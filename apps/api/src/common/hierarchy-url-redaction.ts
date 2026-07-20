/**
 * Hierarchy requests carry opaque node refs, cursors, snapshot timestamps, and focused IDs in
 * their query strings. Keep the path for operational grouping, but never send those values to
 * application logs or exception telemetry.
 */
const ADMIN_NETWORK_PATH = /(?:^|\/)admin\/members\/network-[^/?#]+(?:\/|$)/;
const MEMBER_TREE_PATH = /(?:^|\/)app\/team\/tree(?:\/|$)/;

function pathnameOf(requestUrl: string): string {
  const delimiter = requestUrl.search(/[?#]/);
  return delimiter === -1 ? requestUrl : requestUrl.slice(0, delimiter);
}

export function redactHierarchyRequestUrl(requestUrl: string | undefined): string | undefined {
  if (!requestUrl) return requestUrl;

  const pathname = pathnameOf(requestUrl);
  return ADMIN_NETWORK_PATH.test(pathname) || MEMBER_TREE_PATH.test(pathname) ? pathname : requestUrl;
}
