#!/usr/bin/env node
// Descubrimiento automático de proyectos (solo lectura).
//
// 1) Orchestrator: todos los procesos que la External App puede ver (--all-folders), con su carpeta,
//    paquete y versión, y su actividad de los últimos N días.
// 2) Agrupa por carpeta: cada carpeta con procesos es un proyecto candidato (Dispatcher, Performer,
//    Reporter...). La carpeta es la unidad habitual de despliegue de un proyecto.
// 3) Bitbucket (opcional): lista los repos de los workspaces indicados, lee el "name" de su project.json
//    y empareja cada proceso con su repo por nombre de paquete.
// 4) Marca los candidatos que ya están registrados en el tablero (misma carpeta) y los inactivos.
//
// Uso:
//   node scripts/descubrir.mjs --salida work/descubrimiento/candidatos.json
//        [--registrados work/<run>/db/projects] [--workspaces itmz,otro] [--dias 30] [--sin-bitbucket]
// La salida no contiene PII: nombres de carpetas, procesos, paquetes, repos y conteos.

import { writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { uipTodo, login } from './lib/uip.mjs';
import { listarRepos, paqueteDeRepo } from './lib/bitbucket-api.mjs';
import { arg, bandera, leerJson, desenvolver } from './lib/args.mjs';
import { normalizarProyecto, inferirRol, slugProceso } from './lib/proyecto.mjs';

const salida = arg('--salida');
const dias = Number(arg('--dias') || 30);
const dirRegistrados = arg('--registrados');
const desde = new Date(Date.now() - dias * 86400000).toISOString();
const errores = [];
const intentar = (n, fn, d = []) => { try { return fn(); } catch (e) { errores.push(`${n}: ${e.message}`); return d; } };

try { login(); } catch (e) { errores.push(`login: ${e.message}`); }

// ---------- Orchestrator ----------
const procesos = intentar('processes --all-folders', () => uipTodo(['or', 'processes', 'list', '--all-folders'], { maximo: 5000 }))
  .map((p) => ({ name: p.Name, key: p.Key, package: p.ProcessKey, version: p.ProcessVersion, folderPath: p.FolderPath || null }));
const jobs = intentar('jobs --all-folders', () => uipTodo(['or', 'jobs', 'list', '--all-folders', '--created-after', desde], { maximo: 20000 }));
const actividad = {};
for (const j of jobs) {
  const k = j.ReleaseKey || j.ProcessName;
  if (!k) continue;
  const a = (actividad[k] ||= { jobs: 0, faulted: 0, ultimo: null });
  a.jobs += 1;
  if (j.State === 'Faulted') a.faulted += 1;
  const t = j.EndTime || j.StartTime || j.CreationTime;
  if (t && (!a.ultimo || t > a.ultimo)) a.ultimo = t;
}
const actDe = (p) => actividad[p.key] || actividad[p.name] || { jobs: 0, faulted: 0, ultimo: null };

// ---------- registrados ----------
const registrados = dirRegistrados && existsSync(dirRegistrados)
  ? readdirSync(dirRegistrados).filter((f) => f.endsWith('.json')).map((f) => normalizarProyecto(desenvolver(leerJson(join(dirRegistrados, f)), f.replace(/\.json$/, ''))))
  : [];
const carpetaRegistrada = (fp) => registrados.find((r) => (r.orchestrator && r.orchestrator.folderPath) === fp || r.processes.some((x) => x.folderPath === fp));

// ---------- Bitbucket ----------
const workspaces = new Set((arg('--workspaces') || process.env.BITBUCKET_WORKSPACES || '').split(',').map((x) => x.trim()).filter(Boolean));
for (const r of registrados) for (const x of r.processes) if (x.repo && x.repo.workspace) workspaces.add(x.repo.workspace);
const repoPorPaquete = {};
const bitbucket = { workspaces: [...workspaces], repos: 0, conPaquete: 0, errores: [] };
if (!bandera('--sin-bitbucket')) {
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
    processes,
    sinRepo: processes.filter((x) => !x.repo).map((x) => x.orchestratorProcess),
  };
}).sort((a, b) => b.jobs - a.jobs);

const resultado = {
  generadoEn: new Date().toISOString(),
  dias,
  orchestrator: { procesos: procesos.length, carpetas: candidatos.length, jobsAnalizados: jobs.length, sinCarpeta: procesos.filter((p) => !p.folderPath).length },
  bitbucket,
  resumen: {
    nuevos: candidatos.filter((c) => c.activo && !c.registradoComo).length,
    yaRegistrados: candidatos.filter((c) => c.registradoComo).length,
    inactivos: candidatos.filter((c) => !c.activo && !c.registradoComo).length,
  },
  candidatos,
  errores,
};
mkdirSync(dirname(salida), { recursive: true });
writeFileSync(salida, JSON.stringify(resultado, null, 2));
console.log(JSON.stringify({ ...resultado.orchestrator, ...resultado.resumen, repos: bitbucket.repos, reposConPaquete: bitbucket.conPaquete, errores: errores.length + bitbucket.errores.length }));
