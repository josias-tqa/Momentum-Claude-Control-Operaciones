// Ayuda del tablero: utilidades sin dependencias que usan el build (scripts/build-ayuda.mjs) y los tests.
// La fuente de la ayuda son los .mdx de dashboard/ayuda/<idioma>/ (un juego completo por idioma, con los mismos ids);
// el build los compila y los inserta en dashboard/index.html entre los marcadores AYUDA:INICIO y AYUDA:FIN.

import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const DIR_AYUDA = join(RAIZ, 'dashboard', 'ayuda');
export const TABLERO = join(RAIZ, 'dashboard', 'index.html');
export const BUILD = join(RAIZ, 'scripts', 'build-ayuda.mjs');
export const MARCA_INICIO = '<!-- AYUDA:INICIO';
export const MARCA_FIN = '<!-- AYUDA:FIN -->';

export const IDIOMAS_AYUDA = ['es', 'en']; // los mismos que IDIOMAS de scripts/lib/i18n.mjs (tests/ayuda.test.mjs lo verifica)
export const dirAyuda = (lang) => join(DIR_AYUDA, lang);
export function fuentesAyuda(lang) {
  return readdirSync(dirAyuda(lang)).filter((f) => f.endsWith('.mdx')).sort().map((f) => ({ archivo: f, texto: readFileSync(join(dirAyuda(lang), f), 'utf8') }));
}

// Hash de las fuentes y del build: si cambia alguno, el bloque generado queda desactualizado.
export function hashAyuda() {
  const h = createHash('sha256');
  for (const l of IDIOMAS_AYUDA) for (const f of fuentesAyuda(l)) h.update(`${l}/${f.archivo}\n${f.texto}\n`);
  h.update(readFileSync(BUILD, 'utf8'));
  return h.digest('hex');
}

// Devuelve { hash, html, tips } del bloque generado dentro de index.html para un idioma, o null si no está.
export function leerBloque(tablero = readFileSync(TABLERO, 'utf8'), lang = 'es') {
  const i = tablero.indexOf(MARCA_INICIO); const j = tablero.indexOf(MARCA_FIN);
  if (i < 0 || j < i) return null;
  const bloque = tablero.slice(i, j);
  const hash = (bloque.match(/sha256=([0-9a-f]{64})/) || [])[1] || null;
  const html = (bloque.match(new RegExp(`<template id="ayuda-tpl-${lang}">([\\s\\S]*?)<\\/template>`)) || [])[1] || '';
  const json = (bloque.match(new RegExp(`<script type="application\\/json" id="ayuda-tips-${lang}">([\\s\\S]*?)<\\/script>`)) || [])[1] || '{}';
  return { hash, html, tips: JSON.parse(json.replace(/<\\\//g, '</')) };
}

// Ids de ancla de la ayuda (id="ayuda-x" → "x"), en orden y con repetidos.
export const idsAyuda = (html) => [...html.matchAll(/\sid="ayuda-([\w-]+)"/g)].map((m) => m[1]);
