// The "Check a class" page: reads the essays (files or pasted), measures each with js/report.js,
// ranks them, and shows the groups js/class.js finds. Everything stays in this tab.
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const R = window.SlopgaugeReport;
  const O = window.SlopgaugeOdds;
  const C = window.SlopgaugeClass;
  const VERDICTS = { human: ['p0', 0, 'Likely human'], mixed: ['p2', 2, 'Possibly AI'], ai: ['p4', 4, 'Likely AI'] };
  const essays = []; // { name, text }
  let last = null; // the latest results, for the spreadsheet and the printout

  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === 'class') el.className = v;
      else el.setAttribute(k, v);
    }
    for (const k of kids) if (k != null && k !== false) el.append(k); // text only, never HTML
    return el;
  }
  const pill = (v) => {
    const [cls, level, text] = VERDICTS[v];
    return h('span', { class: `pill ${cls}` }, level ? h('span', { class: 'bars' }, ...[1, 2, 3, 4].map((i) => h('i', { class: i <= level ? 'on' : '' }))) : null, text);
  };

  $('kind').replaceChildren(...O.kinds.map(([k, label]) => h('option', { value: k }, k === 'all' ? 'Something else' : label)));
  try {
    $('kind').value = localStorage.getItem('slopgauge.kind') || 'school';
  } catch (_) {
    $('kind').value = 'school';
  }
  $('kind').addEventListener('change', () => {
    try {
      localStorage.setItem('slopgauge.kind', $('kind').value);
    } catch (_) {}
  });

  const pasted = () =>
    $('paste')
      .value.split(/\n\s*-{3,}\s*\n/)
      .map((t) => t.trim())
      .filter(Boolean)
      .map((text, i) => ({ name: `Pasted essay ${i + 1}`, text }));
  const all = () => [...essays, ...pasted()];

  function renderList() {
    const items = all();
    $('list').replaceChildren(
      ...essays.map((e, i) => {
        const x = h('button', { type: 'button', class: 'textlink', 'aria-label': `Remove ${e.name}` }, 'Remove');
        x.addEventListener('click', () => {
          essays.splice(i, 1);
          renderList();
        });
        return h('li', null, h('span', null, e.name), h('span', { class: 'label' }, `${R.words(e.text).toLocaleString()} words`), x);
      })
    );
    $('count').textContent = items.length ? `${items.length} essay${items.length === 1 ? '' : 's'}` : 'No essays yet';
  }
  $('paste').addEventListener('input', renderList);

  async function addFiles(files) {
    if (!files.length) return;
    $('count').textContent = `Reading ${files.length} file${files.length === 1 ? '' : 's'}…`;
    await import('./vendor/files-runtime.js');
    for (const f of files) {
      try {
        const r = await window.SlopgaugeFiles.readFile(f);
        if (r.text.trim()) essays.push({ name: r.name.replace(/\.(docx|pdf|txt|md)$/i, ''), text: r.text });
      } catch (e) {
        essays.push({ name: `${f.name} (couldn't read: ${(e && e.message) || e})`, text: '' });
      }
    }
    renderList();
  }
  $('files').addEventListener('change', () => addFiles([...$('files').files]));
  const drop = $('form');
  drop.addEventListener('dragover', (e) => {
    if ([...e.dataTransfer.types].includes('Files')) {
      e.preventDefault();
      drop.classList.add('drop');
    }
  });
  drop.addEventListener('dragleave', () => drop.classList.remove('drop'));
  drop.addEventListener('drop', (e) => {
    if (!e.dataTransfer.files.length) return;
    e.preventDefault();
    drop.classList.remove('drop');
    addFiles([...e.dataTransfer.files]);
  });

  function run() {
    const items = all().filter((e) => e.text.trim());
    if (!items.length) return;
    const kind = $('kind').value;
    const results = items.map((e) => ({ ...e, r: R.analyze(e.text, kind) }));
    const eligible = results.map((x) => !x.r.tooShort && x.r.verdict !== 'human');
    const { groups, pairs } = C.overlaps(
      results.map((x) => x.text),
      { eligible }
    );
    const order = results.map((_, i) => i).sort((a, b) => (results[b].r.docLogit ?? -99) - (results[a].r.docLogit ?? -99));
    const likely = results.filter((x) => !x.r.tooShort && x.r.verdict === 'ai').length;
    const possibly = results.filter((x) => !x.r.tooShort && x.r.verdict === 'mixed').length;
    $('summary').textContent = `${results.length} essays: ${likely} read as Likely AI-written, ${possibly} as Possibly. ${groups.length ? `${groups.length} group${groups.length === 1 ? '' : 's'} of essays read as AI and share unusual wording.` : 'No essays that read as AI share unusual wording.'}`;
    $('groups').replaceChildren(
      ...groups.map((g, gi) => {
        const ps = pairs.filter((p) => g.includes(p.a) && g.includes(p.b));
        const phrases = [...new Set(ps.flatMap((p) => p.shared))].slice(0, 5);
        return h(
          'div',
          { class: 'group' },
          h('span', { class: 'label' }, `Group ${gi + 1} · shared wording`),
          h('p', null, h('b', null, g.map((i) => results[i].name).join(', '))),
          h('ul', null, ...phrases.map((t) => h('li', null, `“${t}”`)))
        );
      })
    );
    const grouped = new Map();
    groups.forEach((g, gi) => g.forEach((i) => grouped.set(i, gi + 1)));
    last = { results, order, grouped, kind };
    $('rows').replaceChildren(
      ...order.map((i, rank) => {
        const x = results[i];
        const share = x.r.tooShort ? null : x.r.aiShare;
        const tells = x.r.findings.filter((f) => f.severity === 'slop').length;
        const link = h('a', { href: `check.html#text=${encodeURIComponent(x.text.slice(0, 60000))}`, target: '_blank', rel: 'noopener' }, 'Full report ↗');
        return h(
          'tr',
          null,
          h('td', { class: 'label' }, String(rank + 1)),
          h('td', null, x.name, grouped.has(i) ? h('span', { class: 'tag' }, `Group ${grouped.get(i)}`) : null),
          h('td', null, x.r.words.toLocaleString()),
          h('td', null, share === null ? '–' : h('span', { class: 'meter-cell' }, h('span', { class: 'fillbar' }, h('i', { style: `width:${Math.round(share * 100)}%` })), `${Math.round(share * 100)}%`)),
          h('td', null, x.r.tooShort ? h('span', { class: 'pill p0' }, 'Too short') : pill(x.r.verdict)),
          h('td', null, String(tells)),
          h('td', null, link)
        );
      })
    );
    $('results').hidden = false;
    $('results').scrollIntoView({ block: 'start' });
  }
  $('form').addEventListener('submit', (e) => {
    e.preventDefault();
    run();
  });

  // The ranking as a spreadsheet, for a gradebook or a record. Cells that a spreadsheet would run
  // as a formula are quoted as text.
  const cell = (v) => {
    let t = String(v ?? '');
    if (/^[=+\-@\t\r]/.test(t)) t = `'${t}`;
    return /[",\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  $('csv').addEventListener('click', () => {
    if (!last) return;
    const head = ['Rank', 'Essay', 'Words', 'Reads as AI (%)', 'Verdict', 'Named tells', 'Group'];
    const rows = last.order.map((i, rank) => {
      const x = last.results[i];
      return [
        rank + 1,
        x.name,
        x.r.words,
        x.r.tooShort ? '' : Math.round(x.r.aiShare * 100),
        x.r.tooShort ? 'Too short' : VERDICTS[x.r.verdict][2],
        x.r.findings.filter((f) => f.severity === 'slop').length,
        last.grouped.has(i) ? `Group ${last.grouped.get(i)}` : '',
      ];
    });
    const csv = '\ufeff' + [head, ...rows].map((r) => r.map(cell).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = h('a', { href: url, download: `slopgauge-class-${new Date().toISOString().slice(0, 10)}.csv` });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  $('print').addEventListener('click', () => {
    if (!last) return;
    const kind = $('kind').selectedOptions[0];
    $('printHead').textContent = `Slopgauge class report · ${new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })} · ${kind ? kind.textContent : ''} · ${last.results.length} essays · slopgauge.com`;
    print();
  });
})();
