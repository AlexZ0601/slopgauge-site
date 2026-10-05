// The essay checker page: runs js/report.js on the pasted text and draws the result as a marked-up
// paper. Everything happens in this tab; the text is never sent anywhere.
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const R = window.SlopgaugeReport;
  const VERDICTS = { human: ['p0', 0, 'Likely human-written'], mixed: ['p2', 2, 'Possibly AI-written'], ai: ['p4', 4, 'Likely AI-written'] };
  const RING = 'M70 12C128 1 238 2 279 25c28 17 14 52-52 64-62 11-160 9-200-9C-4 66 2 34 46 18 88 4 150 3 205 9';
  const SVG = 'http://www.w3.org/2000/svg';
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

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

  // The number, circled in red pen when there's something to see.
  function ringed(text) {
    const svg = document.createElementNS(SVG, 'svg');
    svg.setAttribute('viewBox', '0 0 300 100');
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS(SVG, 'path');
    path.setAttribute('pathLength', '1');
    path.setAttribute('d', RING);
    svg.append(path);
    const el = h('span', { class: 'ring draw', style: '--delay: 0.15s' }, text);
    el.append(svg);
    return el;
  }

  const pct = (x) => `${Math.round(x * 100)}%`;
  const sigmoid = (z) => 1 / (1 + Math.exp(-z));
  const plural = (n, one, many) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

  // The text, cut at sentence and pattern boundaries. Each piece is styled by its sentence's label
  // and by the slop patterns covering it; `marks` keeps each pattern's pieces for the notes and list.
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
    const first = marks[0].els[0];
    first.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'center' });
    for (const m of marks) for (const el of m.els) {
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

  // "Patterns found": one row per pattern; hover lights its marks, click scrolls to them.
  function patternList(marks) {
    if (!marks.length) return [h('li', { class: 'none' }, 'None of the named patterns.')];
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

  // Margin notes next to the line each pattern starts on. Patterns on the same line share a note; a
  // note that would land too far below its line is folded into the one above it.
  let current = [];
  function placeNotes() {
    const margin = $('margin');
    margin.replaceChildren();
    if (!current.length || getComputedStyle(margin).display === 'none') return;
    const base = margin.getBoundingClientRect().top;
    const line = parseFloat(getComputedStyle($('marked')).lineHeight) || 36;
    const groups = [];
    for (const m of current) {
      const top = m.els[0].getBoundingClientRect().top - base;
      const g = groups[groups.length - 1];
      if (g && top - g.top < line * 0.8) g.marks.push(m);
      else groups.push({ top, marks: [m] });
    }
    let floor = 0;
    let last = null;
    for (const g of groups) {
      if (last && floor - g.top > line * 2) {
        last.marks.push(...g.marks);
        fill(last);
        floor = last.at + last.el.offsetHeight + 10;
        continue;
      }
      const el = h('div', { class: 'note' });
      const note = { el, marks: [...g.marks], at: Math.max(g.top - 1, floor) };
      el.addEventListener('pointerenter', () => {
        el.classList.add('on');
        light(note.marks, true);
      });
      el.addEventListener('pointerleave', () => {
        el.classList.remove('on');
        light(note.marks, false);
      });
      margin.append(el);
      fill(note);
      el.style.top = `${note.at}px`;
      floor = note.at + el.offsetHeight + 10;
      last = note;
    }
  }
  function fill(note) {
    const groups = byLabel(note.marks);
    note.el.replaceChildren(...groups.map(([label, ms]) => h('span', null, ms.length > 1 ? `${label} ×${ms.length}` : label)));
    note.el.title = groups.map(([label, ms]) => `${label}: ${ms[0].f.why}`).join('\n');
  }
  let pending = 0;
  const replace = () => {
    cancelAnimationFrame(pending);
    pending = requestAnimationFrame(placeNotes);
  };
  new ResizeObserver(replace).observe($('marked'));
  if (document.fonts) document.fonts.ready.then(replace);

  function run() {
    const text = $('text').value;
    const report = R.analyze(text);
    const { nodes, marks } = marked(text, report);
    current = marks;
    $('marked').replaceChildren(...nodes);

    const share = report.tooShort ? '–' : pct(report.aiShare);
    const loud = !report.tooShort && report.verdict !== 'human' && report.aiShare > 0;
    $('share').className = `big${loud ? '' : ' calm'}`;
    $('share').replaceChildren(loud ? ringed(share) : share);
    $('shareOf').textContent = report.tooShort ? 'Too short to judge. Paste a paragraph or more: results firm up past about 150 words.' : `of the text, by words, is in sentences that read as AI-written.`;
    $('verdict').replaceChildren(report.tooShort ? h('span', { class: 'pill p0' }, 'Too short to judge') : pill(report.verdict));
    const n = (label) => report.sentences.filter((s) => s.label === label).length;
    $('fWords').textContent = report.words.toLocaleString();
    $('fAI').textContent = `${n('ai')} of ${report.sentences.length}`;
    $('fMaybe').textContent = String(n('maybe'));
    $('fPatterns').textContent = String(marks.length);
    $('patterns').replaceChildren(...patternList(marks));

    $('form').hidden = true;
    const box = $('report');
    box.hidden = false;
    placeNotes();
    box.scrollIntoView({ behavior: 'auto', block: 'start' });
    box.focus({ preventScroll: true });
  }

  function edit(clear) {
    $('report').hidden = true;
    $('form').hidden = false;
    current = [];
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

  // From the extension's "Full report" button or the home page's paste box: the text arrives after
  // the # (which browsers never send to the server). Read it, then take it out of the address bar.
  const m = /^#text=(.*)$/s.exec(location.hash);
  if (m) {
    try {
      $('text').value = decodeURIComponent(m[1]);
    } catch (_) {}
    history.replaceState(null, '', location.pathname);
    update();
    if ($('text').value.trim()) run();
  }
})();
