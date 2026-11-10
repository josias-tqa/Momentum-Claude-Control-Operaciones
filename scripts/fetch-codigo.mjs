#!/usr/bin/env node
// Código y documentación de un proceso EN LA VERSIÓN DESPLEGADA, desde el paquete de Orchestrator,
// más el de sus librerías propias en la versión exacta que usa. Extracción con lista blanca (sin datos,
// capturas ni planillas). Respaldo: el repo de Bitbucket, solo si el paquete no trae fuentes/docs y
// el proceso tiene repo configurado.
//
// Uso: node scripts/fetch-codigo.mjs --proyecto <project.json> --proceso <id | nombre en Orchestrator>
//        --destino work/<run>/codigo/<proyecto>/<proceso> [--indice <indice.json>] [--anterior] [--version X]
// Salida (stdout JSON): { fuente, proceso, paquete, version, ruta, archivos, docs, librerias[], anterior? }
import { spawnSync } from 'node:child_process';
import { readdirSync, statSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { arg, bandera, leerJson, desenvolver } from './lib/args.mjs';
import { normalizarProyecto, procesoPorNombre, carpetasDe } from './lib/proyecto.mjs';
import { uip, uipTodo } from './lib/uip.mjs';
import { descargar, extraerSeguro, leerProjectJson, leerDependencias, listar, docsDe } from './lib/paquetes.mjs';

const proyecto = normalizarProyecto(desenvolver(leerJson(arg('--proyecto'))));
const destino = arg('--destino');
const pedido = arg('--proceso');
const indice = arg('--indice') && existsSync(arg('--indice')) ? leerJson(arg('--indice')) : null;
const salir = (msg) => { console.error(msg); process.exit(1); };

const proc = proyecto.processes.find((x) => x.id === pedido || x.orchestratorProcess === pedido) || procesoPorNombre(proyecto, pedido);
const nombre = (proc && proc.orchestratorProcess) || pedido;
if (!nombre) salir('Falta --proceso');

// Paquete y versión desplegada: inventario del proyecto > índice de la corrida > Orchestrator.
const inv = ((proyecto.inventory && proyecto.inventory.processes) || []).find((x) => x.name === nombre)
  || ((indice && indice.procesos) || []).find((x) => x.name === nombre);
let paquete = inv && inv.package;
let version = arg('--version') || (inv && inv.version);
let carpeta = (proc && proc.folderPath) || (proyecto.orchestrator && proyecto.orchestrator.folderPath);
if (!paquete || !version) {
  for (const c of carpetasDe(proyecto)) {
    const p = (uipTodo(['or', 'processes', 'list', '--folder-path', c], { maximo: 500 }) || []).find((x) => x.Name === nombre);
    if (p) { paquete = p.ProcessKey; version = version || p.ProcessVersion; carpeta = c; break; }
  }
}
if (!paquete || !version) salir(`No se encontró el paquete desplegado de ${nombre}`);

// Documentos del paquete que un Admin desactivó desde el tablero (projects.disabledDocs, "<proceso>:<ruta>"):
// se borran de lo extraído, así ni el alta ni el análisis los pueden usar.
const desactivados = new Set(proyecto.disabledDocs || []);
const docDesactivado = (rel) => desactivados.has(`${nombre}:${rel}`);
function extraerProceso(ver, dir) {
  const f = descargar({ tipo: 'process', paquete, version: ver, carpeta });
  if (!f) return null;
  const todos = extraerSeguro(f, dir);
  const omitidos = todos.filter(docDesactivado);
  for (const rel of omitidos) rmSync(join(dir, rel), { force: true });
  return { nupkg: f, archivos: todos.filter((a) => !docDesactivado(a)), omitidos,
    docs: docsDe(listar(f)).map((e) => e.slice('content/'.length)).filter((a) => !docDesactivado(a)), deps: leerDependencias(leerProjectJson(f)) };
}

const actual = extraerProceso(version, join(destino, 'proceso'));
let fuente = 'package';
let respaldo = null;
const sinFuentes = !actual || !actual.archivos.some((a) => /\.(xaml|cs)$/i.test(a));
if ((sinFuentes || (actual && !actual.docs.length)) && proc && proc.repo && process.env.BITBUCKET_TOKEN) {
  // Respaldo: el repo (versión de rama o tag); lo hace fetch-repo.mjs.
  const r = spawnSync('node', [join(new URL('.', import.meta.url).pathname, 'fetch-repo.mjs'), '--proyecto', arg('--proyecto'), '--proceso', proc.id, '--destino', join(destino, 'repo'), '--version', version], { encoding: 'utf8' });
  if (r.status === 0) { respaldo = JSON.parse(r.stdout); if (sinFuentes) fuente = 'repo'; }
}
if (!actual && !respaldo) salir(`No se pudo obtener el código de ${nombre}@${version} (ni paquete ni repo)`);

// Librerías propias (directas e indirectas, hasta 3 niveles) en la versión exacta.
const librerias = [];
const vistas = new Set();
const bajarLib = (deps, nivel) => {
  for (const d of deps) {
    const k = `${d.name}@${d.version}`;
    if (vistas.has(k) || nivel > 3) continue;
    vistas.add(k);
    const f = descargar({ tipo: 'library', paquete: d.name, version: d.version });
    if (!f) { librerias.push({ ...d, ruta: null, error: 'no se pudo descargar (¿no es una librería del feed?)' }); continue; }
    const dir = join(destino, 'librerias', `${d.name}@${d.version}`);
    const archivos = extraerSeguro(f, dir);
    librerias.push({ ...d, ruta: dir, archivos: archivos.length, hasSources: archivos.some((a) => /\.(xaml|cs)$/i.test(a)) });
    bajarLib(leerDependencias(leerProjectJson(f)), nivel + 1);
  }
};
if (actual) bajarLib(actual.deps, 1);

// Versión anterior (para "qué cambió" tras un deploy): la mayor versión publicada menor a la actual.
let anterior = null;
if (bandera('--anterior') && actual) {
  const cmp = (a, b) => { const x = String(a).split('.').map(Number); const y = String(b).split('.').map(Number); for (let i = 0; i < Math.max(x.length, y.length); i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0); } return 0; };
  let versiones = [];
  try { versiones = (uip(['or', 'packages', 'versions', paquete]) || []).map((v) => v.Version || v.version).filter(Boolean); } catch { /* sin permisos o sin versiones */ }
  const previa = versiones.filter((v) => cmp(v, version) < 0).sort(cmp).pop();
  if (previa) {
    const dirAnt = join(destino, 'anterior');
    const ant = extraerProceso(previa, dirAnt);
    if (ant) {
      const hash = (f) => createHash('sha1').update(readFileSync(f)).digest('hex');
      const a = new Map(ant.archivos.map((x) => [x, hash(join(dirAnt, x))]));
      const b = new Map(actual.archivos.map((x) => [x, hash(join(destino, 'proceso', x))]));
      const depsCambiadas = actual.deps.filter((d) => { const o = ant.deps.find((x) => x.name === d.name); return !o || o.version !== d.version; })
        .map((d) => ({ name: d.name, antes: (ant.deps.find((x) => x.name === d.name) || {}).version || null, ahora: d.version }));
      anterior = {
        version: previa, ruta: dirAnt,
        cambios: {
          agregados: [...b.keys()].filter((k) => !a.has(k)),
          quitados: [...a.keys()].filter((k) => !b.has(k)),
          modificados: [...b.keys()].filter((k) => a.has(k) && a.get(k) !== b.get(k)),
          librerias: depsCambiadas,
        },
      };
    }
  }
}

console.log(JSON.stringify({
  fuente, proceso: proc ? proc.id : null, orchestratorProcess: nombre, paquete, version,
  ruta: actual ? join(destino, 'proceso') : respaldo.ruta,
  archivos: actual ? actual.archivos.length : null, docs: actual ? actual.docs : [], docsDesactivados: actual ? actual.omitidos : [],
  repo: respaldo ? { ruta: respaldo.ruta, ref: respaldo.ref, sha: respaldo.sha, docs: respaldo.docs } : null,
  librerias, anterior,
}, null, 2));
