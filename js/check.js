// The essay checker page: runs js/report.js on the pasted text and draws the result. Everything
// happens in this tab; the text is never sent anywhere.
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const R = window.SlopgaugeReport;
  const LABELS = { human: ['p0', 0, 'Likely human-written'], mixed: ['p2', 2, 'Possibly AI-written'], ai: ['p4', 4, 'Likely AI-written'] };

  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === 'class') el.className = v;
      else el.setAttribute(k, v);
    }
    for (const k of kids) if (k != null && k !== false) el.append(k); // text nodes only: pasted text is never parsed as HTML
    return el;
  }

  function pill(verdict) {
    const [cls, level, text] = LABELS[verdict];
    const bars = level ? h('span', { class: 'bars' }, ...[1, 2, 3, 4].map((i) => h('i', { class: i <= level ? 'on' : '' }))) : null;
    return h('span', { class: `pill ${cls}` }, bars, text);
  }

  const pct = (x) => `${Math.round(x * 100)}%`;
  const sigmoid = (z) => 1 / (1 + Math.exp(-z));

  // The text, cut at sentence and pattern boundaries, each piece styled by its sentence's label and
  // whether a slop pattern covers it.
  function marked(text, report) {
    const slop = report.findings.filter((f) => f.severity === 'slop');
    const cuts = new Set([0, text.length]);
    for (const s of report.sentences) cuts.add(s.start).add(s.end);
    for (const f of slop) cuts.add(f.start).add(f.end);
    const points = [...cuts].sort((a, b) => a - b);
    const out = [];
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i];
      const b = points[i + 1];
      const piece = text.slice(a, b);
      const s = report.sentences.find((x) => a >= x.start && b <= x.end);
      const f = slop.find((x) => a >= x.start && b <= x.end);
      if (!s && !f) {
        out.push(piece);
        continue;
      }
      const cls = [s && s.label !== 'human' ? `s-${s.label}` : '', f ? 'r' : ''].filter(Boolean).join(' ');
      const tip = [s && s.logit !== null ? `AI-likeness of this passage: ${pct(sigmoid(s.logit))}` : '', f ? `${f.label}: ${f.why}` : ''].filter(Boolean).join('\n');
      out.push(h('span', { class: cls, title: tip }, piece));
    }
    return out;
  }

  function rulesTable(findings) {
    const by = new Map();
    for (const f of findings) {
      if (f.severity !== 'slop') continue;
      const g = by.get(f.label) || { n: 0, quotes: new Set() };
      g.n++;
      if (g.quotes.size < 3) g.quotes.add(f.text.replace(/\s+/g, ' ').slice(0, 60));
      by.set(f.label, g);
    }
    const rows = [];
    for (const [label, g] of [...by].sort((a, b) => b[1].n - a[1].n)) {
      rows.push(h('tr', null, h('td', null, h('b', null, label)), h('td', null, String(g.n))));
      for (const q of g.quotes) rows.push(h('tr', { class: 'sub' }, h('td', null, `“${q}”`), h('td')));
    }
    return rows;
  }

  function run() {
    const text = $('text').value;
    const report = R.analyze(text);
    const box = $('report');
    box.hidden = false;
    $('marked').replaceChildren(...marked(text, report));
    $('fWords').textContent = `${report.words.toLocaleString()} words`;
    $('fShare').textContent = report.tooShort ? '–' : pct(report.aiShare);
    $('fVerdict').replaceChildren(report.tooShort ? h('span', { class: 'pill p0' }, 'Too short to judge') : pill(report.verdict));
    const n = (label) => report.sentences.filter((s) => s.label === label).length;
    $('fAI').textContent = String(n('ai'));
    $('fMaybe').textContent = String(n('maybe'));
    $('fPatterns').textContent = String(report.findings.filter((f) => f.severity === 'slop').length);
    $('fRules').replaceChildren(...rulesTable(report.findings));
    box.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  }

  const count = () => {
    const n = R.words($('text').value);
    $('count').textContent = `${n.toLocaleString()} word${n === 1 ? '' : 's'}`;
  };
  $('text').addEventListener('input', count);
  $('form').addEventListener('submit', (e) => {
    e.preventDefault();
    if ($('text').value.trim()) run();
  });

  // From the extension's "Full report" button: the text arrives after the # (which browsers never
  // send to the server). Read it, then take it out of the address bar and history.
  const m = /^#text=(.*)$/s.exec(location.hash);
  if (m) {
    try {
      $('text').value = decodeURIComponent(m[1]);
    } catch (_) {}
    history.replaceState(null, '', location.pathname);
    count();
    if ($('text').value.trim()) run();
  }
})();
