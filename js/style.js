// Slopgauge style model: a logistic regression that reads word choice, word pairs, punctuation and
// sentence rhythm, trained on matched human and AI texts (see scripts/model/). The weights ship in
// model.js and everything runs locally, like the rules: no network, no remote model.
//
// The same tokenizer produces the training features (scripts/model/features.js), so what the
// browser computes is exactly what the model was trained on.
(function (root) {
  'use strict';

  // Fancy Unicode letters (𝐛𝐨𝐥𝐝, 𝘪𝘵𝘢𝘭𝘪𝘤) fold to plain ones, curly quotes to straight ones.
  function normalize(text) {
    return text.normalize('NFKC').replace(/[‘’ʼ′]/g, "'").replace(/[“”″]/g, '"');
  }

  // Lowercased words, plus tokens for punctuation, numbers, links and emoji. Line breaks are left
  // out on purpose: public corpora flatten paragraphs inconsistently, so the model would learn the
  // corpus, not the writer. Layout habits are the rules' job.
  const TOKEN = /(https?:\/\/\S+|www\.\S+)|([@#][\p{L}\p{N}_]+)|(\p{N}+(?:[.,:]\p{N}+)*)|(\p{L}+(?:'\p{L}+)*)|(\.{2,}|[!?]{2,}|\s[-–—]\s|--|[—–]|[.!?,;:()"'&/*•→%$])|(\p{Extended_Pictographic})/gu;
  function tokenize(text) {
    const out = ['<s>'];
    const t = normalize(text);
    let m;
    TOKEN.lastIndex = 0;
    while ((m = TOKEN.exec(t))) {
      let tok;
      if (m[1]) tok = '<url>';
      else if (m[2]) tok = m[2][0] === '@' ? '<at>' : '<hash>';
      else if (m[3]) tok = '<num>';
      else if (m[4]) tok = m[4].toLowerCase();
      else if (m[5]) {
        const p = m[5].trim();
        tok = /^[-–—]+$/.test(p) ? '<dash>' : /^\.{2,}$/.test(p) ? '<ell>' : /^[!?]{2,}$/.test(p) ? '<!!>' : p;
      } else tok = '<emoji>';
      if (tok === '<emoji>' && out[out.length - 1] === '<emoji>') continue; // a run of emoji is one
      out.push(tok);
      if (tok === '.' || tok === '!' || tok === '?' || tok === '<!!>') out.push('<s>');
    }
    if (out[out.length - 1] === '<s>') out.pop();
    return out;
  }

  // Unigrams and bigrams, counted.
  function grams(tokens) {
    const counts = new Map();
    const bump = (k) => counts.set(k, (counts.get(k) || 0) + 1);
    for (let i = 0; i < tokens.length; i++) {
      if (tokens[i] !== '<s>') bump(tokens[i]);
      if (i > 0) bump(tokens[i - 1] + ' ' + tokens[i]);
    }
    return counts;
  }

  const WORD = /\p{L}+(?:['’]\p{L}+)*/gu;

  // Rhythm and casing: things a bag of words can't see.
  const DENSE = ['log words', 'sentence length', 'sentence length spread', 'word length', 'vocabulary variety',
    'lowercase sentence starts', 'lowercase i', 'all-caps words', 'contractions'];
  function dense(text) {
    const t = normalize(text);
    const words = t.match(WORD) || [];
    const n = Math.max(words.length, 1);
    const sents = t.split(/(?<=[.!?])\s+|\n+/).map((s) => (s.match(WORD) || []).length).filter((c) => c > 0);
    const mean = sents.length ? sents.reduce((a, b) => a + b, 0) / sents.length : n;
    const sd = sents.length > 1 ? Math.sqrt(sents.reduce((a, b) => a + (b - mean) ** 2, 0) / sents.length) : 0;
    const starts = t.split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter((s) => /^\p{L}/u.test(s));
    // Vocabulary variety over a fixed 60-word window, so it doesn't just track length.
    let ttr = 0;
    let windows = 0;
    for (let i = 0; i + 60 <= words.length || (i === 0 && windows === 0); i += 30) {
      const w = words.slice(i, i + 60).map((x) => x.toLowerCase());
      if (!w.length) break;
      ttr += new Set(w).size / w.length;
      windows++;
      if (i + 60 > words.length) break;
    }
    return [
      Math.log(n),
      Math.min(mean, 60),
      sents.length > 2 ? Math.min(sd / Math.max(mean, 1), 2) : 0.5,
      words.reduce((a, w) => a + w.length, 0) / n,
      windows ? ttr / windows : 1,
      starts.length ? starts.filter((s) => /^\p{Ll}/u.test(s)).length / starts.length : 0,
      (t.match(/(?<![\p{L}'])i(?![\p{L}'])/gu) || []).length / n,
      words.filter((w) => w.length > 1 && w === w.toUpperCase() && /\p{Lu}/u.test(w)).length / n,
      words.filter((w) => /['’]/.test(w)).length / n,
    ];
  }

  /**
   * assess(text, findings) -> { p, logit, words, reasons } or null when there's no model or too
   * little text. findings are the detector's rule hits, which the model also weighs. p is the
   * model's probability that the text was written by AI; reasons lists the words and habits that
   * pushed it up most, for the evidence popover.
   */
  function assess(text, findings) {
    const M = root.SlopgaugeModel;
    if (!M) return null;
    const tokens = tokenize(text);
    const nWords = (normalize(text).match(WORD) || []).length;
    if (nWords < M.minWords) return null;
    const scale = 1 / Math.sqrt(tokens.length);
    const contrib = new Map();
    let logit = M.bias;
    for (const [g, c] of grams(tokens)) {
      const w = M.grams[g];
      if (w === undefined) continue;
      const v = w * c * scale;
      logit += v;
      contrib.set(g, v);
    }
    const d = dense(text);
    for (let i = 0; i < d.length; i++) {
      const v = (M.dense[i] * (d[i] - M.mean[i])) / M.std[i];
      logit += v;
      contrib.set('#' + DENSE[i], v);
    }
    const counts = {};
    for (const f of findings || []) if (f.severity === 'slop') counts[f.rule] = (counts[f.rule] || 0) + 1;
    // Learned rule weights apply to log(1 + hits), as in training. Templated-post habits (arrow and
    // emoji bullets, fancy letters...) barely occur in the training corpora, so their weight is set
    // by hand and counts once.
    for (const [rule, c] of Object.entries(counts)) {
      const v = (M.rules[rule] || 0) * Math.log1p(c) + (M.manual[rule] || 0);
      if (!v) continue;
      logit += v;
      contrib.set('@' + rule, v);
    }
    const reasons = [...contrib].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k]) => k);
    return { p: 1 / (1 + Math.exp(-logit)), logit, words: nWords, reasons };
  }

  const api = { normalize, tokenize, grams, dense, assess, DENSE };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SlopgaugeStyle = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
