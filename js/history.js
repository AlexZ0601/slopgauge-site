// Class history (Pro): a teacher's classes, kept in this browser's IndexedDB on this computer only.
// A class holds its assignments and, per student, their essays: the text (needed to compare a new
// essay with their own earlier writing), its reading and the date. Nothing is sent anywhere.
(function (root) {
  'use strict';
  const DB = 'slopgauge';
  const STORE = 'classes';
  let opening = null;
  function db() {
    opening ||= new Promise((resolve, reject) => {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return opening;
  }
  async function tx(mode, fn) {
    const d = await db();
    return new Promise((resolve, reject) => {
      const t = d.transaction(STORE, mode);
      const out = fn(t.objectStore(STORE));
      t.oncomplete = () => resolve(out && 'result' in out ? out.result : undefined);
      t.onerror = () => reject(t.error);
    });
  }
  const id = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));
  // A student's key: their name, case- and space-insensitive, so "Jane Doe" and "jane  doe" match.
  const keyOf = (name) => String(name || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

  const api = {
    keyOf,
    list: () => tx('readonly', (s) => s.getAll()).then((all) => (all || []).sort((a, b) => a.name.localeCompare(b.name))),
    get: (cid) => tx('readonly', (s) => s.get(cid)),
    put: (cls) => tx('readwrite', (s) => s.put({ ...cls, updated: Date.now() })),
    remove: (cid) => tx('readwrite', (s) => s.delete(cid)),
    create: async (name) => {
      const cls = { id: id(), name: String(name).trim().slice(0, 80) || 'My class', created: Date.now(), assignments: [], students: {} };
      await api.put(cls);
      return cls;
    },
    // Add one assignment's essays: [{ student, text, words, aiShare, verdict, tooShort, voice }].
    addAssignment: async (cid, name, essays) => {
      const cls = await api.get(cid);
      if (!cls) throw new Error('That class is gone.');
      const a = { id: id(), name: String(name).trim().slice(0, 80) || `Assignment ${cls.assignments.length + 1}`, date: Date.now() };
      cls.assignments.push(a);
      for (const e of essays) {
        const k = keyOf(e.student);
        if (!k) continue;
        const st = (cls.students[k] ||= { name: e.student.trim(), essays: [] });
        st.essays.push({ assignment: a.id, date: a.date, text: e.text, words: e.words, aiShare: e.aiShare, verdict: e.verdict, tooShort: e.tooShort, voice: e.voice || null });
      }
      await api.put(cls);
      return cls;
    },
  };
  root.SlopgaugeHistory = api;
})(window);
