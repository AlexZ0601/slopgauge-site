// The slop gauge: a measuring cylinder drawn on a canvas. Its liquid level is the measured score, and
// the letters of flagged phrases fly out of the text and fall into it (js/home.js, js/check.js).
// No dependencies; with reduced motion the level is simply set.
(function (root) {
  'use strict';

  const GRAVITY = 2400; // px/s²
  const MAX_GLYPHS = 110;
  const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

  let colors = null;
  function palette() {
    const s = getComputedStyle(document.documentElement);
    const v = (n) => s.getPropertyValue(n).trim();
    return { ink: v('--ink'), ink3: v('--ink-3'), slop: v('--slop'), slopDeep: v('--slop-deep'), foam: v('--slop-foam'), red: v('--red'), sheen: v('--sheen'), mono: v('--mono') };
  }
  const gauges = new Set();
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    colors = palette();
    for (const g of gauges) g.wake();
  });

  // ---------- Letters in flight: one fixed canvas over the page, page coordinates ----------
  const sky = { canvas: null, ctx: null, glyphs: [], w: 0, h: 0, dpr: 1, running: false, last: 0 };
  function skyFit() {
    sky.dpr = Math.min(2, devicePixelRatio || 1);
    sky.w = document.documentElement.clientWidth;
    sky.h = document.documentElement.clientHeight;
    sky.canvas.width = Math.round(sky.w * sky.dpr);
    sky.canvas.height = Math.round(sky.h * sky.dpr);
    sky.canvas.style.width = `${sky.w}px`;
    sky.canvas.style.height = `${sky.h}px`;
  }
  function skyReady() {
    if (sky.canvas) return;
    const c = document.createElement('canvas');
    c.className = 'sky';
    c.setAttribute('aria-hidden', 'true');
    document.body.append(c);
    sky.canvas = c;
    sky.ctx = c.getContext('2d');
    skyFit();
    addEventListener('resize', skyFit);
  }
  function skyRun() {
    if (sky.running) return;
    sky.running = true;
    sky.last = performance.now();
    requestAnimationFrame(skyFrame);
  }
  function skyFrame(now) {
    const dt = Math.min(0.033, (now - sky.last) / 1000);
    sky.last = now;
    const { ctx, dpr } = sky;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, sky.w, sky.h);
    const sx = scrollX;
    const sy = scrollY;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const keep = [];
    for (const g of sky.glyphs) {
      g.t += dt;
      if (g.phase === 'wait') {
        if (g.t >= g.delay) {
          g.phase = 'fly';
          aim(g);
        }
      } else {
        g.vy += GRAVITY * dt;
        g.x += g.vx * dt;
        g.y += g.vy * dt;
        g.rot += g.vr * dt;
        const m = g.gauge.mouth();
        if (g.phase === 'fly' && g.vy > 0 && g.y >= m.y) g.phase = 'in';
        if (g.phase === 'in') {
          // Inside the glass: walls keep it in, and it slows as it nears the surface.
          g.x += (clamp(g.x, m.x - m.half + 7, m.x + m.half - 7) - g.x) * Math.min(1, dt * 18);
          g.vx *= 0.9;
          g.vr *= 0.96;
          if (g.y >= g.gauge.surfaceAt(g.x)) {
            g.gauge.land(g);
            continue;
          }
        }
        if (g.t - g.delay > 4) {
          g.gauge.land(g, true);
          continue;
        }
      }
      keep.push(g);
      const x = g.x - sx;
      const y = g.y - sy;
      if (x < -40 || y < -40 || x > sky.w + 40 || y > sky.h + 40) continue;
      ctx.save();
      ctx.translate(x + (g.phase === 'wait' ? Math.sin(g.t * 46 + g.seed) * 0.7 : 0), y);
      ctx.rotate(g.rot);
      ctx.font = g.font;
      ctx.fillStyle = g.color;
      ctx.fillText(g.ch, 0, 0);
      ctx.restore();
    }
    sky.glyphs = keep;
    if (keep.length) requestAnimationFrame(skyFrame);
    else {
      sky.running = false;
      ctx.clearRect(0, 0, sky.w, sky.h);
    }
  }
  // A lob from the letter into the gauge's mouth, peaking a little above whichever end is higher.
  function aim(g) {
    const m = g.gauge.mouth();
    const tx = m.x + (Math.random() - 0.5) * m.half * 0.9;
    const ty = m.y - 2;
    const apex = Math.min(g.y, ty) - (36 + Math.random() * 48);
    const up = Math.sqrt(2 * GRAVITY * (g.y - apex));
    const T = up / GRAVITY + Math.sqrt((2 * (ty - apex)) / GRAVITY);
    g.vx = (tx - g.x) / T;
    g.vy = -up;
    g.vr = (Math.random() - 0.5) * 9;
  }

  // ---------- The gauge ----------
  class Gauge {
    /**
     * @param canvas  the <canvas> to draw in (sized by CSS)
     * @param opts    { ticks: [{ at: 0..1, text }], minor: step between small marks, print: [lines on the glass] }
     */
    constructor(canvas, opts = {}) {
      this.cv = canvas;
      this.ctx = canvas.getContext('2d');
      this.ticks = opts.ticks || [];
      this.minor = opts.minor || 0.05;
      this.print = opts.print || [];
      this.fill = 0; // the level the liquid is heading for
      this.shown = 0; // the level drawn
      this.goal = 0;
      this.n = 30;
      this.h = new Float32Array(this.n);
      this.v = new Float32Array(this.n);
      this.drops = [];
      this.bubbles = [];
      this.inflight = new Set();
      this.visible = true;
      this.running = false;
      gauges.add(this);
      new ResizeObserver(() => this.measure()).observe(canvas);
      new IntersectionObserver((e) => {
        this.visible = e[0].isIntersecting;
        if (this.visible) this.wake();
      }).observe(canvas);
      this.measure();
      if (document.fonts) document.fonts.ready.then(() => this.wake());
    }

    measure() {
      const r = this.cv.getBoundingClientRect();
      if (!r.width || !r.height) return;
      const dpr = Math.min(2, devicePixelRatio || 1);
      this.dpr = dpr;
      this.cv.width = Math.round(r.width * dpr);
      this.cv.height = Math.round(r.height * dpr);
      const w = r.width;
      const h = r.height;
      const wide = w / h > 1.3;
      const labelW = this.ticks.length ? (wide ? 92 : clamp(w * 0.44, 70, 104)) : 0;
      const glassW = wide ? w - labelW - 22 : Math.min(w - labelW - 22, 128);
      const gx0 = wide ? 10 : Math.max(12, (w - labelW - glassW) / 2 - 4);
      const rimY = wide ? 10 : 16;
      const foot = wide ? 0 : 20;
      const gy1 = h - foot - (wide ? 8 : 10);
      this.geo = { w, h, wide, gx0, gx1: gx0 + glassW, rimY, gy1, top: rimY + (wide ? 14 : 34), foot };
      this.wake();
    }
    levelY(f) {
      const g = this.geo;
      return g.gy1 - f * (g.gy1 - g.top);
    }
    // Page coordinates of the mouth's middle, and half its width.
    mouth() {
      if (!this.geo) this.measure();
      const r = this.cv.getBoundingClientRect();
      const g = this.geo;
      return { x: r.left + scrollX + (g.gx0 + g.gx1) / 2, y: r.top + scrollY + g.rimY, half: (g.gx1 - g.gx0) / 2 };
    }
    col(localX) {
      const g = this.geo;
      return clamp(Math.round(((localX - g.gx0) / (g.gx1 - g.gx0)) * (this.n - 1)), 0, this.n - 1);
    }
    // Page y of the liquid's surface (or the glass's bottom) under page x.
    surfaceAt(px) {
      const r = this.cv.getBoundingClientRect();
      const lx = px - r.left - scrollX;
      return r.top + scrollY + this.levelY(this.shown) + (this.shown > 0.004 ? this.h[this.col(lx)] : 0) - 2;
    }

    /**
     * Pour: send `items` ({ ch, font, color, x, y in page coordinates, delay }) flying in, and set the
     * level to `goal` (0..1). The level rises as the letters land.
     */
    pour(items, goal) {
      this.measure();
      goal = clamp(goal || 0, 0, 1);
      if (reducedMotion() || !items.length) return this.set(goal);
      if (items.length > MAX_GLYPHS) {
        const step = items.length / MAX_GLYPHS;
        items = Array.from({ length: MAX_GLYPHS }, (_, i) => items[Math.floor(i * step)]);
      }
      this.goal = goal;
      const promised = this.fill + this.pending();
      if (goal < promised) this.drain(goal);
      const vol = Math.max(0, goal - this.fill - this.pending()) / items.length;
      skyReady();
      for (const it of items) {
        const glyph = { ...it, gauge: this, vol, t: 0, phase: 'wait', rot: 0, vr: 0, vx: 0, vy: 0, seed: Math.random() * 9 };
        this.inflight.add(glyph);
        sky.glyphs.push(glyph);
      }
      skyRun();
    }
    // Set the level without letters (it still eases there).
    set(goal) {
      goal = clamp(goal || 0, 0, 1);
      this.goal = goal;
      if (goal < this.fill + this.pending()) this.drain(goal);
      else this.fill = goal - this.pending();
      if (reducedMotion()) this.shown = this.fill;
      this.wake();
    }
    pending() {
      let s = 0;
      for (const g of this.inflight) s += g.vol;
      return s;
    }
    drain(goal) {
      for (const g of this.inflight) g.vol = 0;
      this.fill = Math.min(this.fill, goal);
    }
    land(glyph, lost) {
      this.inflight.delete(glyph);
      this.fill = Math.min(this.goal, this.fill + glyph.vol);
      if (!this.inflight.size) this.fill = this.goal;
      if (!lost && this.geo) {
        const r = this.cv.getBoundingClientRect();
        const lx = glyph.x - r.left - scrollX;
        const i = this.col(lx);
        const hit = clamp(glyph.vy / 140, 2.5, 9);
        this.v[i] += hit;
        if (i > 0) this.v[i - 1] += hit * 0.5;
        if (i < this.n - 1) this.v[i + 1] += hit * 0.5;
        const y = this.levelY(this.shown);
        for (let k = 0; k < 3; k++) this.drops.push({ x: lx, y: y - 2, vx: (Math.random() - 0.5) * 120, vy: -90 - Math.random() * 150, r: 1.3 + Math.random() * 1.4 });
      }
      this.wake();
    }

    wake() {
      if (this.running || !this.visible || !this.geo) return;
      this.running = true;
      this.last = performance.now();
      requestAnimationFrame((t) => this.frame(t));
    }
    frame(now) {
      const dt = Math.min(0.033, (now - this.last) / 1000);
      this.last = now;
      colors ||= palette();
      this.step(dt);
      this.draw();
      const moving = Math.abs(this.fill - this.shown) > 0.0005 || this.drops.length || this.inflight.size || this.h.some((x) => Math.abs(x) > 0.05) || this.v.some((x) => Math.abs(x) > 0.05);
      const bubbling = this.shown > 0.02 && !reducedMotion();
      if (this.visible && (moving || bubbling)) requestAnimationFrame((t) => this.frame(t));
      else this.running = false;
    }
    step(dt) {
      const ease = 1 - Math.exp(-dt * 3.2);
      const before = this.shown;
      this.shown += (this.fill - this.shown) * ease;
      if (Math.abs(this.fill - this.shown) < 0.0005) this.shown = this.fill;
      // A rising or falling level sloshes a little.
      const slosh = (this.shown - before) * 140;
      if (slosh) {
        this.phase = (this.phase || 0) + 0.37;
        for (let i = 0; i < this.n; i++) this.v[i] += slosh * Math.sin((i / (this.n - 1)) * Math.PI * 2 + this.phase);
      }
      // The surface: a row of springs that pull on their neighbours.
      const steps = Math.max(1, Math.round(dt * 60));
      for (let s = 0; s < steps; s++) {
        for (let i = 0; i < this.n; i++) {
          this.v[i] += -0.03 * this.h[i] - 0.045 * this.v[i];
          this.h[i] += this.v[i];
        }
        for (let p = 0; p < 3; p++) {
          for (let i = 0; i < this.n; i++) {
            if (i > 0) {
              const l = 0.2 * (this.h[i] - this.h[i - 1]);
              this.v[i - 1] += l;
              this.h[i - 1] += l * 0.5;
            }
            if (i < this.n - 1) {
              const r = 0.2 * (this.h[i] - this.h[i + 1]);
              this.v[i + 1] += r;
              this.h[i + 1] += r * 0.5;
            }
          }
        }
      }
      const g = this.geo;
      const surf = this.levelY(this.shown);
      this.drops = this.drops.filter((d) => {
        d.vy += GRAVITY * 0.5 * dt;
        d.x += d.vx * dt;
        d.y += d.vy * dt;
        return d.vy < 0 || d.y < surf + this.h[this.col(d.x)];
      });
      if (this.shown > 0.02 && this.bubbles.length < 7 && Math.random() < dt * 2.2 && !reducedMotion()) {
        this.bubbles.push({ x: g.gx0 + 8 + Math.random() * (g.gx1 - g.gx0 - 16), y: g.gy1 - 4, r: 0.9 + Math.random() * 1.8, s: 14 + Math.random() * 26, p: Math.random() * 6 });
      }
      this.bubbles = this.bubbles.filter((b) => {
        b.y -= b.s * dt;
        b.p += dt * 3;
        return b.y > surf + 3;
      });
    }
    draw() {
      const { ctx, dpr } = this;
      const g = this.geo;
      const c = colors;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, g.w, g.h);
      const r = Math.min(10, (g.gx1 - g.gx0) / 5);
      const surf = this.levelY(this.shown);

      // Liquid
      if (this.shown > 0.003) {
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(g.gx0, g.rimY + 2);
        ctx.lineTo(g.gx0, g.gy1 - r);
        ctx.quadraticCurveTo(g.gx0, g.gy1, g.gx0 + r, g.gy1);
        ctx.lineTo(g.gx1 - r, g.gy1);
        ctx.quadraticCurveTo(g.gx1, g.gy1, g.gx1, g.gy1 - r);
        ctx.lineTo(g.gx1, g.rimY + 2);
        ctx.closePath();
        ctx.clip();
        const pts = [];
        for (let i = 0; i < this.n; i++) {
          const x = g.gx0 + (i / (this.n - 1)) * (g.gx1 - g.gx0);
          const men = -3.2 * (Math.exp(-i / 1.1) + Math.exp(-(this.n - 1 - i) / 1.1)); // the meniscus climbs the walls
          pts.push([x, surf + this.h[i] + men]);
        }
        ctx.beginPath();
        ctx.moveTo(pts[0][0], pts[0][1]);
        for (let i = 1; i < pts.length; i++) {
          const [x0, y0] = pts[i - 1];
          const [x1, y1] = pts[i];
          ctx.quadraticCurveTo(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2);
        }
        ctx.lineTo(g.gx1, pts[pts.length - 1][1]);
        ctx.lineTo(g.gx1, g.gy1 + 2);
        ctx.lineTo(g.gx0, g.gy1 + 2);
        ctx.closePath();
        const grad = ctx.createLinearGradient(0, surf, 0, g.gy1);
        grad.addColorStop(0, c.slop);
        grad.addColorStop(1, c.slopDeep);
        ctx.fillStyle = grad;
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(pts[0][0], pts[0][1]);
        for (let i = 1; i < pts.length; i++) {
          const [x0, y0] = pts[i - 1];
          const [x1, y1] = pts[i];
          ctx.quadraticCurveTo(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2);
        }
        ctx.lineTo(g.gx1, pts[pts.length - 1][1]);
        ctx.strokeStyle = c.foam;
        ctx.lineWidth = 1.6;
        ctx.stroke();
        ctx.strokeStyle = c.foam;
        ctx.lineWidth = 1;
        for (const b of this.bubbles) {
          ctx.beginPath();
          ctx.arc(b.x + Math.sin(b.p) * 1.5, b.y, b.r, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.restore();
      }
      ctx.fillStyle = c.slop;
      for (const d of this.drops) {
        ctx.beginPath();
        ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
        ctx.fill();
      }

      // Graduations, on the glass
      ctx.strokeStyle = c.ink;
      ctx.globalAlpha = 0.5;
      ctx.lineWidth = 1;
      ctx.beginPath();
      const majors = new Set(this.ticks.map((t) => Math.round(t.at * 1000)));
      for (let f = 0; f <= 1.0001; f += this.minor) {
        const y = Math.round(this.levelY(f)) + 0.5;
        const major = majors.has(Math.round(f * 1000)) || Math.abs(f - 1) < 1e-6;
        ctx.moveTo(g.gx0 + 1, y);
        ctx.lineTo(g.gx0 + (major ? 16 : Math.abs((f * 100) % 10) < 1e-6 ? 10 : 6), y);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;

      // The glass
      ctx.strokeStyle = c.ink;
      ctx.lineWidth = 1.6;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(g.gx0 - 6, g.rimY - 3); // spout
      ctx.quadraticCurveTo(g.gx0, g.rimY - 1, g.gx0, g.rimY + 8);
      ctx.lineTo(g.gx0, g.gy1 - r);
      ctx.quadraticCurveTo(g.gx0, g.gy1, g.gx0 + r, g.gy1);
      ctx.lineTo(g.gx1 - r, g.gy1);
      ctx.quadraticCurveTo(g.gx1, g.gy1, g.gx1, g.gy1 - r);
      ctx.lineTo(g.gx1, g.rimY + 3);
      ctx.quadraticCurveTo(g.gx1, g.rimY, g.gx1 + 4, g.rimY - 1); // lip
      ctx.stroke();
      if (g.foot) {
        const fx0 = g.gx0 - 16;
        const fx1 = g.gx1 + 16;
        ctx.beginPath();
        ctx.moveTo(g.gx0 + 6, g.gy1);
        ctx.lineTo(g.gx0 + 2, g.gy1 + g.foot - 7);
        ctx.lineTo(fx0, g.gy1 + g.foot - 5);
        ctx.lineTo(fx0, g.gy1 + g.foot);
        ctx.lineTo(fx1, g.gy1 + g.foot);
        ctx.lineTo(fx1, g.gy1 + g.foot - 5);
        ctx.lineTo(g.gx1 - 2, g.gy1 + g.foot - 7);
        ctx.lineTo(g.gx1 - 6, g.gy1);
        ctx.stroke();
      }
      // Sheen
      ctx.strokeStyle = c.sheen;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(g.gx1 - 8, g.rimY + 16);
      ctx.lineTo(g.gx1 - 8, g.gy1 - 14);
      ctx.stroke();

      // Printing on the glass
      ctx.fillStyle = c.ink;
      ctx.globalAlpha = 0.55;
      ctx.font = `500 8.5px ${c.mono}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      if (!g.wide) this.print.forEach((line, i) => ctx.fillText(line, (g.gx0 + g.gx1) / 2 + 4, g.rimY + 14 + i * 11));
      ctx.globalAlpha = 1;

      // Tick labels, and the red pointer at the level
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      const lx = g.gx1 + 14;
      const sorted = [...this.ticks].sort((a, b) => a.at - b.at);
      let current = -1;
      sorted.forEach((t, i) => {
        if (this.shown >= t.at - 0.0005) current = i;
      });
      sorted.forEach((t, i) => {
        const y = Math.round(this.levelY(t.at)) + 0.5;
        ctx.strokeStyle = c.ink;
        ctx.globalAlpha = 0.5;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(g.gx1 + 3, y);
        ctx.lineTo(g.gx1 + 9, y);
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.fillStyle = i === current && this.shown > 0.003 ? c.ink : c.ink3;
        ctx.font = `${i === current && this.shown > 0.003 ? 700 : 500} 10px ${c.mono}`;
        ctx.fillText(t.text.toUpperCase(), lx, y);
      });
      if (this.shown > 0.003 || this.goal > 0) {
        const y = surf;
        ctx.fillStyle = c.red;
        ctx.beginPath();
        ctx.moveTo(g.gx1 + 2, y);
        ctx.lineTo(g.gx1 + 9, y - 4.5);
        ctx.lineTo(g.gx1 + 9, y + 4.5);
        ctx.closePath();
        ctx.fill();
      }
    }
  }
  // The letters of a span of text, as pour() items: one per visible character, in page coordinates.
  function lettersOf(el, { delay = 0, gap = 0.018, color } = {}) {
    const cs = getComputedStyle(el);
    const font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    const ink = color || cs.color;
    const out = [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    let k = 0;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const s = node.data;
      for (let i = 0; i < s.length; i++) {
        if (/\s/.test(s[i])) continue;
        range.setStart(node, i);
        range.setEnd(node, i + 1);
        const r = range.getBoundingClientRect();
        if (!r.width) continue;
        out.push({ ch: s[i], font, color: ink, x: r.left + r.width / 2 + scrollX, y: r.top + r.height / 2 + scrollY, delay: delay + k++ * gap });
      }
    }
    return out;
  }

  root.SlopgaugeGauge = { Gauge, lettersOf };
})(window);
