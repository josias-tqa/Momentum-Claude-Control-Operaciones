#!/usr/bin/env node
// Candidatos a reglas nuevas y a cambios sobre reglas existentes (determinista, sin modelo).
// /control-reglas convierte cada candidato en una propuesta que aprueba un Admin; nada se activa solo.
//
// Dos disparadores, los dos baratos de calcular:
//  - SIMILITUD (por evento): una regla que se aprobó o editó desde la última vez se ofrece a los otros
//    procesos que comparten un sistema con el suyo (portal web, aplicación o librería propia).
//  - REVISIÓN DIARIA (primera corrida del día): con los últimos 30 días busca reglas ruidosas, reglas cuya
//    severidad sobra, reglas sin uso y temas recurrentes que no tienen regla.
//
// Uso: node scripts/sugerir-reglas.mjs --db work/<run>/db [--ahora <ISO>] [--diario] --salida work/<run>/reglas-candidatos.json
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { arg, bandera, leerJson, desenvolver } from './lib/args.mjs';
import { leerColeccion } from './consolidar.mjs';

export const TOPES = { porProyecto: 3, pendientesMax: 5, destinosPorRegla: 3 };
const DIA = 86400000;
const VENTANA_DIAS = 30;
const SIN_USO_DIAS = 60;
const NO_REPETIR_DIAS = 90;
const PRIORIDAD = ['ruidosa', 'severidad', 'descartado_repetido', 'recurrente_sin_regla', 'similar', 'sin_uso'];
const SEVS = ['P1', 'P2', 'P3', 'P4'];

const dias = (desde, hasta) => (Date.parse(hasta) - Date.parse(desde)) / DIA;
const reciente = (iso, ahora, n) => Boolean(iso) && dias(iso, ahora) < n;

// Sistemas de cada proceso: portales y aplicaciones detectados en el código, más sus librerías propias.
export function mapaDeSistemas(proyectos) {
  const procesos = [];
  for (const p of proyectos) {
    if (!['active', 'review'].includes(p.status)) continue;
    for (const x of (p.inventory && p.inventory.processes) || []) {
      const claves = [...new Set([...(x.systems || []), ...(x.libraries || []).map((l) => `lib:${l.name}`)])];
      procesos.push({ projectId: p.id, projectName: p.name || p.id, name: x.name, claves });
    }
  }
  const uso = {};
  for (const x of procesos) for (const c of x.claves) uso[c] = (uso[c] || 0) + 1;
  // Lo que usan TODOS los procesos (una librería común) no distingue a nadie: no cuenta como similitud.
  const util = (c) => !(procesos.length >= 3 && uso[c] === procesos.length);
  return { procesos: procesos.map((x) => ({ ...x, claves: x.claves.filter(util) })), uso };
}

const reglasDe = (inc) => {
  const ev = inc.evidence || {};
  return [...new Set([...((inc.triage || {}).matchedRules || []), ...[ev.ultima, ev.primera].map((x) => x && x.regla && x.regla.id)].filter(Boolean))];
};
const esFalso = (w) => Boolean(w) && ((w.state === 'dismissed' && ['false_positive', 'expected'].includes(w.dismissReason))
  || (w.state === 'responded' && ['false_positive', 'expected_behavior'].includes((w.response || {}).decision)));

