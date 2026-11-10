#!/usr/bin/env node
// Descubrimiento automático de proyectos (solo lectura).
//
// 1) Orchestrator: todas las carpetas que la External App puede ver, y en cada una sus procesos, con su carpeta,
//    paquete y versión, y su actividad de los últimos N días.
// 2) Agrupa por carpeta: cada carpeta con procesos es un proyecto candidato (Dispatcher, Performer,
//    Reporter...). La carpeta es la unidad habitual de despliegue de un proyecto.
// 3) Bitbucket (opcional): lista los repos de los workspaces indicados, lee el "name" de su project.json
//    y empareja cada proceso con su repo por nombre de paquete.
// 4) Marca los candidatos que ya están registrados en el tablero (misma carpeta) y los inactivos.
//
// Carpetas raíz: un Admin indica en Ajustes (config/settings.discovery.rootFolders) qué carpeta escanear.
// Con --ajustes (o --raices) solo se proponen las carpetas que están adentro de esas raíces; las que el
// Admin ignoró (discovery.ignoredFolders) se marcan y no se registran solas.
//
// Uso:
//   node scripts/descubrir.mjs --salida work/descubrimiento/candidatos.json
//        [--registrados work/<run>/db/projects] [--ajustes work/<run>/db/config/settings.json] [--raices "A,B"]
//        [--carpetas "A/B,C/D"] [--workspaces itmz,otro] [--dias 30] [--sin-bitbucket] [--plan-tablero <plan.json>]
// La salida no contiene PII: nombres de carpetas, procesos, paquetes, repos y conteos.

import { writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { uipTodo, login } from './lib/uip.mjs';
import { listarRepos, paqueteDeRepo } from './lib/bitbucket-api.mjs';
import { arg, bandera, leerJson, desenvolver } from './lib/args.mjs';
import { normalizarProyecto, inferirRol, slugProceso } from './lib/proyecto.mjs';
import { listaDeCarpetas, limpiarCarpeta, raizDe, dentroDe, mismaCarpeta } from './lib/carpetas.mjs';

const salida = arg('--salida');
const dias = Number(arg('--dias') || 30);
const dirRegistrados = arg('--registrados');
const desde = new Date(Date.now() - dias * 86400000).toISOString();
const errores = [];
const intentar = (n, fn, d = []) => { try { return fn(); } catch (e) { errores.push(`${n}: ${e.message}`); return d; } };
const probar = (fn, d = []) => { try { return fn(); } catch { return d; } };

// ---------- carpetas raíz e ignoradas (Ajustes del tablero) ----------
const ajustes = arg('--ajustes') ? desenvolver(leerJson(arg('--ajustes'), {})) : {};
const ajDesc = ajustes.discovery || {};
const raices = listaDeCarpetas(arg('--raices') !== undefined ? arg('--raices') : ajDesc.rootFolders || []);
const ignoradas = listaDeCarpetas(ajDesc.ignoredFolders || []);

try { login(); } catch (e) { errores.push(`login: ${e.message}`); }

// ---------- registrados (se leen primero: sus carpetas siempre se consultan) ----------
const registradosPrevios = dirRegistrados && existsSync(dirRegistrados)
  ? readdirSync(dirRegistrados).filter((f) => f.endsWith('.json')).map((f) => normalizarProyecto(desenvolver(leerJson(join(dirRegistrados, f)), f.replace(/\.json$/, ''))))
  : [];

// ---------- Orchestrator ----------
// Con una External App (client credentials) Orchestrator NO acepta consultas "--all-folders"
// ("A folder is required for this action", validado 2026-11-09): hay que enumerar carpetas y
// consultar cada una. La lista de carpetas sale de: `folders list --all` (requiere permiso de
// ver carpetas a nivel tenant), `folders list`, las carpetas indicadas con --carpetas, y las de
// los proyectos ya registrados.
const rutaDe = (f) => f.FullyQualifiedName || f.FullyQualifiedNameOrderable || f.Path || f.FolderPath || f.DisplayName || null;
const carpetasVistas = [...new Set([
  ...intentar('folders list --all', () => uipTodo(['or', 'folders', 'list', '--all'], { maximo: 5000 })),
  ...intentar('folders list', () => uipTodo(['or', 'folders', 'list'], { maximo: 5000 })),
  // Subcarpetas de cada raíz: sirve cuando la app no puede listar todo el tenant pero sí esa rama.
  ...raices.flatMap((r) => probar(() => uipTodo(['or', 'folders', 'list', '--path', r], { maximo: 5000 }))),
].map(rutaDe).filter(Boolean).map(limpiarCarpeta))];
// Con carpetas raíz, del listado solo cuentan las que están adentro.
const carpetasListadas = carpetasVistas.filter((c) => dentroDe(c, raices));
const carpetasManual = listaDeCarpetas(arg('--carpetas') || process.env.OPS_CARPETAS || '');
const carpetasRegistradas = registradosPrevios.flatMap((r) => [r.orchestrator && r.orchestrator.folderPath, ...r.processes.map((x) => x.folderPath)]).filter(Boolean);
// La raíz misma se consulta siempre: puede tener procesos propios, y es lo único que se puede leer si no hay listado.
const carpetas = listaDeCarpetas([...carpetasListadas, ...raices, ...carpetasManual, ...carpetasRegistradas]);
const fuenteCarpetas = { listadas: carpetasListadas.length, fueraDeLasRaices: carpetasVistas.length - carpetasListadas.length, raices: raices.length, manuales: carpetasManual.length, registradas: carpetasRegistradas.length };
// Se propone lo que está dentro de una raíz (o todo, si no hay raíces) y lo que se pidió a mano.
const proponible = (fp) => dentroDe(fp, raices) || carpetasManual.some((m) => mismaCarpeta(m, fp));

const procesos = [];
const actividad = {};
let jobsAnalizados = 0;
for (const carpeta of carpetas) {
  const F = ['--folder-path', carpeta];
  const ps = intentar(`processes [${carpeta}]`, () => uipTodo(['or', 'processes', 'list', ...F], { maximo: 500 }));
  if (!ps.length) continue; // carpeta contenedora (sin procesos propios) o sin acceso
  procesos.push(...ps.map((p) => ({ name: p.Name, key: p.Key, package: p.ProcessKey, version: p.ProcessVersion, folderPath: carpeta })));
  const jobs = intentar(`jobs [${carpeta}]`, () => uipTodo(['or', 'jobs', 'list', ...F, '--created-after', desde], { maximo: 10000 }));
  jobsAnalizados += jobs.length;
  for (const j of jobs) {
    // Orchestrator devuelve el Key del proceso en MAYÚSCULAS y el ReleaseKey del job en minúsculas:
    // se compara siempre en minúsculas.
    const k = String(j.ReleaseKey || j.ProcessName || '').toLowerCase();
    if (!k) continue;
    const a = (actividad[k] ||= { jobs: 0, faulted: 0, ultimo: null });
    a.jobs += 1;
    if (j.State === 'Faulted') a.faulted += 1;
    const t = j.EndTime || j.StartTime || j.CreationTime;
    if (t && (!a.ultimo || t > a.ultimo)) a.ultimo = t;
  }
}
const actDe = (p) => actividad[String(p.key || '').toLowerCase()] || actividad[String(p.name || '').toLowerCase()] || { jobs: 0, faulted: 0, ultimo: null };

const registrados = registradosPrevios;
const carpetaRegistrada = (fp) => registrados.find((r) => mismaCarpeta(r.orchestrator && r.orchestrator.folderPath, fp) || r.processes.some((x) => x.folderPath && mismaCarpeta(x.folderPath, fp)));

// ---------- Bitbucket ----------
const workspaces = new Set((arg('--workspaces') || process.env.BITBUCKET_WORKSPACES || '').split(',').map((x) => x.trim()).filter(Boolean));
for (const r of registrados) for (const x of r.processes) if (x.repo && x.repo.workspace) workspaces.add(x.repo.workspace);
const repoPorPaquete = {};
const bitbucket = { workspaces: [...workspaces], repos: 0, conPaquete: 0, errores: [] };
// Bitbucket es opcional: el código y la documentación salen de los paquetes de Orchestrator.
if (!bandera('--sin-bitbucket') && process.env.BITBUCKET_TOKEN) {
  for (const ws of workspaces) {
    const l = listarRepos(ws);
    if (l.http !== 200) { bitbucket.errores.push(`${ws}: no se pudieron listar los repos (HTTP ${l.http}). El token puede no tener alcance de workspace.`); continue; }
    bitbucket.repos += l.repos.length;
    for (const repo of l.repos) {
      const { paquete } = paqueteDeRepo(ws, repo.slug, repo.branch);
      if (!paquete) continue;
      bitbucket.conPaquete += 1;
      const k = paquete.toLowerCase();
      (repoPorPaquete[k] ||= []).push({ workspace: ws, slug: repo.slug, branch: repo.branch, updated: repo.updated });
    }
  }
}
// Si dos repos declaran el mismo paquete (p. ej. una copia vieja), se elige el actualizado más reciente
// y se avisa, para que un humano confirme.
function repoDe(p) {
  const c = repoPorPaquete[String(p.package || '').toLowerCase()] || repoPorPaquete[String(p.name || '').toLowerCase()] || [];
  if (!c.length) return { repo: null, alternativas: [] };
  const orden = c.slice().sort((a, b) => String(b.updated).localeCompare(String(a.updated)));
  return { repo: { workspace: orden[0].workspace, slug: orden[0].slug, branch: orden[0].branch }, alternativas: orden.slice(1).map((x) => `${x.workspace}/${x.slug}`) };
}

// ---------- candidatos por carpeta ----------
const nombreLegible = (fp) => {
  const hoja = String(fp || '').split('/').filter(Boolean).pop() || fp;
  return hoja.replace(/([a-záéíóúñ])([A-ZÁÉÍÓÚÑ])/g, '$1 $2').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
};
const porCarpeta = {};
for (const p of procesos) (porCarpeta[p.folderPath || '(sin carpeta)'] ||= []).push(p);

const candidatos = Object.entries(porCarpeta).map(([folderPath, ps]) => {
  const usados = new Set();
  const processes = ps.map((p) => {
    const rol = inferirRol(`${p.name} ${p.package}`);
    let id = slugProceso(rol !== 'other' ? rol : p.name);
    while (usados.has(id)) id = `${id}-${slugProceso(p.name)}`.slice(0, 60);
    usados.add(id);
    const { repo, alternativas } = repoDe(p);
    const a = actDe(p);
    return {
      id, label: rol !== 'other' ? rol[0].toUpperCase() + rol.slice(1) : p.name, orchestratorProcess: p.name, role: rol, folderPath: null, repo,
      docs: { paths: [] },
      _info: { package: p.package, version: p.version, jobs: a.jobs, faulted: a.faulted, ultimoJob: a.ultimo, reposAlternativos: alternativas },
    };
  });
  const jobsTotal = processes.reduce((s, x) => s + x._info.jobs, 0);
  const reg = carpetaRegistrada(folderPath);
  return {
    folderPath,
    name: nombreLegible(folderPath),
    id: slugProceso(folderPath.split('/').filter(Boolean).slice(-2).join('-')),
    activo: jobsTotal > 0,
    jobs: jobsTotal,
    registradoComo: reg ? reg.id : null,
    root: raizDe(folderPath, raices),
    fueraDeLasRaices: !proponible(folderPath),
    ignorada: ignoradas.some((x) => mismaCarpeta(x, folderPath)),
    processes,
    sinRepo: processes.filter((x) => !x.repo).map((x) => x.orchestratorProcess),
  };
}).sort((a, b) => b.jobs - a.jobs);

const resultado = {
  generadoEn: new Date().toISOString(),
  dias,
  raices,
  orchestrator: { carpetasConsultadas: carpetas.length, fuenteCarpetas, carpetasConProcesos: candidatos.length, procesos: procesos.length, jobsAnalizados },
  bitbucket,
  resumen: {
    nuevos: candidatos.filter((c) => c.activo && !c.registradoComo && !c.fueraDeLasRaices && !c.ignorada).length,
    yaRegistrados: candidatos.filter((c) => c.registradoComo).length,
    inactivos: candidatos.filter((c) => !c.activo && !c.registradoComo && !c.fueraDeLasRaices).length,
    ignorados: candidatos.filter((c) => c.ignorada && !c.registradoComo).length,
    fueraDeLasRaices: candidatos.filter((c) => c.fueraDeLasRaices && !c.registradoComo).length,
  },
  candidatos,
  errores,
};
mkdirSync(dirname(salida), { recursive: true });
writeFileSync(salida, JSON.stringify(resultado, null, 2));
// Documento para el tablero (config/discovery): los proyectos propuestos, es decir las carpetas con procesos
// que todavía no son un proyecto. Las ignoradas se incluyen: el tablero las oculta con su propia lista, así
// vuelven a verse en cuanto un Admin las restaura.
// Si falló el login no se escribe: una lista vacía por un problema de acceso borraría las propuestas vigentes.
const sinAcceso = errores.some((e) => e.startsWith('login'));
if (arg('--plan-tablero') && !sinAcceso) {
  const folders = candidatos.filter((c) => !c.registradoComo && !c.fueraDeLasRaices && c.folderPath !== '(sin carpeta)').slice(0, 500)
    .map((c) => ({ folderPath: c.folderPath, name: c.name, procesos: c.processes.map((p) => p.orchestratorProcess).slice(0, 50), jobs30d: c.jobs, ...(c.root ? { root: c.root } : {}) }));
  const avisos = [];
  if (raices.length && !carpetasListadas.length) avisos.push('No se pudieron listar las subcarpetas: solo se revisó la carpeta indicada. La External App necesita un rol de tenant que permita ver carpetas (Folders → View).');
  for (const r of raices) if (!candidatos.some((c) => mismaCarpeta(c.root, r))) avisos.push(`No se encontraron procesos dentro de ${r}: revisar que la ruta sea exacta y que la External App esté asignada a esa carpeta.`);
  const data = { at: resultado.generadoEn, roots: raices, folders, ...(avisos.length ? { note: avisos.join(' ').slice(0, 2000) } : {}) };
  writeFileSync(arg('--plan-tablero'), JSON.stringify({ writes: [{ op: 'set', collection: 'config', doc_id: 'discovery', data }] }, null, 2));
}
console.log(JSON.stringify({ ...resultado.orchestrator, ...resultado.resumen, raices, repos: bitbucket.repos, reposConPaquete: bitbucket.conPaquete, errores: errores.length + bitbucket.errores.length,
  ...(arg('--plan-tablero') ? { planTablero: !sinAcceso } : {}) }));
