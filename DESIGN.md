# Slopgauge site design

A lab for measuring slop. The site's one object is the gauge: a graduated measuring cylinder. When
the detector finds a tell, its letters fly out of the text and drop into the cylinder, and the
liquid rises to the measured level. Everything else on the page is lab equipment around it: slips,
labels, specimen paragraphs, tally sheets.

## The gauge (`js/gauge.js`)
- Canvas, no dependencies. A spring-row liquid surface with a meniscus, splashes where letters land,
  a few bubbles, graduations on the glass and a red pointer at the level.
- Letters fly on one fixed canvas over the page, on a lob that peaks just above the higher of the
  two ends, then fall inside the glass to the surface.
- Home: five bands, one per meter level (No slop to Pure slop), set from the style model's logit and
  the meter thresholds in `js/model.js`. Checker: 0 to 100%, the share of AI-like text.
- Drained tells stay in the text, faded, with their red underline. The checker never fades text:
  it pours copies.
- Reduced motion: no flying letters; the level is set.

## Type
- Funnel Display (OFL) for headlines, 700, tight tracking. Its "b" has an open notch at large sizes,
  so long lists of names are set in Funnel Sans instead.
- Funnel Sans (OFL) for text and interface.
- Martian Mono (OFL), narrowed to 87.5%, for labels, glass printing and data: small caps-like
  uppercase with a little tracking.

## Color
- Paper `#ebebe4`, cards `#f8f8f3`, ink `#121310`, rules `#cfd1c6`.
- Slop `#b8c23b` (with a deeper `#8a9425` and a foam `#d4dc6c`): the liquid, the caught dots, the
  "reads as AI" wash.
- Red `#d8301f` for tells (wavy underline), the gauge pointer and the one wrongly flagged dot.
- Meter pills keep the extension's five levels (gray, amber, orange, red, filled red).
- Light only, whatever the device's setting: the gauge reads best on paper.

## Layout
- Cards have a 1px rule and 6px corners, no shadows. Buttons are near-square (3px), ink or outlined;
  red is their hover.
- Sections: a mono label, a headline, a lede on the right; then one object that only Slopgauge
  could show: the bench, a feed scored on the page, a paragraph of slop with numbered tells, dot
  charts of the test results, a lab slip.
- Everything the page claims about a text is computed on the page by the extension's own code.

## Caching
GitHub Pages caches files for 10 minutes. Bump the `?v=` on CSS and JS links when they change.
