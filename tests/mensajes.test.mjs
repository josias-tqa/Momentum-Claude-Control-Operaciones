// Los textos que generan los scripts de la rutina salen de scripts/lib/mensajes/<idioma>.json (un solo idioma por
// texto, el de config/settings.language). Este test exige las mismas claves y {parámetros} en todos los idiomas y que
// los scripts no escriban texto en español a mano: un texto nuevo va con m(lang, 'clave') y su clave en es y en en.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { IDIOMAS_RUTINA, IDIOMA_RUTINA_BASE, mensajes, idiomaDe, m } from '../scripts/lib/idioma.mjs';
import { RAIZ } from '../scripts/lib/ayuda.mjs';
import { IDIOMAS } from '../scripts/lib/i18n.mjs';

const params = (t) => [...new Set([...String(t).matchAll(/\{(\w+)\}/g)].map((x) => x[1]))].sort();

test('mensajes: mismas claves y parámetros en todos los idiomas', () => {
  const base = mensajes(IDIOMA_RUTINA_BASE);
  assert.deepEqual(IDIOMAS_RUTINA, IDIOMAS, 'los idiomas de la rutina y del tablero deben ser los mismos');
  for (const l of IDIOMAS_RUTINA.filter((x) => x !== IDIOMA_RUTINA_BASE)) {
    const o = mensajes(l);
    assert.deepEqual(Object.keys(base).filter((k) => !(k in o)), [], `${l}: faltan claves`);
    assert.deepEqual(Object.keys(o).filter((k) => !(k in base)), [], `${l}: sobran claves`);
    for (const k of Object.keys(base)) assert.deepEqual(params(o[k]), params(base[k]), `${l}: parámetros de ${k}`);
  }
});

test('mensajes: idiomaDe y m', () => {
  assert.equal(idiomaDe({ language: 'en' }), 'en');
  assert.equal(idiomaDe({ language: 'fr' }), 'es');
  assert.equal(idiomaDe(null), 'es');
  assert.equal(m('en', 'eval.tiempo.horas', { n: 5 }), '5 h');
  assert.equal(m('xx', 'eval.tiempo.mucho'), 'mucho tiempo');
  assert.equal(m('en', 'no.existe'), 'no.existe');
});

test('mensajes: toda clave usada existe y no hay claves sin usar', () => {
  const dir = join(RAIZ, 'scripts');
  const fuentes = readdirSync(dir).filter((f) => f.endsWith('.mjs')).map((f) => readFileSync(join(dir, f), 'utf8')).join('\n');
  const usadas = new Set([...fuentes.matchAll(/\b(?:m|M)\(\s*(?:lang|idiomaDe\([^)]*\)|'\w+')\s*,\s*'([\w.]+)'/g)].map((x) => x[1]));
  for (const x of fuentes.matchAll(/\bM\(\s*'([\w.]+)'/g)) usadas.add(x[1]);
  for (const x of fuentes.matchAll(/'(\w+\.\w+(?:\.\w+)?)'/g)) if (x[1] in mensajes('es')) usadas.add(x[1]);
  assert.deepEqual([...usadas].filter((k) => !(k in mensajes('es')) && /^(eval|cons|disc|aprob|desc|plan)\./.test(k)), [], 'claves usadas que no existen');
  assert.deepEqual(Object.keys(mensajes('es')).filter((k) => !usadas.has(k)), [], 'claves sin usar');
});

// Un texto en español escrito a mano en un script rompe "un solo idioma por configuración". Si un literal no es texto
// para personas (firma que alimenta el fingerprint, regex, identificador), se marca la línea con "// i18n-ok: motivo".
test('mensajes: los scripts no escriben texto visible en español a mano', () => {
  const dir = join(RAIZ, 'scripts');
  const malos = [];
  for (const f of ['evaluate', 'consolidar', 'consolidar-discrepancias', 'aprobar-reglas', 'descubrir', 'plan-descubrimiento']) {
    readFileSync(join(dir, `${f}.mjs`), 'utf8').split('\n').forEach((l, i) => {
      if (/^\s*\/\//.test(l) || l.includes('i18n-ok')) return;
      const sinCom = l.replace(/\s\/\/ .*$/, '').replace(/\/(?:\\.|[^/\n])+\/[gimsuy]*/g, '');
      if (/[áéíóúñ¿¡]/i.test(sinCom)) malos.push(`${f}.mjs:${i + 1}  ${l.trim().slice(0, 100)}`);
    });
  }
  assert.deepEqual(malos, [], `texto en español sin pasar por m():\n${malos.join('\n')}`);
});
