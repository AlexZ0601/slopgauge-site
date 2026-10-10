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
        nodes.push(s ? h('span', { 'data-s': String(s.start) }, piece) : piece);
        continue;
      }
      const el = h('span', { class: [sentenceCls, covering.length ? 'r' : ''].filter(Boolean).join(' '), 'data-tip': '' }, piece);
      tips.set(el, { score: s && s.logit !== null && s.label !== 'human' ? sigmoid(s.logit) : null, tells: covering.map((m) => m.f) });
      if (s) el.dataset.s = String(s.start);
      for (const m of covering) m.els.push(el);
      nodes.push(el);
    }
    return { nodes, marks: marks.filter((m) => m.els.length) };
  }

  // ---------- Why is this marked: a small card that grows out of the mark it explains ----------
  const tips = new WeakMap();
  const pop = h('div', { class: 'pop', role: 'tooltip', id: 'pop', hidden: '' });
  document.body.append(pop);
  let popFor = null;
  let pinned = false;
  let at = null; // where the pointer met the mark, to pick the right line of a wrapped mark
  let showT = 0;
  let hideT = 0;
  function place() {
    if (!popFor) return;
    const rects = [...popFor.getClientRects()];
    if (!rects.length) return closePop(true);
    const r = (at && rects.find((q) => at.y >= q.top - 2 && at.y <= q.bottom + 2)) || rects[0];
    const w = pop.offsetWidth;
    const ph = pop.offsetHeight;
    const nav = document.querySelector('.nav');
    const top = nav ? nav.getBoundingClientRect().bottom : 0;
    const above = r.top - ph - 10 > top + 6;
    const ax = Math.max(r.left, Math.min(r.right, at ? at.x : r.left + r.width / 2));
    const left = Math.max(8, Math.min(innerWidth - w - 8, ax - w / 2));
    pop.style.left = `${left + scrollX}px`;
    pop.style.top = `${(above ? r.top - ph - 10 : r.bottom + 10) + scrollY}px`;
    pop.style.transformOrigin = `${ax - left}px ${above ? '100%' : '0%'}`;
  }
  function openPop(el, pin) {
    clearTimeout(hideT);
    clearTimeout(showT);
    const t = tips.get(el);
    if (!t) return;
    const fresh = pop.hidden || pop.classList.contains('out');
    if (popFor && popFor !== el) popFor.classList.remove('open');
    popFor = el;
    pinned = pin;
    const kids = [];
    if (t.score !== null) kids.push(h('p', null, h('span', { class: 'score' }, `AI-likeness of this passage: ${pct(t.score)}`)));
    for (const f of t.tells) kids.push(h('p', null, h('b', null, f.label), f.why));
    if (!kids.length) return;
    pop.replaceChildren(...kids);
    pop.hidden = false;
    pop.classList.remove('out');
    place();
    if (fresh) {
      pop.classList.remove('in');
      void pop.offsetWidth;
      pop.classList.add('in');
    }
    el.classList.add('open');
  }
  function closePop(now) {
    clearTimeout(showT);
    clearTimeout(hideT);
    if (popFor) popFor.classList.remove('open');
    popFor = null;
    pinned = false;
    if (pop.hidden) return;
    if (now || reduced()) {
      pop.hidden = true;
      return;
    }
    pop.classList.remove('in');
    pop.classList.add('out');
    hideT = setTimeout(() => {
      pop.hidden = true;
      pop.classList.remove('out');
    }, 120);
  }
  const tipOf = (e) => e.target instanceof Element && e.target.closest('#marked [data-tip]');
  $('marked').addEventListener('pointerover', (e) => {
    if (e.pointerType !== 'mouse' || pinned) return;
    const el = tipOf(e);
    if (!el) return;
    at = { x: e.clientX, y: e.clientY };
    clearTimeout(hideT);
    // Once a card is up, moving to the next mark switches at once; the first one waits a beat.
    if (!pop.hidden && !pop.classList.contains('out')) openPop(el, false);
    else {
      clearTimeout(showT);
      showT = setTimeout(() => openPop(el, false), 70);
    }
  });
  $('marked').addEventListener('pointerout', (e) => {
    if (e.pointerType !== 'mouse' || pinned) return;
    const to = e.relatedTarget instanceof Element ? e.relatedTarget : null;
    if (to && (to.closest('#marked [data-tip]') || to.closest('.pop'))) return;
    clearTimeout(showT);
    hideT = setTimeout(() => closePop(), 140);
  });
  $('marked').addEventListener('click', (e) => {
    const el = tipOf(e);
    if (!el) return;
    at = { x: e.clientX, y: e.clientY };
    if (popFor === el && pinned) closePop();
    else openPop(el, true);
  });
  pop.addEventListener('pointerenter', () => clearTimeout(hideT));
  pop.addEventListener('pointerleave', (e) => {
    if (!pinned && e.pointerType === 'mouse') hideT = setTimeout(() => closePop(), 140);
  });
  document.addEventListener('pointerdown', (e) => {
    if (!popFor || !(e.target instanceof Element)) return;
    if (!e.target.closest('.pop') && !e.target.closest('#marked [data-tip]')) closePop();
  });
  addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && popFor) closePop();
  });
  addEventListener('resize', () => popFor && place());
  addEventListener('scroll', () => popFor && place(), { passive: true });

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

  // ---------- How unusual is this score, for this kind of text ----------
  const O = window.SlopgaugeOdds;
  const KIND_KEY = 'slopgauge.kind';
  $('kind').replaceChildren(...O.kinds.map(([k, label]) => h('option', { value: k }, k === 'all' ? 'Something else' : label)));
  try {
    $('kind').value = localStorage.getItem(KIND_KEY) || 'school';
  } catch (_) {
    $('kind').value = 'school';
  }
  $('kind').addEventListener('change', () => {
    try {
      localStorage.setItem(KIND_KEY, $('kind').value);
    } catch (_) {}
  });
  const inN = (share) => {
    if (share <= 0) return 'none';
    if (share >= 0.995) return 'all';
    if (share >= 0.1) return `${Math.round(share * 100)} in 100`;
    return `about 1 in ${Math.round(1 / share)}`;
  };
  function renderOdds(report) {
    const box = $('odds');
    if (report.tooShort || report.docLogit === null) return box.replaceChildren();
    const o = O.odds($('kind').value, report.docLogit);
    const kids = [h('span', { class: 'label' }, 'How unusual is this score?')];
    const human = o.human;
    if (human) {
      const n = Math.round(human.share * human.n);
      kids.push(
        h('p', null, h('b', null, `${o.label} by people: `), human.share <= 0 ? `none of the ${human.n.toLocaleString()} we tested scored this high.` : `${inN(human.share)} scored this high or higher (${n.toLocaleString()} of ${human.n.toLocaleString()} tested).`)
      );
    }
    if (o.ai) kids.push(h('p', null, h('b', null, `${o.label} by AI: `), `${inN(o.ai.share)} scored this high or higher.`));
    if (human && human.n < 150) kids.push(h('p', null, `Only ${human.n} texts of this kind were tested, so treat this as rough.`));
    box.replaceChildren(...kids);
  }

  // ---------- Does it sound like them (optional) ----------
  const knownText = () => $('known').value.trim();
  const knownPieces = () => knownText().split(/\n\s*-{3,}\s*\n/).map((x) => x.trim()).filter(Boolean);
  $('known').addEventListener('input', () => {
    const n = R.words(knownText());
    $('knownCount').textContent = `${n.toLocaleString()} word${n === 1 ? '' : 's'} of their writing${n && n < 150 ? ' · add more if you can: 300 or more is best' : ''}`;
  });
  let voiceRun = 0;
  async function compareVoice(text, report, nodes) {
    const box = $('voice');
    const id = ++voiceRun;
    const known = knownPieces();
    for (const el of $('marked').querySelectorAll('.v-off')) el.classList.remove('v-off');
    $('voiceKey').hidden = true;
    if (!known.length) {
      box.hidden = true;
      return;
    }
    box.hidden = false;
    const status = h('p', null, 'Loading the style model (70 MB, once)…');
    const bar = h('progress', { max: '1', value: '0' });
    box.replaceChildren(h('span', { class: 'label' }, 'Does it sound like them?'), status, bar);
    try {
      await import('./vendor/voice-runtime.js');
      const V = window.SlopgaugeVoiceNet;
      const C = window.SlopgaugeVoiceCal;
      await V.load((f) => (bar.value = f));
      if (id !== voiceRun) return;
      status.textContent = 'Comparing…';
      bar.removeAttribute('value');
      const K = await V.embed(known);
      const whole = V.cosine(K, await V.embed([text]));
      const p = 1 / (1 + Math.exp(-(C.whole[0] * whole + C.whole[1])));
      // Part by part: the essay's own paragraphs, short ones merged with the next and long ones cut
      // into runs of about 120 words, so a part is one stretch of writing.
      const parts = [];
      let cur = [];
      let n = 0;
      const flush = () => {
        if (cur.length) parts.push(cur);
        cur = [];
        n = 0;
      };
      report.sentences.forEach((s, i) => {
        cur.push(s);
        n += s.words;
        const next = report.sentences[i + 1];
        const paraEnd = !next || /\n\s*\n/.test(text.slice(s.end, next.start));
        if ((paraEnd && n >= 50) || n >= 160) flush();
      });
      if (cur.length) (n >= 50 || !parts.length ? parts.push(cur) : parts[parts.length - 1].push(...cur));
      let off = 0;
      for (const part of parts) {
        if (id !== voiceRun) return;
        const t = text.slice(part[0].start, part[part.length - 1].end);
        const sim = V.cosine(K, await V.embed([t]));
        const pp = 1 / (1 + Math.exp(-(C.window[0] * sim + C.window[1])));
        if (pp < C.offBelow) {
          off++;
          for (const s of part) for (const el of $('marked').querySelectorAll('span')) if (el.dataset.s === String(s.start)) el.classList.add('v-off');
        }
      }
      if (id !== voiceRun) return;
      const [cls, label] = p >= C.sameAbove ? ['same', 'Sounds like them'] : p < C.diffBelow ? ['diff', 'Doesn’t sound like them'] : ['unsure', 'Hard to tell'];
      const words = R.words(known.join(' '));
      box.replaceChildren(
        h('span', { class: 'label' }, 'Does it sound like them?'),
        h('span', { class: `verdict ${cls}` }, label),
        h('p', null, off ? `${off} of ${parts.length} parts read unlike their writing (dashed blue in the text).` : `Every part reads like their writing.`),
        h('p', null, `Compared with ${words.toLocaleString()} words of their writing by a neural style model (LUAR). In testing, a writer's own text was called “Doesn’t sound like them” ${Math.round(C.rates.ownDiff * 100)} times in 100, and AI-written text ${Math.round(C.rates.aiDiff * 100)} times in 100; parts get the dashed mark that rarely too. A different-sounding essay can have honest reasons: a new topic, a different assignment, help from a tutor.${words < 300 ? ' With under 300 words of their writing it is less sure.' : ''}`)
      );
      $('voiceKey').hidden = !off;
    } catch (e) {
      if (id === voiceRun) box.replaceChildren(h('span', { class: 'label' }, 'Does it sound like them?'), h('p', null, `The style model couldn't run in this browser (${(e && e.message) || e}).`));
    }
  }

  function run() {
    closePop(true);
    const text = $('text').value;
    const report = R.analyze(text, $('kind').value);
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
    renderOdds(report);

    $('form').hidden = true;
    const box = $('report');
    box.hidden = false;
    box.classList.remove('arrive');
    void box.offsetWidth;
    box.classList.add('arrive');
    box.scrollIntoView({ behavior: 'auto', block: 'start' });
    box.focus({ preventScroll: true });
    // Pour the tells in: copies of their letters fly to the gauge, which fills to the AI-like share.
    gauge.set(0);
    gauge.shown = 0;
    gauge.vel = 0;
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
    compareVoice(text, report);
  }

  function edit(clear) {
    closePop(true);
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

  // Files: Word, PDF and plain text, read in the browser.
  async function openFile(file) {
    if (!file) return;
    $('count').textContent = `Reading ${file.name}…`;
    try {
      await import('./vendor/files-runtime.js');
      const { text } = await window.SlopgaugeFiles.readFile(file);
      $('text').value = text;
      update();
      $('text').focus();
    } catch (e) {
      $('count').textContent = `Couldn't read ${file.name}: ${(e && e.message) || e}`;
    }
  }
  $('file').addEventListener('change', () => openFile($('file').files[0]));
  $('form').addEventListener('dragover', (e) => {
    if ([...e.dataTransfer.types].includes('Files')) {
      e.preventDefault();
      $('form').classList.add('drop');
    }
  });
  $('form').addEventListener('dragleave', () => $('form').classList.remove('drop'));
  $('form').addEventListener('drop', (e) => {
    if (!e.dataTransfer.files.length) return;
    e.preventDefault();
    $('form').classList.remove('drop');
    openFile(e.dataTransfer.files[0]);
  });
  $('sample').addEventListener('click', () => {
    $('text').value = window.SlopgaugeSample;
    update();
    $('text').focus();
  });
  $('clear').addEventListener('click', () => edit(true));
  // A report on paper: what was checked, when, and as what kind of text.
  $('print').addEventListener('click', () => {
    const kind = $('kind').selectedOptions[0];
    $('printHead').textContent = `Slopgauge report · ${new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })} · ${kind ? kind.textContent : ''} · ${plural(R.words($('text').value), 'word', 'words')} · slopgauge.com`;
    closePop(true);
    print();
  });
  // ⌘↩ or Ctrl+↩ measures from either text box.
  const mac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  $('shortcut').textContent = mac ? '⌘↩' : 'Ctrl+↩';
  for (const id of ['text', 'known'])
    $(id).addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        $('form').requestSubmit();
      }
    });
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
