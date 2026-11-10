// Compila la ayuda del tablero (dashboard/ayuda/*.mdx) y la inserta en dashboard/index.html.
// Uso: npm run build:ayuda            (regenera el bloque)
//      node scripts/build-ayuda.mjs --check   (falla si el bloque no está al día)
//
// El MDX se evalúa con un runtime JSX propio que produce HTML como texto: el tablero sigue siendo
// un solo archivo sin librerías. Componentes disponibles en los .mdx:
//   <Seccion id nivel titulo breve>   sección con ancla #ayuda-<id>; nivel 1, 2 o 3; breve = tooltip
//   <Accion id nombre breve solo>     botón de la app; breve = tooltip; solo = rol mínimo (p. ej. "Admin")
//   <Termino id nombre>definición</Termino>   entrada del glosario; la definición es su tooltip
//   <Vista nombre variante nota />    vista real de la app, dibujada con datos de ejemplo al abrir la ayuda
//   <Nota titulo>texto</Nota>         recuadro destacado (advertencias de la configuración inicial)
//
// El bloque generado empieza con el índice (<nav class="ay-toc">, tres niveles) y las tarjetas de entrada
// (una por sección de nivel 1, con su breve). El tablero arma con eso el índice lateral, el buscador y
// el resaltado de la sección que se está leyendo (ver viewAyuda y ayudaSync en index.html).

import { readFileSync, writeFileSync } from 'node:fs';
import { evaluate } from '@mdx-js/mdx';
import { fuentesAyuda, hashAyuda, leerBloque, idsAyuda, TABLERO, MARCA_INICIO, MARCA_FIN } from './lib/ayuda.mjs';

// ---------- runtime JSX → HTML ----------
class Html { constructor(s) { this.s = s; } }
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const VACIOS = new Set(['br', 'hr', 'img', 'input', 'wbr']);
const Fragment = Symbol('Fragment');
function aHtml(c) {
  if (c == null || c === false || c === true) return '';
  if (Array.isArray(c)) return c.map(aHtml).join('');
  if (c instanceof Html) return c.s;
  return esc(c);
}
function jsx(tipo, props = {}) {
  const { children, ...attrs } = props;
  if (tipo === Fragment) return new Html(aHtml(children));
  if (typeof tipo === 'function') return tipo(props);
  const a = Object.entries(attrs).filter(([, v]) => v != null && v !== false)
    .map(([k, v]) => ` ${k === 'className' ? 'class' : k}${v === true ? '' : `="${esc(v)}"`}`).join('');
  return new Html(VACIOS.has(tipo) ? `<${tipo}${a}>` : `<${tipo}${a}>${aHtml(children)}</${tipo}>`);
}
const texto = (html) => html.replace(/<[^>]+>/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

// ---------- componentes ----------
function componentes(tips) {
  const tip = (id, titulo, breve) => {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(id || '')) throw new Error(`id inválido: "${id}"`);
    if (breve) tips[id] = { titulo, breve };
  };
  return {
    Seccion({ id, nivel = '1', titulo, breve, children }) {
      const n = Number(nivel);
      if (![1, 2, 3].includes(n)) throw new Error(`Seccion ${id}: nivel tiene que ser 1, 2 o 3`);
      if (!titulo) throw new Error(`Seccion ${id}: falta titulo`);
      tip(id, titulo, breve);
      return new Html(`<section class="ay-sec n${n}" id="ayuda-${esc(id)}" data-nivel="${n}"><h${n + 1}>${esc(titulo)}</h${n + 1}>${breve ? `<p class="ay-breve">${esc(breve)}</p>` : ''}${aHtml(children)}</section>`);
    },
    Accion({ id, nombre, breve, solo, children }) {
      if (!nombre || !breve) throw new Error(`Accion ${id}: faltan nombre o breve`);
      tip(id, nombre, breve);
      return new Html(`<div class="ay-accion" id="ayuda-${esc(id)}"><div class="ay-accion-h"><span class="btn" aria-hidden="true">${esc(nombre)}</span>${solo ? `<span class="role-b">Solo ${esc(solo)}</span>` : ''}</div><p><b>${esc(breve)}</b></p>${aHtml(children)}</div>`);
    },
    Termino({ id, nombre, children }) {
      const def = aHtml(children);
      if (!nombre || !def) throw new Error(`Termino ${id}: faltan nombre o definición`);
      tip(id, nombre, texto(def));
      return new Html(`<div class="ay-term" id="ayuda-${esc(id)}"><b class="ay-term-n">${esc(nombre)}</b><div class="ay-term-d">${def}</div></div>`);
    },
    Nota({ titulo, children }) {
      return new Html(`<div class="ay-nota" role="note">${titulo ? `<b>${esc(titulo)}</b>` : ''}${aHtml(children)}</div>`);
    },
    Vista({ nombre, variante = '', nota }) {
      if (!/^[a-z-]+$/.test(nombre || '') || !/^[a-z-]*$/.test(variante)) throw new Error(`Vista inválida: ${nombre}/${variante}`);
      // Marcador que el tablero reemplaza por la vista real (ver vistaDemo en index.html).
      return new Html(`<figure class="ay-vista" inert><div class="ay-vista-c"><!--vista:${nombre}:${variante}--></div><figcaption>Ejemplo con datos ficticios${nota ? ` · ${esc(nota)}` : ''}</figcaption></figure>`);
    },
  };
}

