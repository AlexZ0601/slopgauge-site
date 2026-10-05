# Slopgauge site design

An editor's red pen. The site looks like paper on a desk, and Slopgauge is the editor who marks it up:
wavy red underlines under the tells, notes in the margin, a grade circled at the top.

## Type
- Fraunces (variable, SIL OFL) for headlines, page text and figures. Headlines 540, with an italic
  phrase in red. Running text sets `"WONK" 0` so letters stand straight; big figures pin `opsz` 56.
- Libre Franklin (SIL OFL) for interface text: nav, buttons, labels, tables. Margin notes are its
  650 weight in small red capitals.
- Both are self-hosted in `fonts/`. Tabular figures everywhere.

## Color
- Desk `#f3efe7`, sheet `#fffdf8`, ink `#1b1915`, secondary `#5f594f`, faint `#8a8377`, rules `#e4dccd`.
- One accent: red pen `#c9222c`, used only for marks, notes, figures that matter and italic headline
  phrases. Amber marks "possibly AI-written" in the checker.
- Meter pills keep the extension's five levels (gray, amber, orange, red, filled red).
- Dark mode is a dim desk (`#12110f`) with a dark sheet (`#1c1b18`) and a lighter red (`#ff6a5f`).

## Components
- Sheet: the one surface. 4px corners and a soft shadow; the homepage's specimen and screenshot sit
  slightly rotated, like paper on a desk.
- Marks: a wavy red underline (an SVG wave, so it can be drawn on) for named patterns; red and amber
  washes for sentences that read as AI-written or possibly so.
- Margin notes: red capitals beside the line, with a red rule on their left.
- Ring: a hand-drawn red loop around the one thing to look at (the headline's "AI slop", the checker's
  percentage).
- Buttons are pills: ink-filled, or outlined ("ghost"). Red is their hover state.
- Sections are separated by a single hairline rule, with a headline on the left and a lede on the right.

## Motion
- Home: the ring draws itself, then the specimen's underlines are inked in one by one, each margin note
  following its mark, and the meter lands last.
- Checker: the percentage's ring draws itself; hovering a note or a pattern lights its marks, and
  clicking a pattern scrolls to it.
- All of it is off under `prefers-reduced-motion`.

## Caching
GitHub Pages caches files for 10 minutes. Bump the `?v=` on CSS and JS links when they change.
