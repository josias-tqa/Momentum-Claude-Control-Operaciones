// La ayuda del tablero tiene que acompañar a la app: cada pantalla, pestaña y botón tiene su sección
// o su tooltip en dashboard/ayuda/*.mdx, y el bloque generado en index.html está al día.
// Sin dependencias: no compila el MDX, compara hashes y lee el bloque ya generado.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TABLERO, hashAyuda, leerBloque, idsAyuda } from '../scripts/lib/ayuda.mjs';

const fuente = readFileSync(TABLERO, 'utf8');
const app = fuente.slice(0, fuente.indexOf('<!-- AYUDA:INICIO')) + fuente.slice(fuente.indexOf('<!-- AYUDA:FIN -->'));
const bloque = leerBloque(fuente);
const anclas = new Set(bloque ? idsAyuda(bloque.html) : []);
const literal = (nombre) => JSON.parse(app.match(new RegExp(`const ${nombre} = (.*?);\\n`))[1]);
const todos = (re, txt = app) => [...new Set([...txt.matchAll(re)].map((m) => m[1]))];

test('ayuda: el bloque generado está al día con dashboard/ayuda/*.mdx', () => {
  assert.ok(bloque, 'faltan los marcadores AYUDA:INICIO / AYUDA:FIN en dashboard/index.html');
  assert.equal(bloque.hash, hashAyuda(), 'la ayuda cambió y no se regeneró: corré npm run build:ayuda');
  assert.ok(anclas.has('introduccion') && anclas.has('glosario'), 'introducción y glosario');
});

test('ayuda: cada ruta del tablero tiene su sección', () => {
  // Rutas: las de vista() (b === 'x' / b.startsWith('x-')) y el detalle de un tema, que abre render().
  const vista = app.slice(app.indexOf('function vista('), app.indexOf('function renderShell('));
  const render = app.slice(app.indexOf('function render()'), app.indexOf('function vista('));
  const rutas = [...todos(/b === '([\w-]+)'/g, vista), ...todos(/b\.startsWith\('([\w-]+)'\)/g, vista), ...todos(/h\.startsWith\('([\w-]+)'\)/g, render)];
  assert.ok(rutas.length >= 10);
  const mapa = literal('AYUDA_RUTA');
  for (const r of rutas) {
    assert.ok(mapa[r], `la ruta "${r}" no está en AYUDA_RUTA`);
    assert.ok(anclas.has(mapa[r]), `AYUDA_RUTA["${r}"] apunta a "${mapa[r]}", que no existe en la ayuda`);
  }
});

test('ayuda: cada botón tiene tooltip y cada "?" apunta a una sección', () => {
  const tips = bloque.tips;
  const alias = literal('TIP_ALIAS'); const sin = literal('SIN_TIP');
  const faltan = [];
  const pedir = (id, de) => { if (!tips[id]) faltan.push(`${id} (${de})`); };
  for (const act of todos(/data-act="([\w-]+)"/g)) {
    if (sin.includes(act) || ['panel', 'regla', 'tab'].includes(act)) continue;
    pedir(alias[act] || act, `data-act="${act}"`);
  }
  for (const p of todos(/bt\('([\w-]+)'/g)) pedir(alias['panel-' + p] || p, `panel ${p}`);
  for (const s of todos(/data-act="regla"[^>]*data-s="(\w+)"/g)) pedir('regla-' + s, `regla ${s}`);
  const tabs = app.slice(app.indexOf('function viewProyecto(')).match(/const tabs = \[(.*?)\];/)[1];
  for (const [, t] of tabs.matchAll(/\['(\w+)'/g)) pedir('proyecto-' + t, `pestaña ${t}`);
  for (const t of todos(/data-tip="([\w-]+)"/g)) pedir(t, 'data-tip');
  assert.deepEqual(faltan, [], 'falta el tooltip (breve) en la ayuda');
  for (const x of [...todos(/ayudaBtn\('([\w-]*\w)',/g), ...todos(/ayudaLink\('([\w-]*\w)',/g)]) assert.ok(anclas.has(x), `ayudaBtn/ayudaLink('${x}') no existe en la ayuda`);
  for (const id of Object.keys(tips)) assert.ok(anclas.has(id), `el tooltip ${id} no tiene ancla`);
});

test('ayuda: anclas únicas, links internos válidos y vistas conocidas', () => {
  const ids = idsAyuda(bloque.html);
  assert.equal(ids.length, anclas.size, 'ids repetidos');
  for (const [, id] of bloque.html.matchAll(/href="#ayuda-([\w-]+)"/g)) assert.ok(anclas.has(id), `link roto a #ayuda-${id}`);
  const vistas = app.match(/const vistas = \{([\s\S]*?)\};/)[1];
  for (const [, n] of bloque.html.matchAll(/<!--vista:([\w-]+):/g)) assert.ok(n === 'selector' || n === 'tarjeta' || new RegExp(`(^|[\\s{,'])${n}'?:`).test(vistas), `vista desconocida: ${n}`);
});
