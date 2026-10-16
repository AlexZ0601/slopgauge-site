// The "Check a class" page: reads the essays (files or pasted), measures each with js/report.js,
// ranks them, and shows the groups js/class.js finds. With Pro (js/pro.js), a class can be saved on
// this computer (js/history.js), and each new essay is compared with that student's own earlier
// essays by the voice model. Everything stays in this browser.
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const R = window.SlopgaugeReport;
  const O = window.SlopgaugeOdds;
  const C = window.SlopgaugeClass;
  const P = window.SlopgaugePro;
  const H = window.SlopgaugeHistory;
  const VERDICTS = { human: ['p0', 0, 'Likely human'], mixed: ['p2', 2, 'Possibly AI'], ai: ['p4', 4, 'Likely AI'] };
  const VOICE = { same: ['same', 'Sounds like them'], unsure: ['unsure', 'Hard to tell'], diff: ['diff', 'Doesn’t sound like them'] };
  const essays = []; // { name, text, student }
  const pastedNames = []; // names typed for pasted essays, by position
  let last = null; // the latest results, for saving, the spreadsheet and the printout
  let pro = false;
  let cls = null; // the saved class this assignment belongs to (Pro)

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
  const voicePill = (v) => h('span', { class: `vpill ${VOICE[v][0]}` }, VOICE[v][1]);
  const sigmoid = (z) => 1 / (1 + Math.exp(-z));
  const day = (t) => new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

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

  // ---------- Who wrote it: guessed from the file name, editable ----------
  const looksLikeName = (s) => /^\p{Lu}[\p{L}'’.-]*(?:\s+\p{Lu}[\p{L}'’.-]*){1,3}$/u.test(s.trim());
  function studentOf(file) {
    const base = file.replace(/\.(docx|pdf|txt|md)$/i, '');
    // Canvas downloads: "doejane_12345_67890_essay.docx"
    const canvas = /^([a-z]+)_\d{3,}_\d{3,}_/i.exec(base);
    if (canvas) return canvas[1];
    // Google Classroom copies: "Jane Doe - Essay 2"; other habits: "Essay 2 - Jane Doe", "Essay 2_Jane Doe"
    const parts = base.split(/\s*(?:\s[-–—]\s|_)\s*/).map((p) => p.trim());
    return parts.find(looksLikeName) || '';
  }
  const pasted = () =>
    $('paste')
      .value.split(/\n\s*-{3,}\s*\n/)
      .map((t) => t.trim())
      .filter(Boolean)
      .map((text, i) => {
        const first = /^(?:name:\s*)?([^\n]{2,60})\n/i.exec(text);
        const guess = first && (/^name:/i.test(text) || looksLikeName(first[1])) ? first[1].trim() : '';
        return { name: `Pasted essay ${i + 1}`, text, student: pastedNames[i] ?? guess, pastedAt: i };
      });
  const all = () => [...essays, ...pasted()];

  function renderList() {
    const items = all();
    const naming = pro && cls;
    const rows = items.map((e, i) => {
      const kids = [h('span', null, e.name)];
      if (naming) {
        const input = h('input', { class: 'who', type: 'text', value: e.student || '', placeholder: 'Student’s name', 'aria-label': `Student who wrote ${e.name}` });
        input.addEventListener('input', () => {
          if (e.pastedAt != null) pastedNames[e.pastedAt] = input.value;
          else e.student = input.value;
        });
        kids.push(input);
      }
      kids.push(h('span', { class: 'label' }, `${R.words(e.text).toLocaleString()} words`));
      if (e.pastedAt == null) {
        const x = h('button', { type: 'button', class: 'textlink', 'aria-label': `Remove ${e.name}` }, 'Remove');
        x.addEventListener('click', () => {
          essays.splice(i, 1);
          renderList();
        });
        kids.push(x);
      }
      return h('li', null, ...kids);
    });
    // Pasted essays only need a row when there are names to give them.
    $('list').replaceChildren(...rows.filter((_, i) => naming || items[i].pastedAt == null));
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
        if (r.text.trim()) essays.push({ name: r.name.replace(/\.(docx|pdf|txt|md)$/i, ''), text: r.text, student: studentOf(r.name) });
      } catch (e) {
        essays.push({ name: `${f.name} (couldn't read: ${(e && e.message) || e})`, text: '', student: '' });
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
    const comparing = pro && cls;
    last = { results, order, grouped, kind, cls: comparing ? cls.id : null, voice: new Map(), saved: false };
    $('voiceHead').hidden = !comparing;
    $('rows').replaceChildren(
      ...order.map((i, rank) => {
        const x = results[i];
        const share = x.r.tooShort ? null : x.r.aiShare;
        const tells = x.r.findings.filter((f) => f.severity === 'slop').length;
        const link = h('a', { href: `check.html#text=${encodeURIComponent(x.text.slice(0, 60000))}`, target: '_blank', rel: 'noopener' }, 'Full report ↗');
        x.voiceCell = comparing ? h('td', { class: 'voice-cell' }, x.student ? h('span', { class: 'label' }, 'Waiting…') : h('span', { class: 'label' }, 'Add a name to compare')) : null;
        return h(
          'tr',
          null,
          h('td', { class: 'label' }, String(rank + 1)),
          h('td', null, x.student && x.student !== x.name ? h('span', null, h('b', null, x.student), h('span', { class: 'sub' }, x.name)) : x.name, grouped.has(i) ? h('span', { class: 'tag' }, `Group ${grouped.get(i)}`) : null),
          h('td', null, x.r.words.toLocaleString()),
          h('td', null, share === null ? '–' : h('span', { class: 'meter-cell' }, h('span', { class: 'fillbar' }, h('i', { style: `width:${Math.round(share * 100)}%` })), `${Math.round(share * 100)}%`)),
          h('td', null, x.r.tooShort ? h('span', { class: 'pill p0' }, 'Too short') : pill(x.r.verdict)),
          x.voiceCell,
          h('td', null, String(tells)),
          h('td', null, link)
        );
      })
    );
    $('save').hidden = !comparing;
    $('save').disabled = false;
    $('save').textContent = comparing ? `Save to ${cls.name}` : 'Save';
    $('assignWrap').hidden = !comparing;
    $('saved').textContent = '';
    $('results').hidden = false;
    $('results').scrollIntoView({ block: 'start' });
    if (comparing) compareWithEarlier(last, cls);
  }
  $('form').addEventListener('submit', (e) => {
    e.preventDefault();
    run();
  });

  // ---------- Pro: does each essay sound like the student's own earlier essays? ----------
  async function compareWithEarlier(run, saved) {
    const todo = run.results.filter((x) => x.student && saved.students[H.keyOf(x.student)]);
    for (const x of run.results) {
      if (x.student && !saved.students[H.keyOf(x.student)]) x.voiceCell.replaceChildren(h('span', { class: 'label' }, 'First essay in this class'));
    }
    if (!todo.length) return;
    const status = $('voiceStatus');
    status.hidden = false;
    status.textContent = 'Loading the style model (70 MB, once)…';
    try {
      await import('./vendor/voice-runtime.js');
      const V = window.SlopgaugeVoiceNet;
      const VC = window.SlopgaugeVoiceCal;
      await V.load((f) => (status.textContent = `Loading the style model… ${Math.round(f * 100)}%`));
      let n = 0;
      for (const x of todo) {
        if (last !== run) return; // a newer run took over
        status.textContent = `Comparing with their earlier essays… ${++n} of ${todo.length}`;
        // Their own writing: earlier essays in this class that read as human-written, the latest six.
        const prior = saved.students[H.keyOf(x.student)].essays.filter((e) => !e.tooShort && e.verdict !== 'ai' && e.text !== x.text).slice(-6).map((e) => e.text);
        if (!prior.length || x.r.tooShort) {
          x.voiceCell.replaceChildren(h('span', { class: 'label' }, x.r.tooShort ? 'Too short' : 'No earlier essays that read as theirs'));
          continue;
        }
        const sim = V.cosine(await V.embed(prior), await V.embed([x.text]));
        const p = sigmoid(VC.whole[0] * sim + VC.whole[1]);
        const v = p >= VC.sameAbove ? 'same' : p < VC.diffBelow ? 'diff' : 'unsure';
        run.voice.set(x, v);
        x.voiceCell.replaceChildren(voicePill(v), h('span', { class: 'sub' }, `vs ${prior.length} earlier essay${prior.length === 1 ? '' : 's'}`));
      }
      status.textContent = `Compared with each student’s earlier essays that read as their own. In testing, a writer’s own text was called “Doesn’t sound like them” ${Math.round(VC.rates.ownDiff * 100)} times in 100.`;
    } catch (e) {
      status.textContent = `The style model couldn't run in this browser (${(e && e.message) || e}).`;
    }
  }

  $('save').addEventListener('click', async () => {
    if (!last || !last.cls) return;
    const named = last.results.filter((x) => x.student && x.student.trim());
    if (!named.length) {
      $('saved').textContent = 'Give the essays their students’ names first, in the list above.';
      return;
    }
    $('save').disabled = true;
    try {
      cls = await H.addAssignment(
        last.cls,
        $('assign').value,
        named.map((x) => ({ student: x.student, text: x.text, words: x.r.words, aiShare: x.r.tooShort ? null : x.r.aiShare, verdict: x.r.tooShort ? null : x.r.verdict, tooShort: x.r.tooShort, voice: last.voice.get(x) || null }))
      );
      last.saved = true;
      const skipped = last.results.length - named.length;
      $('saved').textContent = `Saved ${named.length} essay${named.length === 1 ? '' : 's'} to ${cls.name}${skipped ? `; ${skipped} without a name were left out` : ''}. They stay on this computer.`;
      $('save').textContent = 'Saved';
      $('assign').value = '';
      renderHistory();
    } catch (e) {
      $('save').disabled = false;
      $('saved').textContent = `Couldn't save: ${(e && e.message) || e}`;
    }
  });

  // ---------- Pro: the class, every student and every assignment ----------
  function renderHistory() {
    const box = $('history');
    if (!pro || !cls) {
      box.hidden = true;
      return;
    }
    box.hidden = false;
    $('historyTitle').textContent = cls.name;
    const students = Object.values(cls.students).sort((a, b) => a.name.localeCompare(b.name));
    const assigns = cls.assignments.slice(-8);
    $('historyNote').textContent = students.length
      ? `${students.length} student${students.length === 1 ? '' : 's'}, ${cls.assignments.length} assignment${cls.assignments.length === 1 ? '' : 's'}. Kept in this browser on this computer only.`
      : 'No essays saved yet. Measure an assignment, then save it here. Next time, each new essay is compared with that student’s earlier ones.';
    $('historyTable').hidden = !students.length;
    $('historyHead').replaceChildren(h('th', null, 'Student'), ...assigns.map((a) => h('th', null, a.name, h('span', { class: 'sub' }, day(a.date)))));
    $('historyRows').replaceChildren(
      ...students.map((s) =>
        h(
          'tr',
          null,
          h('td', null, s.name),
          ...assigns.map((a) => {
            const e = s.essays.find((x) => x.assignment === a.id);
            if (!e) return h('td', { class: 'label' }, '–');
            const text = e.tooShort ? 'Short' : `${Math.round(e.aiShare * 100)}%`;
            return h('td', { class: `hcell ${e.verdict || ''}${e.voice === 'diff' ? ' vdiff' : ''}`, title: `${e.tooShort ? 'Too short to measure' : VERDICTS[e.verdict][2]}${e.voice ? ` · ${VOICE[e.voice][1]}` : ''}` }, text);
          })
        )
      )
    );
  }
  $('historyCsv').addEventListener('click', () => {
    if (!cls) return;
    const head = ['Student', 'Assignment', 'Date', 'Words', 'Reads as AI (%)', 'Verdict', 'Like their earlier essays'];
    const rows = [];
    for (const s of Object.values(cls.students).sort((a, b) => a.name.localeCompare(b.name)))
      for (const e of s.essays) {
        const a = cls.assignments.find((x) => x.id === e.assignment);
        rows.push([s.name, a ? a.name : '', new Date(e.date).toISOString().slice(0, 10), e.words, e.tooShort ? '' : Math.round(e.aiShare * 100), e.tooShort ? 'Too short' : VERDICTS[e.verdict][2], e.voice ? VOICE[e.voice][1] : '']);
      }
    download(`slopgauge-${cls.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-history.csv`, [head, ...rows]);
  });
  $('historyDelete').addEventListener('click', async () => {
    if (!cls) return;
    // Deleting a class can't be undone: its essays exist nowhere else.
    if (!confirm(`Delete ${cls.name} and every essay saved in it from this computer? This can’t be undone.`)) return;
    await H.remove(cls.id);
    cls = null;
    await loadClasses('');
  });

  // ---------- Pro: picking a class ----------
  async function loadClasses(select) {
    const list = await H.list();
    $('classSel').replaceChildren(h('option', { value: '' }, 'Don’t save'), ...list.map((c) => h('option', { value: c.id }, c.name)), h('option', { value: 'new' }, 'New class…'));
    $('classSel').value = select && list.some((c) => c.id === select) ? select : '';
    cls = list.find((c) => c.id === $('classSel').value) || null;
    $('newClass').hidden = true;
    renderList();
    renderHistory();
  }
  $('classSel').addEventListener('change', async () => {
    const v = $('classSel').value;
    if (v === 'new') {
      $('newClass').hidden = false;
      $('newName').focus();
      return;
    }
    $('newClass').hidden = true;
    cls = v ? await H.get(v) : null;
    try {
      localStorage.setItem('slopgauge.class', v);
    } catch (_) {}
    renderList();
    renderHistory();
  });
  $('newClass').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = $('newName').value.trim();
    if (!name) return $('newName').focus();
    const c = await H.create(name);
    $('newName').value = '';
    try {
      localStorage.setItem('slopgauge.class', c.id);
    } catch (_) {}
    await loadClasses(c.id);
  });

  async function setPro(on) {
    pro = on;
    $('proOn').hidden = !on;
    $('proOff').hidden = on;
    if (on) {
      let remembered = '';
      try {
        remembered = localStorage.getItem('slopgauge.class') || '';
      } catch (_) {}
      await loadClasses(remembered);
    } else {
      cls = null;
      renderList();
      renderHistory();
    }
  }
  $('proOff').querySelector('a').href = 'pricing.html#pro';
  P.active().then(setPro);

  // ---------- The ranking as a spreadsheet, and on paper ----------
  // Cells that a spreadsheet would run as a formula are quoted as text.
  const cell = (v) => {
    let t = String(v ?? '');
    if (/^[=+\-@\t\r]/.test(t)) t = `'${t}`;
    return /[",\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  function download(name, rows) {
    const csv = '﻿' + rows.map((r) => r.map(cell).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = h('a', { href: url, download: name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  $('csv').addEventListener('click', () => {
    if (!last) return;
    const voice = !!last.cls;
    const head = ['Rank', 'Essay', 'Student', 'Words', 'Reads as AI (%)', 'Verdict', ...(voice ? ['Like their earlier essays'] : []), 'Named tells', 'Group'];
    const rows = last.order.map((i, rank) => {
      const x = last.results[i];
      const v = last.voice.get(x);
      return [
        rank + 1,
        x.name,
        x.student || '',
        x.r.words,
        x.r.tooShort ? '' : Math.round(x.r.aiShare * 100),
        x.r.tooShort ? 'Too short' : VERDICTS[x.r.verdict][2],
        ...(voice ? [v ? VOICE[v][1] : ''] : []),
        x.r.findings.filter((f) => f.severity === 'slop').length,
        last.grouped.has(i) ? `Group ${last.grouped.get(i)}` : '',
      ];
    });
    download(`slopgauge-class-${new Date().toISOString().slice(0, 10)}.csv`, [head, ...rows]);
  });
  $('print').addEventListener('click', () => {
    if (!last) return;
    const kind = $('kind').selectedOptions[0];
    $('printHead').textContent = `Slopgauge class report · ${new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })} · ${kind ? kind.textContent : ''} · ${last.results.length} essays · slopgauge.com`;
    print();
  });
})();
