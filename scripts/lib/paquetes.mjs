// Paquetes (.nupkg) de Orchestrator como fuente de código y documentación de la versión DESPLEGADA.
// Validado 2026-11-09: el paquete de un proceso trae content/*.xaml, content/project.json (con las
// dependencias exactas) y la documentación; el de una librería trae sus .xaml.
//
// Seguridad / PII: los paquetes también publican Config.xlsx, CSV de Data/, capturas de excepción,
// .storage/... Nunca se extraen: solo se sacan los archivos de la lista blanca (extraerSeguro).
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, copyFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { uip } from './uip.mjs';

const RAIZ = resolve(dirname(new URL(import.meta.url).pathname), '..', '..');
const CACHE = process.env.OPS_PAQUETES_CACHE || join(RAIZ, 'work', '_paquetes');

export const OFICIALES = /^(UiPath\.|Microsoft\.|System\.|Newtonsoft\.|NETStandard\.|runtime\.)/i;
const EXT_PERMITIDAS = /\.(xaml|cs|vb|md|docx|pdf)$/i;
const PROHIBIDAS = /(^|\/)(Data|Exceptions_Screenshots|\.autopilot|\.claude|\.storage|\.settings|\.objects|\.local|\.screenshots|\.tmh|\.entities|\.project|Tests?)\//i;
const MAX_DOC = 5 * 1024 * 1024;
const DOCS_GENERICOS = /REFramework Documentation/i;

const nombreCache = (paquete, version) => `${paquete.replace(/[^A-Za-z0-9._-]/g, '_')}@${version}.nupkg`;

// Descarga (o reutiliza de la caché) un paquete. tipo: 'process' | 'library'. Devuelve la ruta o null.
export function descargar({ tipo, paquete, version, carpeta, clave }) {
  mkdirSync(CACHE, { recursive: true });
  const destino = join(CACHE, nombreCache(paquete, version));
  if (existsSync(destino) && statSync(destino).size > 0) return destino;
  if (process.env.OPS_FIXTURES) {
    const fx = join(process.env.OPS_FIXTURES, '..', 'paquetes', nombreCache(paquete, version));
    if (!existsSync(fx)) return null;
    copyFileSync(fx, destino);
    return destino;
  }
  // El destino debe estar bajo work/ (lo exigen uip.mjs y el hook de solo lectura).
  const rel = destino.startsWith(RAIZ) ? destino.slice(RAIZ.length + 1) : destino;
  const intentos = tipo === 'library'
    ? [['or', 'libraries', 'download', clave || `${paquete}:${version}`, '--destination', rel]]
    : [['or', 'packages', 'download', `${paquete}:${version}`, '--destination', rel],
       ...(carpeta ? [['or', 'packages', 'download', `${paquete}:${version}`, '--destination', rel, '--folder-path', carpeta]] : [])];
  for (const argv of intentos) {
    try { uip(argv, { timeoutMs: 300000 }); if (existsSync(destino)) return destino; } catch { /* siguiente intento */ }
  }
  return null;
}