export function sugerir({ proyectos, reglas, incidentes, trabajo, salud = {}, ahora, diario: forzarDiario = false }) {
  const rr = salud.rulesReview || {};
  const descartados = Object.fromEntries(Object.entries(rr.descartados || {}).filter(([, at]) => reciente(at, ahora, NO_REPETIR_DIAS)));
  const diario = forzarDiario || !rr.dailyAt || rr.dailyAt.slice(0, 10) < ahora.slice(0, 10);
  const yaPropuesto = (key) => Boolean(descartados[key]) || reglas.some((r) => r.proposalKey === key || (r.suggestion && r.suggestion.key === key));
  const work = new Map(trabajo.map((w) => [w.id, w]));
  const candidatos = [];
  const writes = [];

  // ---------- similitud entre procesos ----------
  const { procesos, uso } = mapaDeSistemas(proyectos);
  for (const r of reglas) {
    if (r.status !== 'active' || !r.projectId || r.projectId === '*' || r.origin === 'similar') continue;
    const cambio = [r.approvedAt, r.updatedAt, r.createdAt].filter(Boolean).sort().slice(-1)[0] || '';
    if (rr.similarityAt && cambio <= rr.similarityAt) continue;
    const filtro = String(((r.compiled || {}).filter || {}).process || '').toLowerCase();
    const delProyecto = procesos.filter((x) => x.projectId === r.projectId);
    const origen = filtro ? delProyecto.filter((x) => x.name.toLowerCase().includes(filtro)) : delProyecto;
    const claves = new Set(origen.flatMap((x) => x.claves));
    if (!claves.size) continue;
    const destinos = [];
    for (const x of procesos) {
      if (origen.includes(x)) continue;
      if (x.projectId === r.projectId && !filtro) continue; // la regla ya vale para todo el proyecto
      const comparten = x.claves.filter((c) => claves.has(c)).sort((a, b) => uso[a] - uso[b]);
      if (!comparten.length) continue;
      const key = `sim:${r.id}:${x.projectId}:${x.name}`;
      if (yaPropuesto(key)) continue;
      destinos.push({ tipo: 'similar', key, projectId: x.projectId, projectName: x.projectName, process: x.name, sourceRuleId: r.id, sourceProjectId: r.projectId,
        sourceText: r.text, comparten: comparten.map((c) => ({ sistema: c, procesosQueLoUsan: uso[c] })), rareza: uso[comparten[0]] });
    }
    candidatos.push(...destinos.sort((a, b) => a.rareza - b.rareza).slice(0, TOPES.destinosPorRegla));
  }

  // ---------- revisión diaria ----------
  if (diario) {
    const desde = new Date(Date.parse(ahora) - VENTANA_DIAS * DIA).toISOString();
    const enVentana = incidentes.filter((i) => i.lastSeenAt && i.lastSeenAt >= desde);
    const seguimiento = rr.trackingSince || ahora;
    for (const r of reglas) {
      if (r.status !== 'active') continue;
      // Último disparo conocido: lo mantiene este script porque los incidentes viejos se depuran.
      const ultimo = incidentes.filter((i) => reglasDe(i).includes(r.id)).map((i) => i.lastSeenAt).filter(Boolean).sort().slice(-1)[0] || null;
      if (ultimo && (!r.lastTriggeredAt || ultimo > r.lastTriggeredAt)) {
        writes.push({ op: 'update', collection: 'rules', doc_id: r.id, ...(r.__version ? { if_version: r.__version } : {}), data: { lastTriggeredAt: ultimo } });
      }
      if (r.suggestion) continue; // ya tiene un cambio sugerido sin resolver
      const rechazada = (kind) => (r.dismissedSuggestions || []).some((d) => d.kind === kind && reciente(d.at, ahora, NO_REPETIR_DIAS));
      const suyos = enVentana.filter((i) => reglasDe(i).includes(r.id));
      const falsos = suyos.filter((i) => esFalso(work.get(i.id)));
      const pospuestos = suyos.filter((i) => (work.get(i.id) || {}).state === 'snoozed');
      const conFix = suyos.filter((i) => ['fix_required', 'escalate_dev'].includes(((work.get(i.id) || {}).response || {}).decision));
      const base = { projectId: r.projectId, ruleId: r.id, ruleText: r.text };
      const c = r.compiled || {};
      if (suyos.length >= 3 && falsos.length / suyos.length >= 0.6 && !rechazada('exception') && !rechazada('text')) {
        candidatos.push({ ...base, tipo: 'ruidosa', key: `sug:${r.id}:ruidosa`, kinds: ['exception', 'text'], disparos: suyos.length, descartados: falsos.length, incidentes: falsos.map((i) => i.id).slice(0, 10) });
        continue;
      }
      const sev = SEVS.indexOf(c.severity);
      if (!['known', 'ignore'].includes(c.action) && sev >= 0 && sev < 3 && pospuestos.length >= 2 && !conFix.length && !rechazada('severity')) {
        candidatos.push({ ...base, tipo: 'severidad', key: `sug:${r.id}:severidad`, kinds: ['severity'], value: SEVS[sev + 1], actual: c.severity, disparos: suyos.length, pospuestos: pospuestos.length, incidentes: pospuestos.map((i) => i.id).slice(0, 10) });
        continue;
      }
      const edad = [r.approvedAt, r.createdAt].filter(Boolean).sort().slice(-1)[0];
      const visto = [r.lastTriggeredAt, ultimo].filter(Boolean).sort().slice(-1)[0] || null;
      if (!suyos.length && edad && dias(edad, ahora) >= SIN_USO_DIAS && dias(seguimiento, ahora) >= SIN_USO_DIAS && (!visto || dias(visto, ahora) >= SIN_USO_DIAS) && !rechazada('retire')) {
        candidatos.push({ ...base, tipo: 'sin_uso', key: `sug:${r.id}:sin_uso`, kinds: ['retire'], ultimoDisparo: visto, diasSinDisparar: visto ? Math.floor(dias(visto, ahora)) : null });
      }
    }
    // Temas que se repiten y no tienen ninguna regla.
    const grupos = new Map();
    for (const i of enVentana) {
      if (reglasDe(i).some((id) => reglas.some((r) => r.id === id))) continue;
      const k = `${i.projectId}|${i.category}|${i.process || ''}`;
      if (!grupos.has(k)) grupos.set(k, []);
      grupos.get(k).push(i);
    }
    for (const [k, xs] of grupos) {
      const [projectId, category, process] = k.split('|');
      const base = { projectId, category, process: process || null };
      const falsos = xs.filter((i) => esFalso(work.get(i.id)));
      const veces = falsos.reduce((a, i) => a + 1 + Number(i.reopenCount || 0), 0);
      const k1 = `tema:descartado_repetido:${k}`;
      if (veces >= 2 && !yaPropuesto(k1)) {
        candidatos.push({ ...base, tipo: 'descartado_repetido', key: k1, vecesDescartado: veces, incidentes: falsos.map((i) => i.id).slice(0, 10) });
        continue;
      }
      const insistentes = xs.filter((i) => i.status === 'open' && ['notify', 'monitor'].includes(i.decision) && !work.get(i.id) && (i.recurrences || []).filter((x) => x.at >= desde).length >= 5);
      const k2 = `tema:recurrente_sin_regla:${k}`;
      if (insistentes.length && !yaPropuesto(k2)) {
        candidatos.push({ ...base, tipo: 'recurrente_sin_regla', key: k2, corridasConElTema: Math.max(...insistentes.map((i) => (i.recurrences || []).filter((x) => x.at >= desde).length)), incidentes: insistentes.map((i) => i.id).slice(0, 10) });
      }
    }
  }

  // ---------- topes: pocas propuestas, las más útiles primero ----------
  const pendientes = {};
  for (const r of reglas) if (r.status === 'proposed' || r.suggestion) pendientes[r.projectId] = (pendientes[r.projectId] || 0) + 1;
  const elegidos = [];
  const porProyecto = {};
  let recortados = 0; let similaresRecortados = 0;
  for (const c of candidatos.slice().sort((a, b) => PRIORIDAD.indexOf(a.tipo) - PRIORIDAD.indexOf(b.tipo))) {
    const cupo = Math.min(TOPES.porProyecto, TOPES.pendientesMax - (pendientes[c.projectId] || 0));
    if ((porProyecto[c.projectId] || 0) >= cupo) { recortados++; if (c.tipo === 'similar') similaresRecortados++; continue; }
    porProyecto[c.projectId] = (porProyecto[c.projectId] || 0) + 1;
    elegidos.push(c);
  }

  const rulesReview = {
    // Si quedó una similitud afuera por el tope, no se avanza la marca: se vuelve a ofrecer en la próxima corrida.
    similarityAt: similaresRecortados ? (rr.similarityAt || null) : ahora,
    dailyAt: diario ? ahora : (rr.dailyAt || null),
    trackingSince: rr.trackingSince || ahora,
    descartados,
  };
  writes.push({ op: 'update', collection: 'config', doc_id: 'health', data: { rulesReview } });
  return { ahora, diario, candidatos: elegidos, recortadosPorTope: recortados, plan: { writes } };
}

// ---------- CLI ----------
if (process.argv[1] && process.argv[1].endsWith('sugerir-reglas.mjs')) {
  const db = arg('--db');
  const r = sugerir({
    proyectos: leerColeccion(join(db, 'projects')), reglas: leerColeccion(join(db, 'rules')), incidentes: leerColeccion(join(db, 'incidents')),
    trabajo: leerColeccion(join(db, 'incidentWork')), salud: desenvolver(leerJson(join(db, 'config', 'health.json'), {})),
    ahora: arg('--ahora') || new Date().toISOString(), diario: bandera('--diario'),
  });
  mkdirSync(dirname(arg('--salida')), { recursive: true });
  writeFileSync(arg('--salida'), JSON.stringify(r, null, 2));
  console.log(JSON.stringify({ diario: r.diario, candidatos: r.candidatos.map((c) => `${c.tipo}:${c.projectId}`), recortadosPorTope: r.recortadosPorTope }));
}
