#!/usr/bin/env node
// Convierte un plan de escrituras en lotes listos para la herramienta ArtifactData (action "batch").
//
// Antes de generar nada:
//  - valida cada documento contra schemas/ (en "update" solo los campos presentes);
//  - controla el tamaño (256 KiB por documento);
//  - busca PII residual (emails, CUIT, cuentas, usuarios de Windows...). Si encuentra, aborta.
//
// Uso: node scripts/build-writes.mjs --plan work/<run>/plan.json --salida work/<run>/lotes
// Salida: <salida>/docs/<coleccion>__<id>.json y <salida>/lote-N.json con
//   { "writes": [ { "op", "collection", "doc_id", "file_path", "if_version" } ] }
// El agente pasa ese array `writes` tal cual a ArtifactData (action "batch").

import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { arg, leerJson } from './lib/args.mjs';
import { validar, esquemaPara } from './lib/schema.mjs';
import { detectarPii } from './lib/redact.mjs';

const MAX_DOC = 250 * 1024;
const MAX_LOTE_BYTES = 900 * 1024;
const MAX_LOTE = 50;

export function prepararLotes(writes) {
  const errores = [];
  const vistos = new Set();
  for (const w of writes) {
    const k = `${w.collection}/${w.doc_id}`;
    if (vistos.has(k)) errores.push(`${k}: aparece dos veces en el plan (un lote no puede tocar el mismo documento dos veces)`);
    vistos.add(k);
    if (w.op === 'delete') continue;
    const esquema = esquemaPara(w.collection, w.doc_id);
    if (!esquema) errores.push(`${k}: no hay esquema para la colección '${w.collection}'`);
    else {
      const e = w.op === 'update' ? { ...esquema, required: [] } : esquema;
      errores.push(...validar(w.data, e).map((x) => `${k}: ${x}`));
    }
    const tam = Buffer.byteLength(JSON.stringify(w.data));
    if (tam > MAX_DOC) errores.push(`${k}: ${Math.round(tam / 1024)} KiB supera el máximo de ${MAX_DOC / 1024} KiB`);
    for (const p of detectarPii(w.data)) errores.push(`${k}: posible PII (${p.patron}: ${p.ejemplo}) — redactar antes de escribir`);
  }
  if (errores.length) return { errores, lotes: [] };

  const lotes = [];
  let actual = [];
  let bytes = 0;
  for (const w of writes) {
    const tam = w.data ? Buffer.byteLength(JSON.stringify(w.data)) : 100;
    if (actual.length >= MAX_LOTE || (bytes + tam > MAX_LOTE_BYTES && actual.length)) { lotes.push(actual); actual = []; bytes = 0; }
    actual.push(w);
    bytes += tam;
  }
  if (actual.length) lotes.push(actual);
  return { errores: [], lotes };
}

if (process.argv[1] && process.argv[1].endsWith('build-writes.mjs')) {
  const plan = leerJson(arg('--plan'));
  const salida = resolve(arg('--salida'));
  const { errores, lotes } = prepararLotes(plan.writes || []);
  if (errores.length) {
    console.error(`Plan inválido (${errores.length} error(es)); no se generaron lotes:`);
    for (const e of errores.slice(0, 50)) console.error(' - ' + e);
    process.exit(1);
  }
  rmSync(salida, { recursive: true, force: true });
  mkdirSync(join(salida, 'docs'), { recursive: true });
  const indice = [];
  lotes.forEach((lote, n) => {
    const entradas = lote.map((w) => {
      const e = { op: w.op, collection: w.collection, doc_id: w.doc_id };
      if (w.op !== 'delete') {
        const fp = join(salida, 'docs', `${w.collection.replace(/\//g, '_')}__${w.doc_id}.json`);
        writeFileSync(fp, JSON.stringify(w.data, null, 2));
        e.file_path = fp;
      }
      if (w.if_version) e.if_version = w.if_version;
      return e;
    });
    const archivo = join(salida, `lote-${n + 1}.json`);
    writeFileSync(archivo, JSON.stringify({ writes: entradas }, null, 2));
    indice.push({ archivo, escrituras: entradas.length });
  });
  console.log(JSON.stringify({ lotes: indice }));
}