export function listar(nupkg) {
  const r = spawnSync('unzip', ['-Z1', nupkg], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return r.status === 0 ? r.stdout.split('\n').filter(Boolean).map(decodeURIComponent) : [];
}

function leerEntrada(nupkg, entrada) {
  const r = spawnSync('unzip', ['-p', nupkg, entrada], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  return r.status === 0 ? r.stdout : null;
}

const entradaReal = (lista, nupkg) => { // unzip guarda nombres URL-encoded en nupkg; buscamos la forma cruda
  const crudas = spawnSync('unzip', ['-Z1', nupkg], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).stdout.split('\n').filter(Boolean);
  const m = new Map(crudas.map((c) => [decodeURIComponent(c), c]));
  return (x) => m.get(x) || x;
};

// Archivo de la lista blanca: bajo content/, extensión permitida, nunca carpetas sensibles ni rutas raras.
export function permitido(entrada) {
  if (!entrada.startsWith('content/') || entrada.includes('..') || entrada.startsWith('/')) return false;
  const rel = entrada.slice('content/'.length);
  if (rel === 'project.json') return true;
  if (PROHIBIDAS.test(rel)) return false;
  return EXT_PERMITIDAS.test(rel);
}

export function leerProjectJson(nupkg) {
  const lista = listar(nupkg);
  const real = entradaReal(lista, nupkg);
  const txt = lista.includes('content/project.json') ? leerEntrada(nupkg, real('content/project.json')) : null;
  if (!txt) return null;
  try { return JSON.parse(txt.replace(/^﻿/, '')); } catch { return null; }
}

// Dependencias propias (no oficiales) con versión exacta: "[1.0.147]" -> "1.0.147".
export function leerDependencias(projectJson) {
  const deps = (projectJson && projectJson.dependencies) || {};
  return Object.entries(deps)
    .filter(([n]) => !OFICIALES.test(n))
    .map(([name, v]) => ({ name, version: String(v).replace(/[[\]()\s]/g, '').split(',')[0] }));
}

// Actividades públicas de una librería: nombres de sus .xaml / .cs (sin carpetas internas).
export function actividadesDe(lista) {
  return [...new Set(lista.filter(permitido).filter((e) => /\.(xaml|cs)$/i.test(e))
    .map((e) => e.split('/').pop().replace(/\.(xaml|cs)$/i, '')))].sort();
}

// Sistemas que toca el código: portales web (host de las URLs) y aplicaciones de escritorio (app='x.exe' de
// los selectores). Sirve para saber qué procesos comparten un sistema y pueden sufrir el mismo error.
// Solo se guardan hosts y nombres de ejecutable: nunca rutas, parámetros ni credenciales.
const HOSTS_IGNORADOS = /(^|\.)(microsoft\.com|uipath\.com|w3\.org|xmlsoap\.org|openxmlformats\.org|nuget\.org|github\.com|example\.(com|org)|localhost)$/i;
const APPS_GENERICAS = /^(chrome|msedge|firefox|iexplore|explorer|excel|winword|outlook|notepad|cmd|powershell|uipath[a-z.]*)\.exe$/i;
export function sistemasEnTexto(texto) {
  const s = new Set();
  for (const m of String(texto || '').matchAll(/https?:\/\/([a-z0-9][a-z0-9.-]*\.[a-z]{2,})(?=[:/?#"'&\s<]|$)/gi)) {
    const h = m[1].toLowerCase().replace(/^www\./, '');
    if (!HOSTS_IGNORADOS.test(h)) s.add(`web:${h}`);
  }
  for (const m of String(texto || '').matchAll(/\bapp=(?:'|"|&apos;|&quot;)([a-z0-9 _.-]{2,60}\.exe)/gi)) {
    const a = m[1].toLowerCase();
    if (!APPS_GENERICAS.test(a)) s.add(`app:${a}`);
  }
  return [...s].sort();
}
export function sistemasDe(nupkg, lista = listar(nupkg)) {
  const real = entradaReal(lista, nupkg);
  const s = new Set();
  for (const e of lista.filter(permitido).filter((x) => /\.(xaml|cs|vb)$/i.test(x)).slice(0, 400)) {
    for (const x of sistemasEnTexto(leerEntrada(nupkg, real(e)) || '')) s.add(x);
  }
  return [...s].sort().slice(0, 40);
}

// Cuántos archivos sensibles publica el paquete (para avisar al equipo de desarrollo).
export function higiene(lista) {
  const c = (re) => lista.filter((e) => re.test(e)).length;
  return {
    capturas: c(/Exceptions_Screenshots\/.*\.(png|jpe?g)$/i),
    datos: c(/content\/Data\/.*\.(xlsx|csv|json|txt)$/i) - c(/placeholder\.txt$/i),
    internos: c(/content\/(\.autopilot|\.claude|\.storage)\//i),
  };
}

export function tieneFuentes(lista) {
  return lista.some((e) => permitido(e) && /\.(xaml|cs)$/i.test(e));
}

export function docsDe(lista) {
  return lista.filter((e) => permitido(e) && /\.(md|docx|pdf)$/i.test(e) && !DOCS_GENERICOS.test(e));
}

// Extrae SOLO la lista blanca a `destino` (directorio nuevo). Devuelve las rutas extraídas (relativas a content/).
export function extraerSeguro(nupkg, destino) {
  rmSync(destino, { recursive: true, force: true });
  mkdirSync(destino, { recursive: true });
  const lista = listar(nupkg);
  const real = entradaReal(lista, nupkg);
  const elegidas = lista.filter(permitido).filter((e) => !DOCS_GENERICOS.test(e));
  const extraidas = [];
  for (const e of elegidas) {
    const rel = e.slice('content/'.length);
    const r = spawnSync('unzip', ['-p', nupkg, real(e)], { maxBuffer: MAX_DOC + 1 });
    if (r.status !== 0 || !r.stdout || r.stdout.length > MAX_DOC) continue;
    const f = join(destino, rel);
    if (!resolve(f).startsWith(resolve(destino))) continue;
    mkdirSync(dirname(f), { recursive: true });
    writeFileSync(f, r.stdout);
    extraidas.push(rel);
  }
  return extraidas;
}
