# Design QA — Issues Management

## Source visual truth

- Selected login design: `/Users/xuanmu/.codex/generated_images/019fbdc4-9644-73e0-9784-f47289142816/exec-e86b6696-b41c-48a2-92da-b38c51980654.png`
- Source pixels: 1488 × 1024.
- Intended state: signed out, Google OAuth configured, desktop light theme.
- Implementation: `http://127.0.0.1:4176/login.html`.
- Browser-rendered evidence: Codex in-app Browser desktop capture, tab 4, 1280 × 720 CSS viewport at device scale 1. The viewport is shorter than the source; comparison used the shared above-the-fold region and focused controls rather than treating the lower crop as a defect.

## Full-view comparison evidence

- Composition: the implementation preserves the source's 46/54 split, thin header, left authentication hierarchy, three-step flow, and right-side question-to-report preview.
- Typography: SF Pro / PingFang system stack, display headline weight, compact enterprise body scale, and muted secondary text match the selected direction.
- Spacing and rhythm: major gutters, horizontal divider, sign-in control height, and preview-card spacing follow the source. The implementation also collapses cleanly below 1100 px and hides the nonessential preview below 720 px.
- Colors and tokens: white canvas, near-black text, cool gray rules, restrained `#087bfa` blue, and semantic green are consistent with the source.
- Image quality and assets: the Google mark uses a real raster asset rather than a CSS or text approximation; product preview icons use the installed Material Symbols family.
- Copy: login, access request, authorization steps, and workflow preview match the approved Chinese content and business purpose.

## Focused region comparison evidence

- Google button: real Google mark, 2 px blue outline, centered 17 px label, 72 px control height, and calm hover/focus treatment.
- Workflow board: three distinct stages remain readable at the desktop breakpoint; selected question has a restrained blue inset indicator and the saved answer has a semantic green state.
- Administrator page: `http://127.0.0.1:4174/admin.html` was captured in the in-app Browser at 1280 × 720. Summary counts, status tabs, search, role selection, and approval actions follow the same visual tokens.

## Comparison history

1. Initial browser capture found two P2 issues: the remote Google logo did not render, and the third workflow card clipped at the 1280 px verification viewport.
2. Fixes: replaced the remote dependency with an embedded official Google raster asset; reduced the workflow grid minimum tracks and side padding.
3. Post-fix capture confirmed the Google logo is visible and all three workflow stages fit without horizontal clipping.

## Functional verification

- Signed-out `/` and `/index.html`: redirect to `/login.html` for GET and HEAD.
- Signed-out data API: returns HTTP 401.
- Local administrator session: can open the workbench and `/admin.html`.
- Access request lifecycle: pending → approved editor → rejected passed through the real HTTP APIs.
- Admin list and counts: passed.
- `npm run check`: passed.
- `git diff --check`: passed.
- No visible browser rendering errors in the inspected login and admin states.

## Findings

- No actionable P0, P1, or P2 visual differences remain.
- P3: the exact source was 1488 × 1024 while the in-app desktop capture surface was 1280 × 720; the implementation intentionally preserves responsive behavior rather than forcing source-sized content into the shorter viewport.

final result: passed
