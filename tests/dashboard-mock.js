// Simulación de window.claude (capacidades db y user) para probar el tablero fuera de claude.ai.
// Implementa solo el subconjunto que usa dashboard/index.html. Datos: window.__SEED__ = { "coleccion/doc": {...} }.
(function () {
  const seed = window.__SEED__ || {};
  const role = window.__ROLE__ || 'admin';
  const store = new Map(Object.entries(seed));
  const listeners = new Set();
  window.__WRITES__ = [];
  const snapDoc = (path) => ({ id: path.split('/').pop(), exists: store.has(path), data: () => store.get(path), metadata: { fromCache: false, hasPendingWrites: false } });
  const notify = () => setTimeout(() => listeners.forEach((l) => l()), 0);
  const canWrite = (path) => {
    if (role === 'lector') return false;
    const col = path.split('/')[0];
    if (role === 'operador') return ['incidentWork', 'activity', 'requests', 'data'].includes(col);
    return !['runs', 'incidents', 'rollups'].includes(col);
  };
  const deny = () => Promise.reject({ code: 'invalid_argument', message: 'denegado' });
  function query(col, filters = [], ord = null, lim = null) {
    const run = () => {
      let docs = [...store.keys()].filter((k) => k.startsWith(col + '/') && k.split('/').length === col.split('/').length + 1).map(snapDoc);
      for (const [f, op, v] of filters) docs = docs.filter((d) => { const x = d.data()[f]; return op === '==' ? x === v : op === 'in' ? v.includes(x) : true; });
      if (ord) docs.sort((a, b) => String(a.data()[ord[0]]).localeCompare(String(b.data()[ord[0]])) * (ord[1] === 'desc' ? -1 : 1));
      if (lim) docs = docs.slice(0, lim);
      return { docs, size: docs.length, empty: !docs.length, docChanges: () => [], metadata: { fromCache: false } };
    };
    return {
      where: (f, op, v) => query(col, [...filters, [f, op, v]], ord, lim),
      orderBy: (f, dir) => query(col, filters, [f, dir], lim),
      limit: (n) => query(col, filters, ord, n),
      get: async () => run(),
      onSnapshot(next) { const l = () => next(run()); listeners.add(l); setTimeout(l, 30); return () => listeners.delete(l); },
      doc: (id) => docRef(`${col}/${id || Math.random().toString(36).slice(2)}`),
      add: async (data) => { const p = `${col}/${Math.random().toString(36).slice(2)}`; if (!canWrite(p)) return deny(); store.set(p, data); window.__WRITES__.push({ op: 'add', path: p, data }); notify(); return docRef(p); },
    };
  }
  function docRef(path) {
    return {
      id: path.split('/').pop(), path,
      get: async () => snapDoc(path),
      set: async (data) => { if (!canWrite(path)) return deny(); store.set(path, data); window.__WRITES__.push({ op: 'set', path, data }); notify(); },
      update: async (data) => { if (!canWrite(path)) return deny(); if (!store.has(path)) return deny(); store.set(path, { ...store.get(path), ...data }); window.__WRITES__.push({ op: 'update', path, data }); notify(); },
      delete: async () => { store.delete(path); notify(); },
      onSnapshot(next) { const l = () => next(snapDoc(path)); listeners.add(l); setTimeout(l, 30); return () => listeners.delete(l); },
      collection: (c) => query(`${path}/${c}`),
    };
  }
  const db = { doc: docRef, collection: (c) => query(c) };
  const people = { u_admin000000000000000001: 'Ana Admin', u_oper0000000000000000002: 'Omar Operador', u_lect0000000000000000003: 'Lía Lectora' };
  const meId = { admin: 'u_admin000000000000000001', operador: 'u_oper0000000000000000002', lector: 'u_lect0000000000000000003' }[role];
  const av = (n) => 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22"><rect width="22" height="22" rx="11" fill="#7a8"/><text x="11" y="15" font-size="11" text-anchor="middle" fill="#fff">${n[0]}</text></svg>`);
  const prof = (id) => ({ id, name: people[id] || '', avatarUrl: av(people[id] || '?'), color: '#7a8', email: null, isMe: id === meId, guest: false });
  const user = {
    isOwner: async () => false, canEdit: async () => role === 'admin', can: async (n) => (n === 'data.write' ? role !== 'lector' : false),
    id: async () => meId, me: async () => prof(meId),
    profiles: async (ids) => Object.fromEntries([].concat(ids).map((id) => [id, prof(id)])),
    search: async (q) => Object.keys(people).filter((id) => !q || people[id].toLowerCase().includes(q.toLowerCase())).map(prof),
  };
  window.claude = { use: async (n) => (window.__NODB__ && n === 'db' ? null : n === 'db' ? db : n === 'user' ? user : null) };
})();
