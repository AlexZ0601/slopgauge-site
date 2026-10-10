// The home page: an editable post measured live by the extension's own detector (js/detector.js,
// js/style.js, js/model.js), whose tells drain into the gauge (js/gauge.js); a small feed scored on
// the page; and a paragraph of slop with its tells numbered. Nothing leaves the page.
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const D = window.Slopgauge;
  const M = window.SlopgaugeModel;
  const { Gauge, lettersOf } = window.SlopgaugeGauge;
  const LONG = 70; // tells longer than this (habits spanning sentences) count toward the level, but aren't marked

  const h = (tag, attrs, ...kids) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === 'class') el.className = v;
      else el.setAttribute(k, v);
    }
    for (const k of kids) if (k != null && k !== false) el.append(k);
    return el;
  };

  function pill(level, label) {
    const cls = `pill p${level}`;
    if (!level) return h('span', { class: cls }, label);
    return h('span', { class: cls }, h('span', { class: 'bars' }, ...[1, 2, 3, 4].map((i) => h('i', { class: i <= level ? 'on' : '' }))), label);
  }

  // The meter's level, as a height in the gauge: each of the five levels gets a fifth of the glass.
  function measure(text) {
    const all = D.detect(text);
    const sc = D.score(all, text);
    let f;
    if (sc.style) {
      const t = M.levels;
      const pts = [[t[0] - 1.6, 0], [t[0], 0.2], [t[1], 0.4], [t[2], 0.6], [t[3], 0.8], [t[3] + 1.4, 1]];
      const x = sc.style.logit;
      f = x <= pts[0][0] ? 0 : 1;
      for (let i = 1; i < pts.length; i++) {
        if (x <= pts[i][0]) {
          f = pts[i - 1][1] + ((x - pts[i - 1][0]) / (pts[i][0] - pts[i - 1][0])) * (pts[i][1] - pts[i - 1][1]);
          break;
        }
      }
    } else f = [0, 0.27, 0.47, 0.67, 0.87][sc.level];
    return { all, slop: all.filter((x) => x.severity === 'slop'), level: sc.level, label: sc.label, f };
  }
  window.SlopgaugeHome = { measure, pill }; // for js/levels.js

  // Overlapping tells merge into one marked stretch; each gets a key that survives edits elsewhere.
  function stretches(text, slop) {
    const out = [];
    for (const f of slop.filter((x) => x.end - x.start <= LONG).sort((a, b) => a.start - b.start || b.end - a.end)) {
      const last = out[out.length - 1];
      if (last && f.start < last.end) {
        last.end = Math.max(last.end, f.end);
        last.tells.push(f);
      } else out.push({ start: f.start, end: f.end, tells: [f] });
    }
    const seen = new Map();
    for (const s of out) {
      const body = text.slice(s.start, s.end).toLowerCase().replace(/\s+/g, ' ');
      const n = (seen.get(body) || 0) + 1;
      seen.set(body, n);
      s.key = `${body}#${n}`;
    }
    return out;
  }

  // ---------- The post on the bench ----------
  const POSTS = [
    { who: 'Dana Okafor', role: 'Head of Growth at Hollowpine · 2h', mono: 'DO', bg: '#5d6b4f', text: `I'm thrilled to announce that I've joined Hollowpine as Head of Growth.\n\nHere's the thing: growth isn't about hacks. It's about people.\n\nSix years in B2B SaaS taught me to delve into what customers actually need. The best part? It's simple.\n\nNot a sprint. Not a marathon. A lifestyle.\n\nAgree? Let me know in the comments.` },
    { who: 'Marisol Vega', role: 'Commuter · 5h', mono: 'MV', bg: '#7a5a46', text: `Took the 6:40 home and the guy across from me had a whole rotisserie chicken on his lap. Not eating it, just holding it like a cat. Nobody said a word. Best commute I've had in months.` },
    { who: 'Grant Whitfield', role: 'Leadership Coach · 1d', mono: 'GW', bg: '#46607a', text: `In today's fast-paced world, leadership is more than a title. It's a mindset.\n\nGreat leaders don't just manage tasks; they empower people, foster collaboration, and unlock potential.\n\nHere are 3 lessons I've learned:\n→ Listen first\n→ Lead with empathy\n→ Celebrate small wins\n\nUltimately, the best leaders create more leaders. What would you add?` },
    { who: 'Owen Price', role: 'Backend engineer · 3h', mono: 'OP', bg: '#6a5a7a', text: `Spent two days chasing a memory leak that turned out to be a debug flag someone left on in 2019. Removed one line. Graphs went flat. I don't know whether to laugh or file a postmortem.` },
  ];
  const box = $('postText');
  const mirror = $('postMirror');
  const gauge = new Gauge($('heroGauge'), {
    ticks: [{ at: 0, text: 'No slop' }, { at: 0.2, text: 'A little' }, { at: 0.4, text: 'Some' }, { at: 0.6, text: 'Heavy' }, { at: 0.8, text: 'Pure slop' }],
    minor: 0.05,
    print: ['SLOPGAUGE', 'TC 20 °C'],
  });
  let drained = new Set();
  let current = { slop: [], level: 0, label: 'No slop', f: 0 };
  let marks = [];
  let which = 0;
  let idle = 0;

  function paint() {
    const text = box.value;
    const nodes = [];
    let at = 0;
    for (const s of marks) {
      nodes.push(text.slice(at, s.start));
      const span = h('span', { class: `tell${drained.has(s.key) ? ' ghost' : ''}`, 'data-key': s.key }, text.slice(s.start, s.end));
      nodes.push(span);
      at = s.end;
    }
    nodes.push(text.slice(at) + '\n'); // a trailing newline keeps an empty last line's height
    mirror.replaceChildren(...nodes);
  }

  function meter() {
    const n = marks.length;
    $('postMeter').replaceChildren(pill(current.level, current.label), h('span', null, `${n} tell${n === 1 ? '' : 's'}`));
    $('drained').textContent = String([...drained].filter((k) => marks.some((s) => s.key === k)).length);
  }

  // Re-measure on every keystroke (it's fast), and mark tells right away.
  function remeasure() {
    current = measure(box.value);
    marks = stretches(box.value, current.slop);
    const live = new Set(marks.map((s) => s.key));
    drained = new Set([...drained].filter((k) => live.has(k)));
    paint();
    meter();
  }

  // Drain the tells that haven't drained yet, and set the gauge to the post's level.
  function drain(stagger = 0.24) {
    const fresh = marks.filter((s) => !drained.has(s.key));
    const items = [];
    fresh.forEach((s, i) => {
      const span = mirror.querySelector(`[data-key="${CSS.escape(s.key)}"]`);
      if (!span) return;
      items.push(...lettersOf(span, { delay: i * stagger }));
      drained.add(s.key);
      setTimeout(() => span.classList.add('ghost'), i * stagger * 1000);
    });
    gauge.pour(items, current.f);
    meter();
  }

  function load(i, { animate = true } = {}) {
    const p = POSTS[i];
    $('postName').textContent = p.who;
    $('postRole').textContent = p.role;
    $('postAvatar').textContent = p.mono;
    $('postAvatar').style.background = p.bg;
    box.value = p.text;
    drained = new Set();
    gauge.set(0);
    remeasure();
    if (animate) setTimeout(() => drain(), 650);
  }

  function asYou() {
    $('postName').textContent = 'You';
    $('postRole').textContent = 'Draft · not posted';
    $('postAvatar').textContent = 'Y';
    $('postAvatar').style.background = '#1d1d1f';
  }
  box.addEventListener('input', () => {
    if ($('postName').textContent !== 'You') asYou();
    remeasure();
    clearTimeout(idle);
    idle = setTimeout(() => drain(0.12), 700);
  });
  $('nextPost').addEventListener('click', () => {
    which = (which + 1) % POSTS.length;
    load(which);
  });
  $('ownPost').addEventListener('click', () => {
    box.value = '';
    box.placeholder = 'Write a post. Try starting with “Here’s the thing:”';
    asYou();
    drained = new Set();
    gauge.set(0);
    remeasure();
    box.focus();
  });

  load(0, { animate: false });
  const start = () => setTimeout(() => drain(), 700);
  if (document.fonts && document.fonts.status !== 'loaded') document.fonts.ready.then(start);
  else start();
  // Wrapping changes with the width: keep the marks lined up.
  new ResizeObserver(() => paint()).observe(box);

  // ---------- A small feed, scored on the page ----------
  const FEED = [
    { who: 'Marisol Vega', mono: 'MV', bg: '#7a5a46', when: '5h', text: POSTS[1].text },
    { who: 'Priya Natarajan', mono: 'PN', bg: '#46607a', when: '1d', text: `Grateful for an amazing week at the summit. So many insightful conversations about the future of work and the role of AI in our everyday lives. Key takeaway: the human element still matters most.` },
    { who: 'Grant Whitfield', mono: 'GW', bg: '#5d6b4f', when: '1d', text: POSTS[2].text },
  ];
  $('feedPosts').replaceChildren(
    ...FEED.map((p) => {
      const m = measure(p.text);
      const n = new Set(m.slop.map((f) => f.label)).size;
      return h(
        'article',
        { class: `feed-post${m.level >= 3 ? ' dim' : ''}` },
        h('div', { class: 'meta' }, h('span', { class: 'avatar', style: `background:${p.bg}`, 'aria-hidden': 'true' }, p.mono), h('span', null, h('b', null, p.who), ` · ${p.when}`)),
        h('p', null, p.text),
        h('div', { class: 'meta' }, pill(m.level, m.label), n ? `${n} kind${n === 1 ? '' : 's'} of tell` : 'Nothing flagged', m.level >= 3 ? ' · dimmed' : '')
      );
    })
  );

  // ---------- One paragraph of slop, its tells numbered ----------
  const spec = $('specimen');
  const text = spec.textContent;
  const marksSpec = stretches(text, D.detect(text).filter((f) => f.severity === 'slop'));
  const nodes = [];
  let at = 0;
  const items = [];
  const byLabel = new Map(); // one number per kind of tell
  for (const s of marksSpec) {
    const t = s.tells[0];
    let entry = byLabel.get(t.label);
    if (!entry) {
      const n = String(byLabel.size + 1).padStart(2, '0');
      entry = { n, spans: [], li: h('li', null, h('span', null, n), h('span', null, h('b', null, t.label), t.why)) };
      byLabel.set(t.label, entry);
      items.push(entry.li);
      const on = (v) => {
        entry.li.classList.toggle('on', v);
        for (const sp of entry.spans) sp.classList.toggle('on', v);
      };
      entry.li.addEventListener('pointerenter', () => on(true));
      entry.li.addEventListener('pointerleave', () => on(false));
      entry.on = on;
    }
    nodes.push(text.slice(at, s.start), h('sup', null, entry.n));
    const span = h('span', { class: 'tell' }, text.slice(s.start, s.end));
    span.addEventListener('pointerenter', () => entry.on(true));
    span.addEventListener('pointerleave', () => entry.on(false));
    entry.spans.push(span);
    nodes.push(span);
    at = s.end;
  }
  nodes.push(text.slice(at));
  spec.replaceChildren(...nodes);
  $('specimenLegend').replaceChildren(...items);

  // ---------- A hundred dots each ----------
  const dots = (el, n, cls) => el.replaceChildren(...Array.from({ length: 100 }, (_, i) => h('i', { class: i < n ? cls : '' })));
  dots($('dotsHuman'), 1, 'miss');
  dots($('dotsAI'), 72, 'hit');
})();
