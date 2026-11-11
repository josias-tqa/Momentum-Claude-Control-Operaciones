// La ayuda del tablero tiene que acompañar a la app: cada pantalla, pestaña y botón tiene su sección
// o su tooltip en dashboard/ayuda/*.mdx, y el bloque generado en index.html está al día.
// Sin dependencias: no compila el MDX, compara hashes y lee el bloque ya generado.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TABLERO, hashAyuda, leerBloque, idsAyuda, IDIOMAS_AYUDA } from '../scripts/lib/ayuda.mjs';
import { IDIOMAS } from '../scripts/lib/i18n.mjs';

const fuente = readFileSync(TABLERO, 'utf8');
const sinBloque = (t, ini, fin) => (t.includes(ini) ? t.slice(0, t.indexOf(ini)) + t.slice(t.indexOf(fin) + fin.length) : t);
const app = sinBloque(sinBloque(fuente, '<!-- AYUDA:INICIO', '<!-- AYUDA:FIN -->'), '<!-- I18N:INICIO', '<!-- I18N:FIN -->');
// Un juego de ayuda por idioma (dashboard/ayuda/<idioma>/*.mdx): cada chequeo corre en todos.
const bloques = Object.fromEntries(IDIOMAS_AYUDA.map((l) => [l, leerBloque(fuente, l)]));
const anclasDe = (l) => new Set(bloques[l] ? idsAyuda(bloques[l].html) : []);
const literal = (nombre) => JSON.parse(app.match(new RegExp(`const ${nombre} = (.*?);\\n`))[1]);
const todos = (re, txt = app) => [...new Set([...txt.matchAll(re)].map((m) => m[1]))];

test('ayuda: el bloque generado está al día con dashboard/ayuda/*.mdx', () => {
  assert.deepEqual(IDIOMAS_AYUDA, IDIOMAS, 'los idiomas de la ayuda y los del tablero deben ser los mismos');
  for (const l of IDIOMAS_AYUDA) {
    const bloque = bloques[l];
    assert.ok(bloque && bloque.html, `faltan los marcadores AYUDA:INICIO / AYUDA:FIN o la ayuda "${l}" en dashboard/index.html`);
    assert.equal(bloque.hash, hashAyuda(), 'la ayuda cambió y no se regeneró: corré npm run build:ayuda');
    assert.ok(anclasDe(l).has('introduccion') && anclasDe(l).has('glosario'), `${l}: introducción y glosario`);
  }
});

test('ayuda: todos los idiomas tienen las mismas secciones, acciones, términos, vistas y tooltips', () => {
  const [base, ...otros] = IDIOMAS_AYUDA;
  const firma = (l) => ({ ids: idsAyuda(bloques[l].html).sort(), tips: Object.keys(bloques[l].tips).sort(), vistas: [...bloques[l].html.matchAll(/<!--vista:([\w-]+:[\w-]*)-->/g)].map((m) => m[1]).sort() });
  for (const l of otros) {
    const a = firma(base); const b = firma(l);
    for (const k of ['ids', 'tips', 'vistas']) {
      assert.deepEqual(a[k].filter((x) => !b[k].includes(x)), [], `ayuda ${l}: faltan ${k} que existen en ${base}`);
      assert.deepEqual(b[k].filter((x) => !a[k].includes(x)), [], `ayuda ${l}: sobran ${k} que no existen en ${base}`);
    }
  }
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
    for (const l of IDIOMAS_AYUDA) assert.ok(anclasDe(l).has(mapa[r]), `AYUDA_RUTA["${r}"] apunta a "${mapa[r]}", que no existe en la ayuda (${l})`);
  }
});

test('ayuda: cada botón tiene tooltip y cada "?" apunta a una sección', () => { for (const l of IDIOMAS_AYUDA) botonesYTooltips(l); });
function botonesYTooltips(l) {
  const tips = bloques[l].tips; const anclas = anclasDe(l);
  const alias = literal('TIP_ALIAS'); const sin = literal('SIN_TIP');
  const faltan = [];
  const pedir = (id, de) => { if (!tips[id]) faltan.push(`${id} (${de})`); };
  for (const act of todos(/data-act="([\w-]+)"/g)) {
    if (sin.includes(act) || ['panel', 'disc-panel', 'regla', 'tab'].includes(act)) continue;
    pedir(alias[act] || act, `data-act="${act}"`);
  }
  for (const p of todos(/\bbt\('([\w-]+)'/g)) pedir(alias['panel-' + p] || p, `panel ${p}`);
  // Paneles de una discrepancia (pestaña Discrepancias de un proyecto): su tooltip es disc-<panel>.
  for (const p of todos(/\bdbt\('([\w-]+)'/g)) pedir('disc-' + p, `panel de discrepancia ${p}`);
  for (const s of todos(/data-act="regla"[^>]*data-s="(\w+)"/g)) pedir('regla-' + s, `regla ${s}`);
  const tabs = app.slice(app.indexOf('function viewProyecto(')).match(/const tabs = \[(.*?)\];/)[1];
  for (const [, t] of tabs.matchAll(/\['(\w+)'/g)) pedir('proyecto-' + t, `pestaña ${t}`);
  for (const t of todos(/data-tip="([\w-]+)"/g)) pedir(t, 'data-tip');
  assert.deepEqual(faltan, [], `falta el tooltip (breve) en la ayuda ${l}`);
  for (const x of [...todos(/ayudaBtn\('([\w-]*\w)',/g), ...todos(/ayudaLink\('([\w-]*\w)',/g)]) assert.ok(anclas.has(x), `ayudaBtn/ayudaLink('${x}') no existe en la ayuda`);
  for (const id of Object.keys(tips)) assert.ok(anclas.has(id), `el tooltip ${id} no tiene ancla (${l})`);
}

test('ayuda: anclas únicas, links internos válidos y vistas conocidas', () => { for (const l of IDIOMAS_AYUDA) anclasYLinks(l); });
function anclasYLinks(l) {
  const bloque = bloques[l]; const anclas = anclasDe(l);
  const ids = idsAyuda(bloque.html);
  assert.equal(ids.length, anclas.size, 'ids repetidos');
  for (const [, id] of bloque.html.matchAll(/href="#ayuda-([\w-]+)"/g)) assert.ok(anclas.has(id), `link roto a #ayuda-${id}`);
  const vistas = app.match(/const vistas = \{([\s\S]*?)\};/)[1];
  for (const [, n] of bloque.html.matchAll(/<!--vista:([\w-]+):/g)) assert.ok(n === 'selector' || n === 'tarjeta' || new RegExp(`(^|[\\s{,'])${n}'?:`).test(vistas), `vista desconocida: ${n}`);
}

test('ayuda: las animaciones existen en el tablero y son las mismas en todos los idiomas', () => {
  const de = (l) => [...bloques[l].html.matchAll(/<canvas data-anim="([\w-]+)" data-t="([^"]*)"/g)].map((m) => `${m[1]}:${m[2].split('|').length}`);
  const [base, ...otros] = IDIOMAS_AYUDA;
  assert.ok(de(base).length >= 2, 'la introducción lleva sus animaciones');
  for (const l of otros) assert.deepEqual(de(l), de(base), `${l}: las animaciones (y su cantidad de etiquetas) difieren de ${base}`);
  const escenas = app.match(/const ANIM_ESC = \{([\s\S]*?)\n\};/)[1];
  for (const x of de(base)) assert.ok(new RegExp(`\\n  ${x.split(':')[0]}: \\{`).test(escenas), `animación desconocida en el tablero: ${x}`);
});
