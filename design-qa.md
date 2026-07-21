# Design QA — Referral value flow

## Grounding

- Selected direction: option 3, referral value-flow tree.
- Reference: `C:\Users\Mustafa\.codex\visualizations\2026\07\18\019f7630-4ec0-74d2-8ca7-0272d6a80562\reference-desktop-viewport.png`.
- Final implementation: `C:\Users\Mustafa\.codex\visualizations\2026\07\18\019f7630-4ec0-74d2-8ca7-0272d6a80562\referral-value-flow-final.png`.
- Evidence inspector state: `C:\Users\Mustafa\.codex\visualizations\2026\07\18\019f7630-4ec0-74d2-8ca7-0272d6a80562\referral-value-flow-details.png`.
- QA environment: optimized Next.js production build, Codex in-app browser, 1280 × 720 viewport, realistic local API fixture.

## Visual comparison

- Matched the reference's left operations rail, four-metric summary, Network/Table switch, central value-flow graph, liability branch, and contextual evidence inspector.
- Preserved Americana Earn's existing obsidian, cobalt, pearl, type, radius, spacing, and icon system instead of copying the reference brand.
- Removed nested page padding so the tree receives the full content area provided by the existing admin shell.
- The 1280px layout intentionally uses a bottom evidence sheet; a fixed right inspector at this width would leave the graph unreadably narrow beside the existing rail.
- No clipped labels, overlapping controls, broken borders, stretched assets, or visible encoding defects were found in the final screenshots.

## Interaction and accessibility

- Verified Network and Table switching, graph-node selection, bottom-sheet open/close, Summary/Evidence tabs, member selection, search, attention drill-down, URL persistence, and refresh state.
- Verified a graph node is a real native button and opens `selected=source:direct` evidence.
- Verified hierarchy search announces one matching member and selected members open evidence.
- Verified scrolling over the graph moves the document from 0 to 420px; the graph does not trap page scrolling.
- Graph relationships have an accessible list; inspector is a labelled dialog; filter results and refreshes use live status regions.
- Interactive targets are 40–44px minimum, focus-visible styles are present, and reduced-motion rules disable graph and evidence transitions.

## Responsive contracts

- The table becomes the default below 1180px unless Network was explicitly selected.
- The desktop inspector becomes a bottom sheet below 1360px.
- At phone widths, the explicit network view keeps a readable 760px canvas and uses horizontal exploration rather than shrinking labels into illegibility.
- Sticky table identity cells, 44px mobile controls, safe wrapping, and compact metrics are covered by native contract tests. Device-size visual emulation was not claimed because the selected in-app browser viewport is fixed.

## Data and permission truth

- Current-month approved sales/revenue/commission are visually separated from all-time pending, payable, and processing liabilities.
- Source branches connect to tenant totals only when the complete hierarchy reconciles; bounded snapshots show 500/N scope and remain detached otherwise.
- A health-signal/tree mismatch no longer claims every member sold; it reports the known tenant signal and asks for source reconciliation.
- Processing commissions remain present in totals, member evidence, statements, rank calculations, and payout transitions.
- Sales bulk uses preview token plus Idempotency-Key; unsupported bulk actions were removed.
- Member, sales, payout, compliance, report, fraud, KYC, and check controls mirror both coarse role tiers and fine-grained API permissions.

## Verification evidence

- Web native suite: 296/296 passed.
- API unit suite: 22 suites, 97/97 passed.
- Web and API TypeScript checks passed.
- Prisma schema validation passed.
- Optimized Next.js production build passed for all 30 generated pages.
- `git diff --check` and repository conflict-marker scan passed.

final result: passed
