# Design QA — Coordinated Light and Dark Themes

## Comparison target

- Source visual truth: `/var/folders/sv/gnv4f34n27sg8k8kq7g_t3dh0000gn/T/codex-clipboard-6801497f-5bbf-4c38-b0e7-303dedb8ebe2.png`
- Light implementation: `qa/implementation-theme-light.png`
- Dark implementation: `qa/implementation-theme-dark.png`
- Combined comparison: `qa/reference-light-dark-comparison.png`
- Browser viewport: 1280 × 720 CSS pixels, device density 1.
- Source pixels: 3804 × 1880. The red-framed application region was cropped, scaled proportionally and padded to 1280 × 720 for comparison.
- Implementation pixels: 1280 × 720 for both themes.
- State: latest local Review, first issue active, all categories selected.

## Findings

- No actionable P0, P1 or P2 differences remain for the requested typography, two-theme and background-removal changes.
- The surrounding Workspace application is contextual reference rather than code owned by this project, so the comparison focuses on typography scale, density and the red-framed application region.

## Required fidelity surfaces

- Fonts and typography: passed. The interface uses the macOS system stack with SF Pro Text / SF Pro Display and PingFang SC fallbacks. Body and interactive copy render at 14px / 20–21px, supporting text at 12–13px, and primary headings at 16px / 22–23px. This matches the surrounding Workspace density more closely than the previous 13px system.
- Spacing and layout rhythm: passed. The issue rail is 300px at the 1280px target viewport, matching the source region proportion more closely and leaving the library/editor as the dominant workspace.
- Colors and visual tokens: passed. Light page background computes to `rgb(255, 255, 255)` (`#ffffff`). Dark page background computes to `rgb(26, 26, 26)` (`#1a1a1a`). Borders, panels, inputs, hover and selected states all map through shared theme tokens.
- Image quality and asset fidelity: passed. The source contains no required raster product assets inside the application region; Material Symbols remain the matching icon library.
- Copy and content: passed. Existing issue/question copy is unchanged. The new theme control is icon-only with theme-specific accessible labels.
- Accessibility: passed for desktop scope. The theme toggle has a semantic button, title and changing accessible label. Native focus states remain visible, contrast is maintained in both themes, and theme choice persists after reload.

## Interaction verification

- Light theme loads with a pure white application background.
- Theme control switches to the dark theme with `#1a1a1a` as the main background.
- Theme choice persists through page reload.
- Dark theme switches back to light without changing content, layout or selected issue.
- No Canvas elements remain in the DOM.
- No GSAP or kinetic-grid references remain in HTML, CSS, JavaScript, server code or dependencies.
- Existing queue, question filters and answer editor still render correctly.
- Browser console errors: none.
- `npm run check`: passed.
- `git diff --check`: passed.

## Focused comparison

- Typography was checked in the queue title, queue card metadata/title, category headers, question rows, editor heading, helper copy, textarea and action labels.
- Theme color was checked through browser-computed styles rather than screenshot sampling alone.

## Comparison history

### Pass 1

- [P2] The 360px issue rail occupied too much of the 1280px viewport compared with the red-framed source region.

Fix:

- Reduced the desktop rail to 300px and the narrower breakpoint rail to 280px.

### Pass 2

- The queue/library/editor proportions align with the source region.
- Both themes preserve the same geometry and information hierarchy.
- No actionable P0, P1 or P2 findings remain.

final result: passed
