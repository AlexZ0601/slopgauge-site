// "Drag the gauge": five posts, one at each of the meter's levels, each measured on this page by the
// extension's detector. Dragging the liquid moves through them. The level follows the pointer 1:1
// from where it was grabbed, resists past empty and full, and on release is thrown toward where the
// gesture was heading, then springs to the nearest post's reading at the pointer's own speed.
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const canvas = $('levelGauge');
  if (!canvas) return;
  const { Gauge } = window.SlopgaugeGauge;
  const { measure, pill } = window.SlopgaugeHome;

  const POSTS = [
    { who: 'Sam Reyes', role: 'Weekend woodworker · 4h', mono: 'SR', bg: '#7a5a46', text: `Finally finished the bookshelf I started in March. It leans a little to the left and one shelf is upside down, but it holds all my cookbooks and I built it myself. Next project: fixing the shelf.` },
    { who: 'Jordan Ellis', role: 'Operations Lead · 1d', mono: 'JE', bg: '#46607a', text: `Our quarterly offsite was a reminder of how much a team can accomplish when everyone is aligned. We tackled the roadmap, celebrated some wins, and set ambitious goals for Q3. Huge thanks to everyone who helped plan it.` },
    { who: 'Avery Lin', role: 'Engineering Manager · 2d', mono: 'AL', bg: '#5d6b4f', text: `Leadership isn't about having all the answers. It's about asking the right questions, listening deeply, and creating space for your team to grow. The best leaders I've worked with made everyone around them better.` },
    { who: 'Chris Morgan', role: 'Sales Director · 3h', mono: 'CM', bg: '#6a5a7a', text: `Networking isn't just about collecting contacts. It's about building genuine relationships. Take the time to listen, offer value first, and follow up. The connections you nurture today can open doors tomorrow.` },
    { who: 'Taylor Brooks', role: 'Career Coach · 6h', mono: 'TB', bg: '#7a4646', text: `In a world of constant change, adaptability is the most valuable skill. The professionals who thrive are those who embrace new challenges, learn continuously, and stay curious. Growth happens outside your comfort zone. Agree?` },
  ];
  const READS = ['Plain, specific and a little odd. Nothing in it reads as generated.', 'No named tells, but the word choice leans smooth and corporate.', 'One stock move (“isn’t about… it’s about”) and a template’s rhythm.', 'Generic advice in the exact shape AI posts take.', 'Every line is stock, and it ends by fishing for comments.'];
  const measured = POSTS.map((p) => ({ ...p, m: measure(p.text) }));
  // Where each post sits in the glass: its own reading, kept inside its band so the five stay in order.
  const stops = measured.map((p, i) => Math.min(i * 0.2 + 0.185, Math.max(i * 0.2 + 0.035, p.m.f)));

  const gauge = new Gauge(canvas, {
    ticks: [{ at: 0, text: 'No slop' }, { at: 0.2, text: 'A little' }, { at: 0.4, text: 'Some' }, { at: 0.6, text: 'Heavy' }, { at: 0.8, text: 'Pure slop' }],
    minor: 0.05,
    print: ['SLOPGAUGE', 'DRAG ME'],
    handle: true,
  });

  const h = (tag, attrs, ...kids) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === 'class') el.className = v;
      else el.setAttribute(k, v);
    }
    for (const k of kids) if (k != null && k !== false) el.append(k);
    return el;
  };

  // The post for a band, with its tells underlined.
  let shown = -1;
  function show(i) {
    if (i === shown) return;
    shown = i;
    const p = measured[i];
    const slop = p.m.slop.filter((f) => f.end - f.start <= 70).sort((a, b) => a.start - b.start);
    const nodes = [];
    let at = 0;
    for (const f of slop) {
      if (f.start < at) continue;
      nodes.push(p.text.slice(at, f.start), h('span', { class: 'tell', title: `${f.label}: ${f.why}` }, p.text.slice(f.start, f.end)));
      at = f.end;
    }
    nodes.push(p.text.slice(at));
    const kinds = new Set(p.m.slop.map((f) => f.label)).size;
    const card = $('sampleCard');
    $('sampleAvatar').textContent = p.mono;
    $('sampleAvatar').style.background = p.bg;
    $('sampleName').textContent = p.who;
    $('sampleRole').textContent = p.role;
    $('sampleText').replaceChildren(...nodes);
    $('sampleMeter').replaceChildren(pill(p.m.level, p.m.label), h('span', null, kinds ? `${kinds} kind${kinds === 1 ? '' : 's'} of tell` : 'No named tells'));
    $('sampleWhy').textContent = READS[i];
    card.classList.remove('swap');
    void card.offsetWidth;
    card.classList.add('swap');
    canvas.setAttribute('aria-valuenow', String(i));
    canvas.setAttribute('aria-valuetext', `${p.m.label}: post by ${p.who}`);
  }
  const bandOf = (f) => Math.max(0, Math.min(4, Math.floor(f / 0.2 + 1e-6)));
  const nearest = (f) => stops.reduce((best, s, i) => (Math.abs(s - f) < Math.abs(stops[best] - f) ? i : best), 0);

  // Past empty or full, the level follows less and less: real things slow before they stop.
  const rubber = (over, dim, c = 0.55) => (over * dim * c) / (dim + c * Math.abs(over));
  function banded(f) {
    const span = gauge.span();
    if (f < 0) return -rubber(-f * span, span) / span;
    if (f > 1) return 1 + rubber((f - 1) * span, span) / span;
    return f;
  }
  // Apple's momentum projection: where a flick at this speed would come to rest.
  const project = (v, rate = 0.99) => ((v / 1000) * rate) / (1 - rate);

  let drag = null;
  canvas.addEventListener('pointerdown', (e) => {
    if (e.button) return;
    canvas.setPointerCapture(e.pointerId);
    // Start from the level as drawn right now, so a moving level can be caught mid-flight.
    drag = { id: e.pointerId, y0: e.clientY, x0: e.clientX, f0: gauge.shown, moved: false, hist: [{ t: e.timeStamp, y: e.clientY }] };
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    if (!drag.moved && Math.abs(e.clientY - drag.y0) < 4) return; // a little hysteresis before it's a drag
    if (!drag.moved) {
      drag.moved = true;
      drag.y0 = e.clientY; // no jump when the drag begins
      drag.f0 = gauge.shown;
      canvas.classList.add('dragging');
    }
    const f = banded(drag.f0 + (drag.y0 - e.clientY) / gauge.span());
    gauge.hold(f);
    show(bandOf(Math.max(0, Math.min(0.999, f))));
    drag.hist.push({ t: e.timeStamp, y: e.clientY });
    while (drag.hist.length > 2 && e.timeStamp - drag.hist[0].t > 100) drag.hist.shift();
  });
  function end(e) {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag;
    drag = null;
    canvas.classList.remove('dragging');
    if (!d.moved) return tap(e);
    const a = d.hist[0];
    const b = d.hist[d.hist.length - 1];
    const dt = (b.t - a.t) / 1000;
    const vPx = dt > 0.005 && e.timeStamp - b.t < 80 ? (a.y - b.y) / dt : 0; // px/s, upward positive
    const span = gauge.span();
    const i = nearest(Math.max(0, Math.min(1, gauge.shown + project(vPx) / span)));
    gauge.release(stops[i], vPx / span);
    show(i);
  }
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);

  // A tap picks a level: on the glass, the band under the finger; on a label, that label's band.
  function tap(e) {
    const r = canvas.getBoundingClientRect();
    const g = gauge.geo;
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    let i;
    if (x > g.gx1 + 10) {
      const ys = [0, 0.2, 0.4, 0.6, 0.8].map((t) => Math.abs(gauge.levelY(t) - y));
      i = ys.indexOf(Math.min(...ys));
    } else i = bandOf(Math.max(0, Math.min(0.999, (g.gy1 - y) / gauge.span())));
    go(i);
  }
  function go(i) {
    gauge.release(stops[i], 0);
    show(i);
  }
  canvas.addEventListener('keydown', (e) => {
    const step = { ArrowUp: 1, ArrowRight: 1, PageUp: 1, ArrowDown: -1, ArrowLeft: -1, PageDown: -1 }[e.key];
    if (step) go(Math.max(0, Math.min(4, shown + step)));
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(4);
    else return;
    e.preventDefault();
  });

  // Start in the middle, so there's liquid to grab; fill when the section comes into view.
  show(2);
  let started = false;
  new IntersectionObserver((entries, io) => {
    if (!entries[0].isIntersecting || started) return;
    started = true;
    io.disconnect();
    setTimeout(() => gauge.release(stops[2], 0), 250);
  }, { threshold: 0.4 }).observe(canvas);
})();
