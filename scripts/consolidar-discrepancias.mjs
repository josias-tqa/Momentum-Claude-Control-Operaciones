#!/usr/bin/env node
// Discrepancias de un proyecto: una tarjeta por discrepancia, a nivel proyecto (no van a la bandeja).
//
// El alta (o el re-análisis) cruza código, documentación y Orchestrator y lista lo que no coincide.
// Este script une esa lista con las discrepancias que ya están en el tablero y con su lado humano
// (discrepancyWork), y produce el plan de escrituras. Regla de oro, igual que con los incidentes:
// UNA tarjeta por discrepancia, y las respuestas humanas mandan.
//
// `status` dice solo si la rutina la sigue detectando ("open") o no ("resolved"). Lo que decidió una persona
// vive en discrepancyWork y este script nunca lo toca:
//  - nueva: se crea abierta;
//  - ya conocida: suma una detección;
//  - abierta que el análisis ya no encuentra: pasa a resuelta ("ya no se detecta");
//  - resuelta que se vuelve a detectar: vuelve a abierta. Si nadie la había dado por cerrada (o solo se había
//    informado un fix), además se marca `reopenedAt`: el tablero la muestra otra vez como pendiente;
//  - descartada, o respondida como "es correcto así": nunca se marca como reaparecida.
//
// Uso: node scripts/consolidar-discrepancias.mjs --proyecto <id> --encontradas <archivo.json> --db work/<run>/db
//        [--ahora <ISO>] --salida <plan.json>
//   <archivo.json>: [ { key, kind, title, detail, suggestion, processId, refs: [{ source, note }] } ]
//   `key` identifica la discrepancia entre análisis: "<tipo>:<objeto>", p. ej. "orchestrator:cola:rrhh_nov_items".
// Salida: { resumen: { nuevas, actualizadas, reabiertas, resueltas, sinCambios }, writes }: las escrituras se suman
// al plan del alta (o el archivo se pasa tal cual como --plan de build-writes.mjs).
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { arg, leerJson, desenvolver } from './lib/args.mjs';
import { slugProceso } from './lib/proyecto.mjs';
import { leerColeccion } from './consolidar.mjs';
import { idiomaDe, m } from './lib/idioma.mjs';

export const TIPOS = ['orchestrator', 'code', 'queue', 'version', 'trigger', 'docs', 'hygiene', 'other'];

// Clave normalizada: sin acentos, en minúsculas y con separadores uniformes, para que "Cola: RRHH_NOV Items"
// y "cola:rrhh-nov-items" sean la misma discrepancia.
export const claveDiscrepancia = (key) => String(key || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[^a-z0-9:]+/g, '-').replace(/-*:-*/g, ':').replace(/^[-:]+|[-:]+$/g, '').slice(0, 200);

export const idDiscrepancia = (projectId, key) => `disc-${slugProceso(projectId).slice(0, 40)}-${createHash('sha256').update(`${projectId}|${claveDiscrepancia(key)}`).digest('hex').slice(0, 10)}`;

// Lo que una persona decidió y no hay que volver a preguntar.
const cerradaPorHumano = (w) => Boolean(w) && (w.state === 'dismissed' || (w.state === 'responded' && (w.response || {}).decision === 'expected'));

const recortar = (s, n) => { const t = String(s ?? '').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };

function cuerpo(e) {
  const d = { kind: TIPOS.includes(e.kind) ? e.kind : 'other', title: recortar(e.title, 300) };
  if (e.detail) d.detail = recortar(e.detail, 4000);
  if (e.suggestion) d.suggestion = recortar(e.suggestion, 2000);
  if (e.processId) d.processId = String(e.processId).slice(0, 60);
  const refs = (e.refs || []).filter((r) => r && r.source).slice(0, 20).map((r) => ({ source: recortar(r.source, 300), ...(r.note ? { note: recortar(r.note, 500) } : {}) }));
  if (refs.length) d.refs = refs;
  return d;
}

export function consolidarDiscrepancias({ projectId, encontradas, existentes = [], trabajo = [], ahora, ajustes = {} }) {
  const lang = idiomaDe(ajustes);
  const propias = existentes.filter((d) => d.projectId === projectId);
  const porId = new Map(propias.map((d) => [d.id, d]));
  const work = new Map(trabajo.map((w) => [w.id, w]));
  const writes = [];
  const resumen = { nuevas: 0, actualizadas: 0, reabiertas: 0, resueltas: 0, sinCambios: 0 };
  const errores = [];
  const vistas = new Set();
  const version = (d) => (d.__version ? { if_version: d.__version } : {});

  for (const e of encontradas || []) {
    const key = claveDiscrepancia(e && e.key);
    if (!key || !e.title) { errores.push(`discrepancia sin key o sin title: ${JSON.stringify(e).slice(0, 120)}`); continue; }
    const id = idDiscrepancia(projectId, key);
    if (vistas.has(id)) continue; // la misma discrepancia dos veces en la lista
    vistas.add(id);
    const previa = porId.get(id);
    if (!previa) {
      writes.push({ op: 'set', collection: 'discrepancies', doc_id: id, data: { projectId, key, ...cuerpo(e), status: 'open', firstSeenAt: ahora, lastSeenAt: ahora, seenCount: 1, createdBy: 'rutina' } });
      resumen.nuevas += 1;
      continue;
    }
    const data = { ...cuerpo(e), lastSeenAt: ahora, seenCount: Number(previa.seenCount || 1) + 1 };
    if (previa.status === 'resolved') data.status = 'open';
    if (previa.status === 'resolved' && !cerradaPorHumano(work.get(id))) {
      Object.assign(data, { reopenedAt: ahora, reopenCount: Number(previa.reopenCount || 0) + 1 });
      resumen.reabiertas += 1;
    } else resumen.actualizadas += 1;
    writes.push({ op: 'update', collection: 'discrepancies', doc_id: id, ...version(previa), data });
  }

  for (const d of propias) {
    if (vistas.has(d.id)) continue;
    if (d.status !== 'open') { resumen.sinCambios += 1; continue; }
    writes.push({ op: 'update', collection: 'discrepancies', doc_id: d.id, ...version(d), data: { status: 'resolved', resolvedAt: ahora, resolvedReason: m(lang, 'disc.resuelta') } });
    resumen.resueltas += 1;
  }
  return { resumen, errores, writes };
}

if (process.argv[1] && process.argv[1].endsWith('consolidar-discrepancias.mjs')) {
  const db = arg('--db');
  const projectId = arg('--proyecto');
  if (!projectId || !arg('--encontradas') || !arg('--salida')) { console.error('Uso: --proyecto <id> --encontradas <json> --db <dir> --salida <plan.json>'); process.exit(1); }
  const r = consolidarDiscrepancias({
    projectId, encontradas: leerJson(arg('--encontradas')),
    existentes: db ? leerColeccion(join(db, 'discrepancies')) : [], trabajo: db ? leerColeccion(join(db, 'discrepancyWork')) : [],
    ahora: arg('--ahora') || new Date().toISOString(),
    ajustes: db ? desenvolver(leerJson(join(db, 'config', 'settings.json'), {})) : {},
  });
  if (r.errores.length) { console.error(`Lista de discrepancias inválida:\n - ${r.errores.join('\n - ')}`); process.exit(1); }
  mkdirSync(dirname(arg('--salida')), { recursive: true });
  writeFileSync(arg('--salida'), JSON.stringify(r, null, 2));
  console.log(JSON.stringify(r.resumen));
}
