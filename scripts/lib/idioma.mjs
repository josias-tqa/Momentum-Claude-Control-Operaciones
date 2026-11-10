// Idioma de los textos que genera la rutina por su cuenta (títulos, motivos, resúmenes de los scripts).
// El idioma sale de config/settings.language (lo fija un Admin en Ajustes; por defecto "es"). Cada texto se
// escribe UNA sola vez, en ese idioma: no se guarda en los dos. Las firmas (`firma`) que alimentan fingerprint()
// NO se traducen: tienen que ser iguales en cualquier idioma para no duplicar tarjetas.
// Los textos viven en scripts/lib/mensajes/<idioma>.json (mismas claves y {parámetros} en todos; tests/mensajes.test.mjs).

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const IDIOMAS_RUTINA = ['es', 'en'];
export const IDIOMA_RUTINA_BASE = 'es';
export const DIR_MENSAJES = join(dirname(fileURLToPath(import.meta.url)), 'mensajes');

const cache = {};
export function mensajes(lang) {
  if (!cache[lang]) cache[lang] = JSON.parse(readFileSync(join(DIR_MENSAJES, `${lang}.json`), 'utf8'));
  return cache[lang];
}

export const idiomaDe = (ajustes) => (ajustes && IDIOMAS_RUTINA.includes(ajustes.language) ? ajustes.language : IDIOMA_RUTINA_BASE);

// m('en', 'eval.titulo.jobs_stopped', { proceso, n }) → texto en ese idioma (si falta: el español; si no, la clave).
export function m(lang, clave, params) {
  const txt = mensajes(IDIOMAS_RUTINA.includes(lang) ? lang : IDIOMA_RUTINA_BASE)[clave] ?? mensajes(IDIOMA_RUTINA_BASE)[clave] ?? clave;
  return params ? txt.replace(/\{(\w+)\}/g, (_, n) => String(params[n] ?? '')) : txt;
}
