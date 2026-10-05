// The essay checker page: runs js/report.js on the pasted text, marks it, and pours its tells into
// the gauge (js/gauge.js), filled to the share of the text that reads as AI-written. Everything
// happens in this tab; the text is never sent anywhere.
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const R = window.SlopgaugeReport;
  const { Gauge, lettersOf } = window.SlopgaugeGauge;
  const VERDICTS = { human: ['p0', 0, 'Likely human-written'], mixed: ['p2', 2, 'Possibly AI-written'], ai: ['p4', 4, 'Likely AI-written'] };
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const gauge = new Gauge($('gauge'), {
    ticks: [0, 0.25, 0.5, 0.75, 1].map((at) => ({ at, text: `${at * 100}%` })),
    minor: 0.05,
    print: ['SLOPGAUGE', '% AI-LIKE'],
  });

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
    const [cls, level, text] = VERDICTS[verdict];
    const bars = level ? h('span', { class: 'bars' }, ...[1, 2, 3, 4].map((i) => h('i', { class: i <= level ? 'on' : '' }))) : null;
    return h('span', { class: `pill ${cls}` }, bars, text);
  }

  const pct = (x) => `${Math.round(x * 100)}%`;
  const sigmoid = (z) => 1 / (1 + Math.exp(-z));
  const plural = (n, one, many) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

  // The text, cut at sentence and tell boundaries. Each piece is styled by its sentence's label and
  // by the tells covering it; `marks` keeps each tell's pieces for the list and the gauge.
  function marked(text, report) {
    const slop = report.findings.filter((f) => f.severity === 'slop').sort((a, b) => a.start - b.start || b.end - a.end);
    const marks = slop.map((f) => ({ f, els: [] }));
    const cuts = new Set([0, text.length]);
    for (const s of report.sentences) cuts.add(s.start).add(s.end);
    for (const f of slop) cuts.add(f.start).add(f.end);
    const points = [...cuts].sort((a, b) => a - b);
    const nodes = [];
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i];
      const b = points[i + 1];
      const piece = text.slice(a, b);
      const s = report.sentences.find((x) => a >= x.start && b <= x.end);
      const covering = marks.filter((m) => a >= m.f.start && b <= m.f.end);
      const sentenceCls = s && s.label !== 'human' ? `s-${s.label}` : '';
      if (!sentenceCls && !covering.length) {
        nodes.push(piece);
        continue;
      }
      const tip = [s && s.logit !== null && s.label !== 'human' ? `AI-likeness of this passage: ${pct(sigmoid(s.logit))}` : '', ...covering.map((m) => `${m.f.label}: ${m.f.why}`)].filter(Boolean).join('\n');
      const el = h('span', { class: [sentenceCls, covering.length ? 'r' : ''].filter(Boolean).join(' '), title: tip }, piece);
      for (const m of covering) m.els.push(el);
      nodes.push(el);
    }
    return { nodes, marks: marks.filter((m) => m.els.length) };
  }

  const light = (marks, on) => {
    for (const m of marks) for (const el of m.els) el.classList.toggle('lit', on);
  };

  function show(marks) {
    marks[0].els[0].scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'center' });
    for (const m of marks)
      for (const el of m.els) {
        el.classList.remove('flash');
        void el.offsetWidth; // restart the animation
        el.classList.add('flash');
      }
  }

  function byLabel(marks) {
    const groups = new Map();
    for (const m of marks) {
      if (!groups.has(m.f.label)) groups.set(m.f.label, []);
      groups.get(m.f.label).push(m);
    }
    return [...groups].sort((a, b) => b[1].length - a[1].length);
  }

  // "Tells found": one row per kind; hover lights its marks, click scrolls to them.
  function tellList(marks) {
    if (!marks.length) return [h('li', { class: 'none' }, 'None of the named tells.')];
    return byLabel(marks).map(([label, ms]) => {
      const btn = h('button', { type: 'button', title: ms[0].f.why }, h('span', null, label), h('span', null, `×${ms.length}`));
      btn.addEventListener('pointerenter', () => light(ms, true));
      btn.addEventListener('pointerleave', () => light(ms, false));
      btn.addEventListener('focus', () => light(ms, true));
      btn.addEventListener('blur', () => light(ms, false));
      btn.addEventListener('click', () => show(ms));
      return h('li', null, btn);
    });
  }

  function run() {
    const text = $('text').value;
    const report = R.analyze(text);
    const { nodes, marks } = marked(text, report);
    $('marked').replaceChildren(...nodes);

    $('share').textContent = report.tooShort ? '–' : pct(report.aiShare);
    $('shareOf').textContent = report.tooShort ? 'Too short to measure. Paste a paragraph or more: results firm up past about 150 words.' : 'of the text reads as AI-written';
    $('verdict').replaceChildren(report.tooShort ? h('span', { class: 'pill p0' }, 'Too short to judge') : pill(report.verdict));
    const n = (label) => report.sentences.filter((s) => s.label === label).length;
    $('fWords').textContent = report.words.toLocaleString();
    $('fAI').textContent = `${n('ai')} of ${report.sentences.length}`;
    $('fMaybe').textContent = String(n('maybe'));
    $('fPatterns').textContent = String(marks.length);
    $('patterns').replaceChildren(...tellList(marks));

    $('form').hidden = true;
    const box = $('report');
    box.hidden = false;
    box.scrollIntoView({ behavior: 'auto', block: 'start' });
    box.focus({ preventScroll: true });
    // Pour the tells in: copies of their letters fly to the gauge, which fills to the AI-like share.
    gauge.set(0);
    gauge.shown = 0;
    const seen = new Set();
    const items = [];
    let k = 0;
    for (const m of marks) {
      const el = m.els[0];
      if (seen.has(el) || m.f.end - m.f.start > 70) continue;
      seen.add(el);
      const r = el.getBoundingClientRect();
      if (r.top > innerHeight * 1.5) continue;
      items.push(...lettersOf(el, { delay: 0.25 + k++ * 0.16, gap: 0.014 }));
    }
    requestAnimationFrame(() => gauge.pour(items, report.tooShort ? 0 : report.aiShare));
  }

  function edit(clear) {
    $('report').hidden = true;
    $('form').hidden = false;
    if (clear) $('text').value = '';
    update();
    $('form').scrollIntoView({ behavior: 'auto', block: 'center' });
    $('text').focus();
  }

  // The editor grows with its text, so the whole essay stays in view; the toolbar sticks to the bottom.
  function update() {
    const box = $('text');
    const n = R.words(box.value);
    $('count').textContent = plural(n, 'word', 'words');
    $('clear').hidden = !box.value;
    box.style.height = 'auto';
    box.style.height = `${box.scrollHeight + 2}px`;
  }

  $('text').addEventListener('input', update);
  $('sample').addEventListener('click', () => {
    $('text').value = window.SlopgaugeSample;
    update();
    $('text').focus();
  });
  $('clear').addEventListener('click', () => edit(true));
  $('edit').addEventListener('click', () => edit(false));
  $('again').addEventListener('click', () => edit(true));
  $('form').addEventListener('submit', (e) => {
    e.preventDefault();
    if ($('text').value.trim()) run();
    else $('text').focus();
  });

  // From the extension's "Full report" button or the home page: the text arrives after the # (which
  // browsers never send to the server). Read it, then take it out of the address bar.
  const m = /^#text=(.*)$/s.exec(location.hash);
  if (m) {
    try {
      $('text').value = decodeURIComponent(m[1]);
    } catch (_) {}
    history.replaceState(null, '', location.pathname);
    update();
    if ($('text').value.trim()) {
      if (document.fonts && document.fonts.status !== 'loaded') document.fonts.ready.then(run);
      else run();
    }
  }
})();
