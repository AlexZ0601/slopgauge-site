// Simulates classes to set the grouping thresholds in js/class.js: 25 essays by students on one
// prompt (PERSUADE 2.0, CC BY-NC-SA 4.0, used only for testing), half the classes with 3 AI essays on
// the same prompt added (DAIGT, Apache-2.0). Only essays that read as AI can be grouped.
//   node scripts/class/simulate.js classes.json [floor]
// classes.json: { human: [{prompt, text}], ai: [{prompt, text}] }. With floor 0.08: 0.16% of
// student essays wrongly grouped; 23% of the added AI essays grouped (they come from many different
// chatbots and people, so same-chatbot copies would group more).
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const fs = require('fs');
const C = require(path.join(ROOT, 'js', 'class.js'));
const SITE = path.join(ROOT, 'js') + '/';
require(SITE + 'model.js'); globalThis.SlopgaugeStyle = require(SITE + 'style.js'); globalThis.Slopgauge = require(SITE + 'detector.js'); globalThis.SlopgaugeOdds = require(SITE + 'odds.js');
const R = require(SITE + 'report.js');
const d = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
let seed = 3; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const sample = (a, k) => { const c = [...a]; for (let i = c.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [c[i], c[j]] = [c[j], c[i]]; } return c.slice(0, k); };
const byP = (arr) => arr.reduce((m, r) => ((m[r.prompt] ||= []).push(r.text), m), {});
const H = byP(d.human), A = byP(d.ai);
const prompts = Object.keys(A).filter((p) => (A[p] || []).length >= 6 && H[p]);
const floor = Number(process.argv[3] || 0.08);
let humans = 0, humansFlagged = 0, classesWithFalse = 0, aiTotal = 0, aiFlagged = 0, cleanClasses = 0;
for (let c = 0; c < 200; c++) {
  const p = prompts[c % prompts.length];
  const inject = c % 2 === 1;
  const texts = [...sample(H[p], 25).map((t) => ({ t, ai: false })), ...(inject ? sample(A[p], 3).map((t) => ({ t, ai: true })) : [])];
  const eligible = texts.map((x) => R.analyze(x.t, 'school').verdict !== 'human');
  const res = C.overlaps(texts.map((x) => x.t), { floor, eligible: process.argv[5] === 'all' ? undefined : eligible });
  const grouped = new Set(res.groups.flat());
  const hf = texts.filter((x, i) => !x.ai && grouped.has(i)).length;
  humans += 25; humansFlagged += hf;
  if (!inject) { cleanClasses++; if (hf) classesWithFalse++; }
  if (inject) { aiTotal += 3; aiFlagged += texts.filter((x, i) => x.ai && grouped.has(i)).length; }
}
console.log(`floor ${floor}: human essays wrongly grouped ${(100 * humansFlagged / humans).toFixed(2)}%; classes with any false group ${classesWithFalse}/${cleanClasses}; injected AI essays grouped ${(100 * aiFlagged / aiTotal).toFixed(1)}%`);
if (process.argv[4] === 'verdict') {
  const hs = sample(d.human, 1500); let likely = 0, mixed = 0;
  for (const r of hs) { const a = R.analyze(r.text); if (a.verdict === 'ai') likely++; else if (a.verdict === 'mixed') mixed++; }
  const as = sample(d.ai, 800); let caught = 0;
  for (const r of as) if (R.analyze(r.text).verdict === 'ai') caught++;
  console.log(`PERSUADE student essays by people: Likely AI ${(100 * likely / hs.length).toFixed(1)}%, Possibly AI ${(100 * mixed / hs.length).toFixed(1)}% (n ${hs.length}); DAIGT AI essays caught ${(100 * caught / as.length).toFixed(1)}%`);
}
