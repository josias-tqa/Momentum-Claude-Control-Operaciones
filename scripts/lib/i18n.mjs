// i18n del tablero: utilidades sin dependencias que usan el build (scripts/build-i18n.mjs) y los tests.
// Fuente: dashboard/i18n/<idioma>/<espacio>.json (claves planas "espacio.cosa"; plurales con sufijos .one / .other).
// Cada archivo es un espacio de nombres (comun, bandeja, ajustes...): la clave debe empezar con el nombre del archivo.
// El build las incrusta en dashboard/index.html entre los marcadores I18N:INICIO y I18N:FIN.
// Para agregar un idioma: sumarlo a IDIOMAS y crear su JSON (los tests exigen las mismas claves en todos).

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { RAIZ, TABLERO } from './ayuda.mjs';

export const IDIOMAS = ['es', 'en'];
export const IDIOMA_BASE = 'es';
export const DIR_I18N = join(RAIZ, 'dashboard', 'i18n');
export const BUILD_I18N = join(RAIZ, 'scripts', 'build-i18n.mjs');
export const MARCA_I18N_INICIO = '<!-- I18N:INICIO';
export const MARCA_I18N_FIN = '<!-- I18N:FIN -->';

export const archivosCatalogo = (lang) => (existsSync(join(DIR_I18N, lang)) ? readdirSync(join(DIR_I18N, lang)).filter((f) => f.endsWith('.json')).sort() : []);
// Catálogo de un idioma = unión de sus archivos. Una clave repetida entre archivos es un error.
export function leerCatalogo(lang) {
  const out = {};
  for (const f of archivosCatalogo(lang)) {
    for (const [k, v] of Object.entries(JSON.parse(readFileSync(join(DIR_I18N, lang, f), 'utf8')))) {
      if (k in out) throw new Error(`clave repetida en el catálogo ${lang}: ${k} (${f})`);
      out[k] = v;
    }
  }
  return out;
}
export const catalogos = () => Object.fromEntries(IDIOMAS.map((l) => [l, leerCatalogo(l)]));

// Parámetros {nombre} de un texto, ordenados (para comparar entre idiomas).
export const paramsDe = (txt) => [...new Set([...String(txt).matchAll(/\{(\w+)\}/g)].map((m) => m[1]))].sort();

// Hash de los catálogos y del build: si cambia alguno, el bloque generado queda desactualizado.
export function hashI18n() {
  const h = createHash('sha256');
  for (const l of IDIOMAS) for (const f of archivosCatalogo(l)) h.update(`${l}/${f}\n${readFileSync(join(DIR_I18N, l, f), 'utf8')}\n`);
  h.update(readFileSync(BUILD_I18N, 'utf8'));
  return h.digest('hex');
}

// { hash, catalogos } del bloque generado dentro de index.html, o null si no está.
export function leerBloqueI18n(tablero = readFileSync(TABLERO, 'utf8')) {
  const i = tablero.indexOf(MARCA_I18N_INICIO); const j = tablero.indexOf(MARCA_I18N_FIN);
  if (i < 0 || j < i) return null;
  const bloque = tablero.slice(i, j);
  const hash = (bloque.match(/sha256=([0-9a-f]{64})/) || [])[1] || null;
  const cat = {};
  for (const m of bloque.matchAll(/<script type="application\/json" id="i18n-(\w+)">([\s\S]*?)<\/script>/g)) cat[m[1]] = JSON.parse(m[2].replace(/<\\\//g, '</'));
  return { hash, catalogos: cat };
}
