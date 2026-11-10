#!/usr/bin/env node
// Convierte los candidatos de descubrir.mjs en un plan de escrituras para el tablero:
// por cada carpeta ACTIVA y NO registrada, un proyecto (status pending_analysis) y su solicitud de alta.
// Con carpetas raíz configuradas en Ajustes, solo las que están adentro; nunca las que un Admin ignoró.
//
// Uso: node scripts/plan-descubrimiento.mjs --candidatos <candidatos.json> --salida <plan.json> [--incluir-inactivos] [--solo id1,id2]
// Después: node scripts/build-writes.mjs --plan <plan.json> --salida <dir> y publicar los lotes con ArtifactData batch.
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { arg, bandera, leerJson, desenvolver } from './lib/args.mjs';
import { idiomaDe, m } from './lib/idioma.mjs';

export function planDescubrimiento(candidatos, { incluirInactivos = false, solo = null, ahora = new Date().toISOString(), existentes = [], ajustes = {} } = {}) {
  const lang = idiomaDe(ajustes);
  const writes = [];
  const creados = [];
  const omitidos = [];
  const ids = new Set(existentes);
  for (const c of candidatos.candidatos || []) {
    if (c.registradoComo) { omitidos.push({ folderPath: c.folderPath, motivo: m(lang, 'plan.yaRegistrado', { id: c.registradoComo }) }); continue; }
    if (c.fueraDeLasRaices) { omitidos.push({ folderPath: c.folderPath, motivo: m(lang, 'plan.fuera') }); continue; }
    if (c.ignorada) { omitidos.push({ folderPath: c.folderPath, motivo: m(lang, 'plan.ignorada') }); continue; }
    if (!c.activo && !incluirInactivos) { omitidos.push({ folderPath: c.folderPath, motivo: m(lang, 'plan.sinJobs', { dias: candidatos.dias || 30 }) }); continue; }
    if (c.folderPath === '(sin carpeta)') { omitidos.push({ folderPath: c.folderPath, motivo: m(lang, 'plan.sinCarpeta') }); continue; }
    if (solo && !solo.includes(c.id)) continue;
    let id = c.id || 'proyecto';
    while (ids.has(id)) id = `${c.id}-${ids.size}`;
    ids.add(id);
    const processes = c.processes.map(({ _info, ...p }) => p);
    writes.push({
      op: 'set', collection: 'projects', doc_id: id,
      data: {
        name: c.name, status: 'pending_analysis', includeAllProcesses: true, orchestrator: { folderPath: c.folderPath }, processes, docs: { paths: [] }, triageCriteria: '',
        createdBy: 'descubrimiento', createdAt: ahora, updatedAt: ahora,
        discovery: {
          at: ahora, jobs: c.jobs, sinRepo: c.sinRepo,
          procesos: c.processes.map((p) => ({ id: p.id, package: p._info && p._info.package, version: p._info && p._info.version, jobs: p._info && p._info.jobs, faulted: p._info && p._info.faulted, reposAlternativos: (p._info && p._info.reposAlternativos) || [] })),
        },
      },
    });
    writes.push({ op: 'set', collection: 'requests', doc_id: `req-alta-${id}`, data: { type: 'onboard_project', projectId: id, requestedBy: 'descubrimiento', requestedAt: ahora, status: 'pending' } });
    creados.push({ id, name: c.name, folderPath: c.folderPath, procesos: processes.length, sinRepo: c.sinRepo, jobs: c.jobs });
  }
  return { writes, creados, omitidos };
}

if (process.argv[1] && process.argv[1].endsWith('plan-descubrimiento.mjs')) {
  const cand = leerJson(arg('--candidatos'));
  const plan = planDescubrimiento(cand, { incluirInactivos: bandera('--incluir-inactivos'), solo: arg('--solo') ? arg('--solo').split(',') : null, ajustes: arg('--ajustes') ? desenvolver(leerJson(arg('--ajustes'), {})) : {} });
  mkdirSync(dirname(arg('--salida')), { recursive: true });
  writeFileSync(arg('--salida'), JSON.stringify(plan, null, 2));
  console.log(JSON.stringify({ proyectos: plan.creados.length, omitidos: plan.omitidos.length, escrituras: plan.writes.length }));
}