// ---------- índice ----------
// Árbol de tres niveles: el tablero muestra siempre los dos primeros y abre el tercero en la sección activa.
function indice(html) {
  const secs = [...html.matchAll(/<section class="ay-sec n(\d)" id="ayuda-([\w-]+)" data-nivel="\d"><h\d>(.*?)<\/h\d>(?:<p class="ay-breve">(.*?)<\/p>)?/g)]
    .map((m) => ({ n: Number(m[1]), id: m[2], titulo: m[3], breve: m[4] || '', hijos: [] }));
  const grupos = [];
  for (const s of secs) {
    const g = grupos[grupos.length - 1]; const h = g && g.hijos[g.hijos.length - 1];
    if (s.n === 1) grupos.push(s);
    else if (s.n === 2 && g) g.hijos.push(s);
    else if (s.n === 3 && h) h.hijos.push(s);
  }
  const lista = (xs, n) => (xs.length ? `<ol class="n${n}">${xs.map((x) => `<li><a href="#ayuda-${x.id}">${x.titulo}</a>${lista(x.hijos, n + 1)}</li>`).join('')}</ol>` : '');
  return `<nav class="ay-toc" aria-label="Contenido de la ayuda">${lista(grupos, 1)}</nav>`
    + `<div class="ay-inicio">${grupos.map((g) => `<a class="ay-card" href="#ayuda-${g.id}"><b>${g.titulo}</b><span>${g.breve}</span></a>`).join('')}</div>`;
}

// ---------- build ----------
export async function construir() {
  const tips = {};
  const comps = componentes(tips);
  let cuerpo = '';
  for (const f of fuentesAyuda()) {
    let Contenido;
    try { ({ default: Contenido } = await evaluate(f.texto, { Fragment, jsx, jsxs: jsx, development: false })); }
    catch (e) { throw new Error(`${f.archivo}: ${e.message}`); }
    cuerpo += aHtml(Contenido({ components: comps }));
  }
  const ids = idsAyuda(cuerpo);
  const rep = ids.filter((x, i) => ids.indexOf(x) !== i);
  if (rep.length) throw new Error(`ids repetidos en la ayuda: ${[...new Set(rep)].join(', ')}`);
  const html = indice(cuerpo) + cuerpo;
  const json = JSON.stringify(tips).replace(/<\//g, '<\\/');
  return `${MARCA_INICIO} sha256=${hashAyuda()} · generado por scripts/build-ayuda.mjs desde dashboard/ayuda/*.mdx: no editar a mano -->\n`
    + `<template id="ayuda-tpl">${html}</template>\n`
    + `<script type="application/json" id="ayuda-tips">${json}</script>\n${MARCA_FIN}`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const tablero = readFileSync(TABLERO, 'utf8');
  const bloque = await construir();
  const i = tablero.indexOf(MARCA_INICIO); const j = tablero.indexOf(MARCA_FIN);
  if (i < 0 || j < i) throw new Error('No están los marcadores AYUDA:INICIO / AYUDA:FIN en dashboard/index.html');
  const nuevo = tablero.slice(0, i) + bloque + tablero.slice(j + MARCA_FIN.length);
  if (process.argv.includes('--check')) {
    if (nuevo !== tablero) { console.error('La ayuda de dashboard/index.html no está al día: corré npm run build:ayuda'); process.exit(1); }
    console.log('Ayuda al día');
  } else {
    writeFileSync(TABLERO, nuevo);
    const b = leerBloque(nuevo);
    console.log(`Ayuda generada: ${idsAyuda(b.html).length} anclas, ${Object.keys(b.tips).length} tooltips`);
  }
}
