# Slopgauge site design

The site is a food label for slop. Every section uses the grammar of a Nutrition Facts panel.

## Type
- Libre Franklin, self-hosted (`fonts/`, SIL OFL), weights 400 to 900. No other faces.
- Display and label titles: 900, tight tracking (-0.03em to -0.04em), `text-wrap: balance`.
- Label rows: 800 for names and counts, 400 for sub-rows. Tabular figures everywhere.

## Color
- Page `#eceef1`, label stock `#ffffff`, ink `#111214`, secondary `#4b4e55`.
- One accent: meter red `#d4262e`, used only for slop evidence (highlights, the Pure slop pill).
- Meter pills keep the extension's five levels (gray, amber, orange, red, filled red).
- Dark mode inverts the label: stock `#17181b`, ink `#f1f2f4`, red `#f0545a`.

## Components
- Label: 1px ink border, rules of 10px (sections), 5px (sub-sections) and 1px (rows).
- Section headings are label titles over a 10px rule. No eyebrows, cards or section numbers.
- Buttons are square-cornered, 2px ink border. Pills are the only rounded shapes (they are product UI).
- Evidence marks: red-tinted background with a wavy red underline, as in the extension.

## Motion
- One moment: on load the post's highlights sweep in, in label order, and each count ticks. Off under `prefers-reduced-motion`.
- Hovering a label line lights its phrases in the post, and the reverse.
