# PayStar Market UI kit (plain HTML/CSS)

Open `index.html` in a browser: every component from the request is on that one page, in Persian, RTL.
No build step, no CDN, no network calls, so it works offline.

| File | What it is |
|---|---|
| `paystar-ui.css` | All tokens and components. Classes are prefixed `ps-`. Link this one file. |
| `index.html` | The showcase. Copy markup from it. The `<style>` and `<script>` in it are for the demo only (swatches, theme and direction toggles). |
| `fonts/` | IRANYekanX woff2: 400, 600, 700. `IRANYekanXFaNum-*` uses Persian digits (body text). `IRANYekanX-*` uses Latin digits (IDs, card numbers, amounts in LTR fields). |

## Source
The values are PayStar DS (Figma «Paystar Market» › Foundations), the same ones the production web panel uses (`frontend-panel/app/assets/css/main.css`). The panel itself is Nuxt + Tailwind + daisyUI; this kit is a framework-free translation of it.

## Tokens (CSS custom properties on `:root`)
- **Colour:** `--ps-primary`, `--ps-bg` (page), `--ps-surface` (card), `--ps-border`, `--ps-text`, `--ps-text-muted`, `--ps-text-subtle`.
- **Status pairs:** `--ps-{success|error|warning|info}-bg` + `--ps-{…}-text`, plus the solid `--ps-{…}`.
- **Type:** 24 page title (700), 20 section title (600), 16, 14 body, 12 small, 10 xs. `.ps-id` / `--ps-font-mono` for IDs: the DS has no monospace font, so it uses the system's monospace (always available offline).
- **Spacing:** 4px scale, `--ps-1` … `--ps-10`.
- **Radius:** 4 (checkbox), 8 (badge, chip), 15 (field, button), 20 (card, alert).
- **Shadows:** `--ps-shadow-subtle | raised | overlay`. Cards are flat (border, no shadow) by default.
- **Focus ring:** 2px solid primary, 2px offset, on `:focus-visible`. Inputs use a primary border with a 3px soft ring instead.

## Dark mode
Built in. It follows the OS (`prefers-color-scheme`). To force a theme, set `<html data-theme="dark">` or `data-theme="light"`.

## RTL support
**RTL-first, and LTR works too.** Every rule uses logical properties (`margin-inline-start`, `inset-inline-end`, `text-align: start`, …), so the same CSS works with `dir="rtl"` and `dir="ltr"`. Nothing needs mirroring. Notes:
- Number and ID fields: add `.ps-input--ltr` (LTR text, Latin digits, still right-aligned in an RTL page). Inline values: `.ps-id` or `.ps-ltr`.
- Directional icons (arrows) get `.ps-icon-dir` and flip in RTL. The back link points → in RTL and ← in LTR.
- The select's chevron sits on the left in RTL and on the right in LTR.

## Component map (request number → class)
1 `.ps-topbar` · 2 `.ps-notice` · 3 `.ps-sidebar`, `.ps-nav__link[aria-current=page]` (below 768px it becomes a horizontal scrolling menu) · 4 `.ps-breadcrumbs`, `.ps-page-title` · 5 `.ps-back` · 6 `.ps-card` · 7 `.ps-stat` in `.ps-grid` · 8 `.ps-tile` + `.ps-count` · 9 `.ps-table-wrap` > `.ps-table`, `.ps-num`, `.ps-table__empty` · 10 `.ps-badge--{success|error|warning|info}` (no modifier = neutral) · 11 `.ps-stepper` · 12 `.ps-checklist` (`is-done|is-pending|is-failed|is-todo`) · 13 `.ps-avatar` · 14 `<details class="ps-accordion">` · 15 `.ps-document` + `.ps-document__watermark` · 16 `.ps-product` · 17 `.ps-input`, `.ps-input--ltr` · 18 `.ps-select` · 19 `.ps-textarea` · 20 `.ps-check` · 21 `.ps-fieldset` · 22 `.ps-file` · 23 `.ps-field`, `.ps-label`, `.ps-help`, `.ps-error-text`, `aria-invalid="true"` · 24 `.ps-btn`, `--secondary`, `--danger`, `--add`, `:disabled`, `aria-busy="true"` (spinner) · 25 `.ps-inline-form` · 26 `.ps-confirm` + `.ps-kv` · 27 `.ps-alert--{success|error|warning}` (no modifier = info) · 28 `.ps-empty` · 29 `.ps-roles` > `.ps-role` > `.ps-role__user[aria-pressed]`

## Differences from the Figma DS
- **Status text colours are darker than the DS swatches in light mode.** Error (`#fe4657`) and warning (`#ffba00`) are too light to read as text on a tinted background (they fail WCAG AA), so the text tokens use darker shades (`#c4162a` and `#7a5300`). The solid colours are unchanged.
- The icons in `index.html` are simple inline SVGs for the demo, not the DS icon set.
