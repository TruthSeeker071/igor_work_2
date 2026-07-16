# UI Audit Baseline — pre-overhaul snapshot (2026-07-16)

Reference point for the UI overhaul (see `UI_OVERHAUL_PLAN.md` in the project root and the
Claude Design wireframes in `FlightWay Wireframes.dc.html`). Captured at commit `fb00b76`.

## Contrast audit (WCAG 2.2 AA, computed)

| Pair | Ratio | Verdict |
|---|---|---|
| LIGHT body text (orange 210 85 40) on bg 252 | **4.04** | **FAIL** normal text (needs 4.5) |
| LIGHT text-muted (120 90 70) on bg | 6.11 | pass |
| LIGHT white on primary (buttons) | 4.14 | AA-large only — 14px button labels technically miss AA |
| Proposed LIGHT text (40 30 25) on bg | 15.87 | pass |
| DARK text (245 238 233) on bg | 16.16 | pass |
| DARK text-muted on bg | 6.19 | pass |
| DARK white on primary | 4.14 | AA-large only |

**Decisions this drives (Phase 1):** light-mode `--text` → warm near-black `40 30 25`; orange
reserved for interactive/brand elements. White-on-primary at 4.14 is kept for now (button labels
are 600-weight; industry-common tradeoff) — flagged, not silently changed; a darker
`--primary-text-safe` token is available if we want strict AA later.

## CSS inventory

| Metric | Value |
|---|---|
| CSS files / total lines | 9 / 8,576 |
| `!important` (theme / total) | 289 / 372 |
| Hardcoded hex in flightway-pages.css | 171 (59 unique) |
| Unique font-size values in pages.css | 66 (scale has 6 steps) |
| Media queries: auth / profile-build / flightway-2 | 0 / 1 / 2 |
| Inter font loads per page | 2 (CSS `@import` + per-page `<link>`, different weight sets) |
| Token generations coexisting | 4 (`--neutral-*` semantic, `--*-solid`, `--q-*`, legacy) |

## Page weights (pre-overhaul)

quiz 155 · portal 121 · career 104 · dashboard 223 · index 219 HTML lines; page CSS loads:
portal carries 4 stylesheets, dashboard 3 (+1,481-line hub CSS).

## Known-good foundations (do not regress)

Dark/light token themes, FOUC-proof theme boot, global `:focus-visible` ring,
`prefers-reduced-motion` in 4/9 files, skeleton shimmer states, `fw-toast.js`, lucide-lite icons.
