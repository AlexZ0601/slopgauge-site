// Slopgauge essay report: scores a long text sentence by sentence with the same style model and rules
// as the extension (js/model.js, js/style.js, js/detector.js), all in the visitor's browser.
//
// Each sentence is scored together with its neighbours (a window of about 60 words), the way
// commercial detectors score short windows, because one sentence alone carries too little signal.
// Thresholds (CAL) were set on held-out human and AI essays, stories and news so that few human
// sentences are flagged.
(function (root) {
  'use strict';
  const D = root.Slopgauge;
  const S = root.SlopgaugeStyle;
  const WINDOW = 60; // words around each sentence
  const CHUNK = 220; // words per chunk for the whole-text score

  // Thresholds on the style model's logit, per kind of text (js/odds.js, set by
  // scripts/odds/calibrate.js on held-out texts of that kind): "Likely AI-written" for at most 1 in
  // 100 human texts, "Possibly" 5 in 100; sentences marked for at most 2 in 100 human words. These
  // defaults (all kinds pooled) apply when no kind is given.
  const DEFAULT = { sentenceAI: 1.828, sentenceMaybe: 1.177, docAI: 2.612, docMixed: 1.429, shareMixed: 0.3 };
  const calFor = (kind) => (root.SlopgaugeOdds && kind ? root.SlopgaugeOdds.calibration(kind) : DEFAULT);

  const words = (s) => (s.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || []).length;

  function windowAround(sents, i) {
    let a = i;
    let b = i;
    let n = sents[i].words;
    while (n < WINDOW && (a > 0 || b < sents.length - 1)) {
      if (b < sents.length - 1) n += sents[++b].words;
      if (n < WINDOW && a > 0) n += sents[--a].words;
    }
    return [a, b];
  }

  function logitOf(text) {
    const r = S.assess(text, D.detect(text));
    return r ? r.logit : null;
  }

  /**
   * analyze(text) -> { words, sentences: [{start, end, text, logit, label}], aiShare, docLogit, verdict,
   *   findings, level }
   * label is 'ai', 'maybe' or 'human'; aiShare is the share of words in 'ai' sentences.
   */
  function analyze(text, kind) {
    const CAL = calFor(kind);
    const sents = D.sentences(text).filter((s) => s.words > 0);
    const total = sents.reduce((n, s) => n + s.words, 0);
    const out = sents.map((s, i) => {
      const [a, b] = windowAround(sents, i);
      const logit = logitOf(text.slice(sents[a].start, sents[b].end));
      return { start: s.start, end: s.end, text: s.text, words: s.words, logit };
    });
    for (const s of out) s.label = s.logit === null ? 'human' : s.logit >= CAL.sentenceAI ? 'ai' : s.logit >= CAL.sentenceMaybe ? 'maybe' : 'human';
    const aiWords = out.filter((s) => s.label === 'ai').reduce((n, s) => n + s.words, 0);
    // Whole-text score: mean over ~220-word chunks, so a long essay is judged like several posts.
    const chunks = [];
    let cur = [];
    let n = 0;
    for (const s of sents) {
      cur.push(s);
      n += s.words;
      if (n >= CHUNK) {
        chunks.push(cur);
        cur = [];
        n = 0;
      }
    }
    if (cur.length && (n >= 40 || !chunks.length)) chunks.push(cur);
    else if (cur.length) chunks[chunks.length - 1].push(...cur);
    const logits = chunks.map((c) => logitOf(text.slice(c[0].start, c[c.length - 1].end))).filter((x) => x !== null);
    const docLogit = logits.length ? logits.reduce((a, b) => a + b, 0) / logits.length : null;
    const aiShare = total ? aiWords / total : 0;
    let verdict = 'human';
    if (docLogit !== null && docLogit >= CAL.docAI) verdict = 'ai';
    else if ((docLogit !== null && docLogit >= CAL.docMixed) || aiShare >= CAL.shareMixed) verdict = 'mixed';
    const findings = D.detect(text);
    return { words: total, sentences: out, aiShare, docLogit, verdict, findings, tooShort: total < 40 };
  }

  const api = { analyze, words };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SlopgaugeReport = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
