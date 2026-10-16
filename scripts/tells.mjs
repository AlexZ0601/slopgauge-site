// Builds the field guide (tells.html) from the detector's own rules: each tell's name, why it reads as
// generated, an example, and what to write instead. Each example is run through js/detector.js, and
// the build fails if the detector doesn't flag it, so the page never shows a tell the detector
// doesn't actually catch. Run: node scripts/tells.mjs
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ctx = vm.createContext({});
ctx.globalThis = ctx;
vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/detector.js'), 'utf8'), ctx);
const D = ctx.Slopgauge;
const { groups, examples } = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/tells-examples.json'), 'utf8'));
const OPTIONS = { 'markdown-leak': { markdown: true } };
const FIX = {
  'banned-word': 'Use the plain word (“use”, “look at”, “show”), or say the specific thing.',
  'em-dash': 'Use a comma, a period or parentheses. One dash in a piece is fine; a dash in every sentence is a habit.',
  'emoji-bullets': 'Write the points as sentences, or use plain bullets.',
};
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const byId = Object.fromEntries(D.RULES.map((r) => [r.id, r]));

let n = 0;
const out = [];
for (const [title, ids] of groups) {
  out.push(`<section class="guide-group" aria-labelledby="g-${n}"><h2 id="g-${n}" class="reveal">${esc(title)}</h2><div class="guide-grid">`);
  for (const id of ids) {
    const rule = byId[id];
    const text = examples[id];
    const found = D.detect(text, OPTIONS[id] || {}).filter((f) => f.label === rule.label && f.severity === 'slop');
    if (!found.length) throw new Error(`The detector doesn't flag the example for ${id}: ${text}`);
    // Mark this tell's spans, merged where they overlap.
    const spans = found.map((f) => [f.start, f.end]).sort((a, b) => a[0] - b[0]);
    const merged = [];
    for (const s of spans) {
      const lastSpan = merged[merged.length - 1];
      if (lastSpan && s[0] <= lastSpan[1]) lastSpan[1] = Math.max(lastSpan[1], s[1]);
      else merged.push([...s]);
    }
    let html = '';
    let at = 0;
    for (const [a, b] of merged) {
      html += esc(text.slice(at, a)) + `<span class="tell">${esc(text.slice(a, b))}</span>`;
      at = b;
    }
    html += esc(text.slice(at));
    const why = found[0].why;
    const fix = FIX[id] || rule.fix;
    n++;
    out.push(`<article class="guide-card reveal" id="${id}">
          <span class="num">${String(n).padStart(2, '0')}</span>
          <h3>${esc(rule.label)}</h3>
          <p class="why">${esc(why)}</p>
          <p class="ex">${html.replace(/\n/g, '<br>')}</p>
          <p class="fix"><b>Instead:</b> ${esc(fix)}</p>
        </article>`);
  }
  out.push('</div></section>');
}
const page = path.join(ROOT, 'tells.html');
const src = fs.readFileSync(page, 'utf8');
const body = src.replace(/<!-- tells:start -->[\s\S]*<!-- tells:end -->/, `<!-- tells:start -->\n      ${out.join('\n      ')}\n      <!-- tells:end -->`).replace(/\b\d+ (signs|tells) of AI writing\b/g, `${n} $1 of AI writing`);
fs.writeFileSync(page, body);
console.log(`wrote ${n} tells`);
