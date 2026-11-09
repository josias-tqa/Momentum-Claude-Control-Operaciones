#!/usr/bin/env node
// Empareja cada proceso declarado de un proyecto (con su repo) con su proceso en Orchestrator.
//
// Uso: node scripts/emparejar-procesos.mjs --proyecto <project.json> --inventario <inventario.json> --repos <repos.json>
//   repos.json: array con la salida de fetch-repo.mjs de cada proceso ({ proceso, paquete, ... }).
// Salida (stdout, JSON): { processes: [...config con orchestratorProcess...], emparejados, sinEmparejar, sinDeclarar }
//
// Criterios, en orden: nombre ya declarado y existente > paquete del project.json == ProcessKey de Orchestrator
// > rol (dispatcher/performer/reporter) único > nombre parecido. Nunca adivina entre dos candidatos.
import { arg, leerJson, desenvolver } from './lib/args.mjs';
import { normalizarProyecto, inferirRol, configuracionDe } from './lib/proyecto.mjs';

export function emparejar(proyecto, inventario, repos = []) {
  const p = normalizarProyecto(proyecto);
  const orq = (inventario.inventory && inventario.inventory.processes) || inventario.processes || [];
  const usados = new Set();
  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const res = [];
  for (const x of p.processes) {
    const r = repos.find((y) => y.proceso === x.id) || {};
    let match = null; let criterio = null;
    const libres = orq.filter((o) => !usados.has(o.name));
    if (x.orchestratorProcess && libres.some((o) => o.name === x.orchestratorProcess)) { match = x.orchestratorProcess; criterio = 'declarado'; }
    if (!match && r.paquete) {
      const c = libres.filter((o) => norm(o.package) === norm(r.paquete) || norm(o.name) === norm(r.paquete));
      if (c.length === 1) { match = c[0].name; criterio = 'paquete'; }
    }
    if (!match && x.role !== 'other') {
      const c = libres.filter((o) => inferirRol(o.name) === x.role);
      if (c.length === 1) { match = c[0].name; criterio = 'rol'; }
    }
    if (!match) {
      const clave = norm(x.label);
      const c = clave.length >= 4 ? libres.filter((o) => norm(o.name).includes(clave) || clave.includes(norm(o.name))) : [];
      if (c.length === 1) { match = c[0].name; criterio = 'nombre'; }
    }
    if (match) usados.add(match);
    res.push({ ...x, orchestratorProcess: match || x.orchestratorProcess || null, __criterio: criterio });
  }
  const config = configuracionDe({ ...p, processes: res });
  return {
    processes: config.processes,
    emparejados: res.filter((x) => x.__criterio).map((x) => ({ proceso: x.id, orchestratorProcess: x.orchestratorProcess, criterio: x.__criterio })),
    sinEmparejar: res.filter((x) => !x.__criterio).map((x) => x.id),
    sinDeclarar: orq.filter((o) => !usados.has(o.name)).map((o) => o.name),
  };
}

if (process.argv[1] && process.argv[1].endsWith('emparejar-procesos.mjs')) {
  const proyecto = desenvolver(leerJson(arg('--proyecto')));
  const inventario = leerJson(arg('--inventario'));
  const repos = arg('--repos') ? leerJson(arg('--repos'), []) : [];
  console.log(JSON.stringify(emparejar(proyecto, inventario, repos), null, 2));
}
