// "Check a class": many essays at once. Each is measured like the essay checker does it, and pairs
// that share unusually much wording are grouped: several students who pasted the same prompt into a
// chatbot tend to hand in the same skeleton (the same phrases, in the same order), far more than
// students writing on the same topic by themselves do. Runs in the browser; nothing is uploaded.
(function (root) {
  'use strict';
  const WORD = /[\p{L}\p{N}]+(?:['’][\p{L}]+)*/gu;

  // Three-word sequences of a text, lowercased.
  function shingles(text) {
    const w = (text.normalize('NFKC').toLowerCase().match(WORD) || []);
    const out = new Set();
    for (let i = 0; i + 3 <= w.length; i++) out.add(`${w[i]} ${w[i + 1]} ${w[i + 2]}`);
    return out;
  }

  /**
   * overlaps(texts) -> { pairs: [{a, b, score, shared: [phrases]}], groups: [[indices]] }
   * Phrases that half the class or more use (the prompt's own words, the topic) don't count.
   * A pair is flagged when its share of rare phrases in common is far above the class's usual
   * pair and above an absolute floor (see scripts/class/ for how these were set).
   */
  function overlaps(texts, opts = {}) {
    const floor = opts.floor ?? 0.08;
    const eligible = opts.eligible || texts.map(() => true); // only essays that read as AI can be grouped
    const sets = texts.map(shingles);
    const df = new Map();
    for (const s of sets) for (const g of s) df.set(g, (df.get(g) || 0) + 1);
    const common = texts.length >= 4 ? Math.max(2, Math.ceil(texts.length / 2)) : Infinity;
    const rare = sets.map((s) => new Set([...s].filter((g) => df.get(g) < common)));
    const all = [];
    for (let a = 0; a < texts.length; a++) {
      for (let b = a + 1; b < texts.length; b++) {
        const A = rare[a];
        const B = rare[b];
        let inter = 0;
        for (const g of A) if (B.has(g)) inter++;
        const score = Math.min(A.size, B.size) ? inter / Math.min(A.size, B.size) : 0;
        all.push({ a, b, score, inter });
      }
    }
    const sorted = all.map((p) => p.score).sort((x, y) => x - y);
    const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
    const mad = sorted.length ? [...sorted].map((x) => Math.abs(x - median)).sort((x, y) => x - y)[Math.floor(sorted.length / 2)] : 0;
    const cut = Math.max(floor, median + 6 * Math.max(mad, 0.005));
    const pairs = all
      .filter((p) => p.score >= cut && p.inter >= 6 && eligible[p.a] && eligible[p.b])
      .sort((x, y) => y.score - x.score)
      .map((p) => ({ ...p, shared: sharedPhrases(texts[p.a], texts[p.b], rare[p.a], rare[p.b]) }));
    // Groups: essays linked by flagged pairs.
    const parent = texts.map((_, i) => i);
    const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    for (const p of pairs) parent[find(p.a)] = find(p.b);
    const by = new Map();
    for (const p of pairs) for (const i of [p.a, p.b]) {
      const r = find(i);
      if (!by.has(r)) by.set(r, new Set());
      by.get(r).add(i);
    }
    return { pairs, groups: [...by.values()].map((s) => [...s].sort((x, y) => x - y)), cut };
  }

  // The longest runs of shared rare wording, for showing the teacher what matched.
  function sharedPhrases(ta, tb, A, B, max = 4) {
    const w = (ta.normalize('NFKC').match(WORD) || []);
    const lw = w.map((x) => x.toLowerCase());
    const runs = [];
    let start = -1;
    for (let i = 0; i + 3 <= lw.length; i++) {
      const g = `${lw[i]} ${lw[i + 1]} ${lw[i + 2]}`;
      const hit = A.has(g) && B.has(g);
      if (hit && start < 0) start = i;
      if (!hit && start >= 0) {
        runs.push([start, i + 1]);
        start = -1;
      }
    }
    if (start >= 0) runs.push([start, lw.length]);
    return runs
      .sort((x, y) => y[1] - y[0] - (x[1] - x[0]))
      .slice(0, max)
      .map(([s, e]) => w.slice(s, e).join(' '));
  }

  const api = { overlaps, shingles };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SlopgaugeClass = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
