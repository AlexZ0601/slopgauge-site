# Slopgauge site design

The site's one object is the gauge: a graduated measuring cylinder. When the detector finds a tell,
its letters fly out of the text and drop into the cylinder, and the liquid rises to the measured
level. Around it, the pages follow Apple's interface principles as translated for the web in
[emilkowalski/skills: apple-design](https://github.com/emilkowalski/skills/tree/main/skills/apple-design):
respond at once, move on springs that can be interrupted, use materials for floating chrome, and set
type whose tracking and leading change with size.

## The gauge (`js/gauge.js`)
- Canvas, no dependencies. A spring-row liquid surface with a meniscus, splashes where letters land,
  a few bubbles, graduations on the glass and a red pointer at the level.
- The level moves on a spring described by damping and response (critically damped, 0.6 s, by
  default). It always starts from the level as drawn, so a moving level can be grabbed.
- `hold(f)` draws the level exactly at `f` while it's dragged; `release(target, velocity)` springs to
  the target at the pointer's own speed, with a little bounce (damping 0.8) only after a flick.
- Letters fly on one fixed canvas over the page, on a lob that peaks just above the higher of the
  two ends, then fall inside the glass to the surface.
- Home: five bands, one per meter level (No slop to Pure slop), set from the style model's logit and
  the meter thresholds in `js/model.js`. Checker: 0 to 100%, the share of AI-like text.
- Reduced motion: no flying letters; the level is set.

## Drag the gauge (`js/levels.js`)
- Five posts, one per level, each measured on the page. Dragging follows the pointer 1:1 from where
  it was grabbed (after 4 px of hysteresis), rubber-bands past empty and full, and switches the post
  as the level crosses a band, during the drag.
- On release, the resting point is projected from the release velocity (Apple's decay projection,
  rate 0.99), the nearest post wins, and the spring takes over at that velocity.
- A tap picks the band under the finger or the label tapped. It's a slider for assistive tech and
  the keyboard (arrows, Page Up/Down, Home, End).

## Type
- The platform's system font: SF Pro on Apple devices, Segoe UI on Windows, Roboto on Android. No
  web fonts to download.
- Tracking tightens as size grows: -0.032em for the 80 px headline, -0.026em for section heads,
  -0.016em around 24 px, near 0 for body. Leading loosens as size shrinks: 1.04 for the headline,
  1.5 for body.
- Hierarchy comes from weight, size and leading together. Sizes are in rem, so the page grows with
  the reader's text size.
- Eyebrows are short semibold lines in the deep slop green above each heading.

## Color
- White and `#f5f5f7` bands alternate; sections are separated by a change of surface, not a rule.
  One black band for privacy.
- Ink `#1d1d1f`, secondary `#424245`, tertiary `#6e6e73` (the lightest used for text that matters),
  links `#0066cc`.
- Slop `#b8c23b` (deep `#8a9425`, foam `#d4dc6c`, text `#5c6510`): the liquid, the caught dots, the
  "reads as AI" wash.
- Red `#d8301f` for tells (wavy underline), the gauge pointer and the one wrongly flagged dot.
- Meter pills keep the extension's five levels (gray, amber, orange, red, filled red).
- Light only, whatever the device's setting: the gauge reads best on paper.

## Materials and motion
- The navigation bar is a translucent layer (blur and saturation) that the page scrolls under. A
  soft edge appears below it once content is underneath, instead of a permanent rule. The checker's
  toolbar is the same material, stuck to the bottom of the editor.
- On phones the menu is a sheet that grows from the menu button and returns into it.
- A tell's explanation is a small glass card that grows out of the mark it explains (its
  transform-origin is the mark), on hover after a 70 ms beat, then at once from mark to mark; tap
  pins it.
- Buttons are pills that scale to 0.97 on press, not on release. Cards have 18 px corners and soft
  shadows on white, none on gray.
- Sections rise 24 px into place once, as they scroll in. Easing is a fast-out, no-overshoot curve.
- Reduced motion: cross-fades instead of movement. Reduced transparency: solid bars. More contrast:
  darker secondary text and outlined cards.

## Layout
- Sections: an eyebrow, a headline and a lede, then one object that only Slopgauge could show: the
  bench, a feed scored on the page, the gauge to drag, a paragraph of slop with numbered tells, dot
  charts of the test results, a report card.
- Everything the page claims about a text is computed on the page by the extension's own code.
- The About section says who makes Slopgauge and credits the research it is built on. Keep every
  claim there literally true.

## Caching
GitHub Pages caches files for 10 minutes. Bump the `?v=` on CSS and JS links when they change.

## The checker's evidence
- Kind of text (`js/odds.js`, `scripts/odds/calibrate.js`): thresholds per kind, each set so about 1
  in 100 human texts of that kind is called "Likely AI-written", and the "How unusual is this score?"
  odds. School essays (grades 6 to 12) are the default; they were tested on PERSUADE 2.0 (used only
  for testing and thresholds) and AI essays on the same prompts (DAIGT).
- Their own writing (`src/voice-runtime.js` → `js/vendor/`, `models/voice/`, `js/voice-cal.js`):
  LUAR style vectors in the browser; a part is marked (dashed blue) only where a writer's own text
  lands under 2 times in 100.
- Check a class (`class.html`, `js/class.js`): ranking, plus groups of essays that read as AI and
  share unusual wording (`scripts/class/simulate.js`). The ranking downloads as a CSV; cells that a
  spreadsheet would run as formulas are quoted.
- Reports print cleanly (`@media print`): the marked text, the gauge and the tally, with a line
  saying when and as what kind of text it was checked.
- Rebuild the vendored runtimes with `npm install && npm run build:voice`.

## Pages and the scripts that keep them in step
- `index.html` home, `check.html` essay checker, `class.html` check a class, `teachers.html` for
  teachers, `pricing.html` plans and Pro activation, `tells.html` the field guide, `flagged.html`
  for writers wrongly flagged, `press.html` press kit, `privacy.html` the policy (kept plain, with a
  minimal header, for the Chrome Web Store), `404.html`.
- `node scripts/layout.mjs` writes the shared navigation bar and footer into the pages and tags
  Chrome Web Store links with UTM parameters (the store dashboard reports listing views by
  campaign; the site runs no analytics). Run it after changing either.
- `node scripts/tells.mjs` rebuilds the field guide from `js/detector.js` and
  `scripts/tells-examples.json`, and fails if the detector doesn't flag an example.

## Pro (`js/pro-config.js`, `js/pro.js`, `js/history.js`)
- Polar (polar.sh) is the merchant of record. `js/pro-config.js` holds its public organization ID
  and checkout links; while they're empty, buy buttons fall back to email.
- A license key is checked against Polar's public validation endpoint (no secret needed), at most
  once a day, with two weeks' grace offline. Only the key is sent.
- Saved classes live in IndexedDB on the teacher's computer. Each new essay is compared with the
  student's earlier essays in that class that read as human-written (the latest six), using the
  same LUAR model and thresholds as the checker's "Compare with their own writing".
- Everything free stays free; Pro only adds.
