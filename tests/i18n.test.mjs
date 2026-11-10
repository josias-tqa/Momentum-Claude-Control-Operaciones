// Garantiza que el tablero esté siempre en todos los idiomas: mismas claves, mismos parámetros,
// bloque generado al día y ningún texto visible escrito a mano fuera de los catálogos.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TABLERO } from '../scripts/lib/ayuda.mjs';
import { IDIOMAS, IDIOMA_BASE, catalogos, archivosCatalogo, paramsDe, hashI18n, leerBloqueI18n } from '../scripts/lib/i18n.mjs';

const cat = catalogos();
const html = readFileSync(TABLERO, 'utf8');
const iApp = html.indexOf('<script>\n(() => {');
const app = html.slice(iApp);
const marco = html.slice(0, html.indexOf('<!-- I18N:INICIO'));
const sinComentarios = (src) => src.split('\n').map((l) => (/^\s*\/\//.test(l) ? '' : l.replace(/\s\/\/ .*$/, (m) => (m.includes('i18n-ok') ? m : ''))));

test('los idiomas tienen los mismos archivos, claves y parámetros', () => {
  const base = archivosCatalogo(IDIOMA_BASE);
  assert.ok(base.length > 0, 'catálogo base vacío');
  for (const l of IDIOMAS) assert.deepEqual(archivosCatalogo(l), base, `${l}: los archivos del catálogo difieren de ${IDIOMA_BASE}`);
  for (const l of IDIOMAS.filter((x) => x !== IDIOMA_BASE)) {
    const a = Object.keys(cat[IDIOMA_BASE]); const b = Object.keys(cat[l]);
    assert.deepEqual(a.filter((k) => !(k in cat[l])), [], `${l}: faltan claves que existen en ${IDIOMA_BASE}`);
    assert.deepEqual(b.filter((k) => !(k in cat[IDIOMA_BASE])), [], `${l}: sobran claves que no existen en ${IDIOMA_BASE}`);
    for (const k of a) assert.deepEqual(paramsDe(cat[l][k]), paramsDe(cat[IDIOMA_BASE][k]), `${l}: los {parámetros} de ${k} no coinciden`);
  }
  for (const l of IDIOMAS) for (const [k, v] of Object.entries(cat[l])) assert.ok(typeof v === 'string' && v.trim() !== '' || v === '', `${l}: ${k} debe ser texto`);
});

test('el bloque generado de index.html está al día', () => {
  const b = leerBloqueI18n(html);
  assert.ok(b, 'falta el bloque I18N en dashboard/index.html: corré npm run build:i18n');
  assert.equal(b.hash, hashI18n(), 'los textos cambiaron: corré npm run build:i18n');
  for (const l of IDIOMAS) assert.deepEqual(b.catalogos[l], Object.fromEntries(Object.keys(cat[l]).sort().map((k) => [k, cat[l][k]])), `bloque ${l} desactualizado`);
});

test('toda clave usada existe y no hay claves sin usar', () => {
  const usadas = new Set(); const prefijos = new Set();
  const fuente = sinComentarios(`${marco}\n${app}`).join('\n');
  for (const m of fuente.matchAll(/\b(?:tx|hay)\(\s*['"`]([\w.]+)['"`](?!\s*\+)/g)) usadas.add(m[1]);
  for (const m of fuente.matchAll(/\btxp\(\s*[^,]+,\s*['"`]([\w.]+)['"`](?!\s*\+)/g)) { usadas.add(`${m[1]}.one`); usadas.add(`${m[1]}.other`); }
  for (const m of fuente.matchAll(/data-i18n(?:-aria|-ph|-title)?="([\w.]+)"/g)) usadas.add(m[1]);
  for (const m of fuente.matchAll(/\b(?:tmap|tlist)\(\s*['"`]([\w.]+)['"`]/g)) prefijos.add(m[1]);
  for (const m of fuente.matchAll(/\b(?:tx|hay)\(\s*['"`]([\w.]+)['"`]\s*\+/g)) prefijos.add(m[1]);
  for (const m of fuente.matchAll(/\btxp\(\s*[^,]+,\s*['"`]([\w.]+)['"`]\s*\+/g)) prefijos.add(m[1]);
  // claves que se arman con una variable: se declaran con /* i18n-keys: prefijo. */ en el código
  for (const m of fuente.matchAll(/i18n-keys:\s*([\w.]+)/g)) prefijos.add(m[1]);
  const faltan = [...usadas].filter((k) => !(k in cat[IDIOMA_BASE]));
  assert.deepEqual(faltan, [], `claves usadas que no existen en el catálogo: ${faltan.join(', ')}`);
  const sinUso = Object.keys(cat[IDIOMA_BASE]).filter((k) => !usadas.has(k) && ![...prefijos].some((p) => k.startsWith(p)));
  assert.deepEqual(sinUso, [], `claves sin usar (borralas o usalas): ${sinUso.join(', ')}`);
});

// Un texto visible escrito a mano rompe "todo en ambos idiomas": debe salir de tx()/txp(). Si un literal NO es texto
// de interfaz (un identificador, una sigla, un dato de ejemplo), se marca la línea con "// i18n-ok: motivo".
test('no quedan textos visibles escritos a mano', () => {
  const malos = [];
  const revisar = (nombre, src, desde = 1) => sinComentarios(src).forEach((l, i) => {
    if (!l.trim() || l.includes('i18n-ok')) return;
    const quitado = l.replace(/\$\{[^}]*\}/g, '').replace(/<(?:script|style)[\s\S]*?$/, '');
    const motivos = [];
    if (/[áéíóúñüÁÉÍÓÚÑ¿¡]/.test(quitado.replace(/\/[^/\n]*[áéíóúñ][^/\n]*\/[gimsuy]*/g, ''))) motivos.push('acentos o ¿¡ (texto en español)');
    if (/>\s*[^<>{}$\n]*[A-Za-zÁ-ú]{3,}[^<>{}$\n]*</.test(quitado.replace(/<[^>]*>/g, (t) => t.replace(/>/g, '\u0001')).replace(/\u0001/g, '>')) && /<\w[^>]*>[^<>$]*[A-Za-zÁ-ú]{3,}[^<>$]*</.test(quitado)) motivos.push('texto entre etiquetas');
    if (/\b(?:aria-label|placeholder|title|alt)="[^"$]*[A-Za-zÁ-ú]{2,}/.test(quitado)) motivos.push('atributo visible');
    if (/\b(?:toast\(|S\.error\s*=)\s*['"`][^'"`$]*[A-Za-z]{3,}/.test(quitado)) motivos.push('mensaje');
    if (/\bpl\(/.test(quitado) && !/const pl =/.test(quitado)) motivos.push('pl() en desuso: usá txp()');
    if (motivos.length) malos.push(`${nombre}:${desde + i}  [${motivos.join(', ')}]  ${l.trim().slice(0, 110)}`);
  });
  revisar('index.html(marco)', marco.slice(marco.indexOf('</style>')));
  revisar('index.html(app)', app, html.slice(0, iApp).split('\n').length);
  assert.deepEqual(malos, [], `${malos.length} texto(s) sin pasar por tx():\n${malos.slice(0, 40).join('\n')}${malos.length > 40 ? `\n… y ${malos.length - 40} más` : ''}`);
});
