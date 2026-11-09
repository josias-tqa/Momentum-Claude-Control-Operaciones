#!/usr/bin/env node
// Colecta de señales de un proyecto desde Orchestrator (solo lectura), ya redactadas.
//
// Uso:
//   node scripts/collect.mjs --proyecto work/<run>/db/projects/<id>.json --desde <ISO> --salida work/<run>/<id>/senales.json
//   [--hasta <ISO>] [--max-jobs-logs 40]
// Con OPS_FIXTURES=<dir> lee respuestas simuladas en lugar de llamar al CLI.
//
// La salida contiene solo datos sanitizados (ver scripts/lib/redact.mjs). Los errores de
// colecta no abortan: se registran en `errores` para que la corrida los reporte (check de monitoreo).

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { uip, uipTodo, login } from './lib/uip.mjs';
import { sanitizarJob, sanitizarLog, sanitizarQueueItem, sanitizarAsset } from './lib/redact.mjs';
import { arg, leerJson } from './lib/args.mjs';

const proyectoPath = arg('--proyecto');
const desde = arg('--desde');
const hasta = arg('--hasta') || new Date().toISOString();
const salida = arg('--salida');
const maxJobsLogs = Number(arg('--max-jobs-logs') || 40);
if (!proyectoPath || !desde || !salida) {
  console.error('Uso: collect.mjs --proyecto <json> --desde <ISO> --salida <json>');
  process.exit(2);
}

const proyecto = leerJson(proyectoPath);
const id = proyecto.id || proyecto.__id || proyectoPath.split('/').pop().replace('.json', '');
const carpeta = proyecto.orchestrator && proyecto.orchestrator.folderPath;
const F = ['--folder-path', carpeta];
const errores = [];

function intentar(nombre, fn, porDefecto = []) {
  try { return fn(); } catch (e) { errores.push(`${nombre}: ${e.message}`); return porDefecto; }
}

const enVentana = (iso) => iso && iso >= desde && iso <= hasta;

try { login(); } catch (e) { errores.push(`login: ${e.message}`); }

// Jobs creados en la ventana + los que siguen Pending/Running desde antes.
const jobsVentana = intentar('jobs', () => uipTodo(['or', 'jobs', 'list', ...F, '--created-after', desde, '--sort-by', 'CreationTime desc'], { maximo: 3000 }));
const pendientes = intentar('jobs pending', () => uipTodo(['or', 'jobs', 'list', ...F, '--state', 'Pending'], { maximo: 500 }));
const corriendo = intentar('jobs running', () => uipTodo(['or', 'jobs', 'list', ...F, '--state', 'Running'], { maximo: 500 }));
const porKey = new Map();
for (const j of [...jobsVentana, ...pendientes, ...corriendo]) if (j && j.Key) porKey.set(j.Key, j);
const jobs = [...porKey.values()].map(sanitizarJob);

// Logs Error/Fatal de los jobs terminados en la ventana (los Pending/Running todavía no tienen).
const terminados = jobs
  .filter((j) => ['Faulted', 'Successful', 'Stopped'].includes(j.estado) && (enVentana(j.fin) || enVentana(j.creado)))
  .sort((a, b) => String(b.fin || b.creado).localeCompare(String(a.fin || a.creado)));
// Prioridad: primero los fallidos, después los exitosos (para detectar fallas silenciosas).
const paraLogs = [...terminados.filter((j) => j.estado !== 'Successful'), ...terminados.filter((j) => j.estado === 'Successful')].slice(0, maxJobsLogs);
const logs = [];
for (const j of paraLogs) {
  const vistos = new Set();
  for (const nivel of ['Error', 'Fatal']) {
    const lineas = intentar(`logs ${j.key}`, () => uip(['or', 'jobs', 'logs', j.key, ...F, '--level', nivel, '--limit', '200']));
    for (const l of Array.isArray(lineas) ? lineas : []) {
      if (!['Error', 'Fatal'].includes(l.Level)) continue;
      const k = `${l.TimeStamp}|${l.Message}`;
      if (vistos.has(k)) continue;
      vistos.add(k);
      logs.push({ ...sanitizarLog(l, j.key), proceso: j.proceso, estadoJob: j.estado });
    }
  }
}

// Colas e items fallidos/abandonados de la ventana (listado por Id desc, se corta al pasar el watermark).
const colasRaw = intentar('queues', () => uipTodo(['or', 'queues', 'list', ...F], { maximo: 500 }));
const colas = colasRaw.map((q) => ({ nombre: q.Name, key: q.Key, id: q.Id, maxReintentos: q.MaxNumberOfRetries ?? null, pendientes: q.ItemsToProcess ?? null, enProceso: q.ItemsInProgress ?? null }));
const queueItems = [];
for (const q of colas) {
  for (const estado of ['Failed', 'Abandoned']) {
    const items = intentar(`queue-items ${q.nombre} ${estado}`, () => uipTodo(
      ['or', 'queue-items', 'list', ...F, '--queue-name', q.nombre, '--status', estado, '--sort-by', 'Id desc', '--all-fields'],
      { maximo: 1000, corte: (it) => (it.EndProcessing || it.CreationTime || '') < desde },
    ));
    for (const it of items) {
      const s = sanitizarQueueItem(it, q.nombre);
      if (enVentana(s.fin || s.creado)) queueItems.push(s);
    }
  }
}

const procesos = intentar('processes', () => uipTodo(['or', 'processes', 'list', ...F], { maximo: 500 }))
  .map((p) => ({ nombre: p.Name, version: p.ProcessVersion, key: p.Key, paquete: p.ProcessKey, ultimaVersion: p.IsLatestVersion ?? null }));
const triggers = [
  ...intentar('triggers time', () => uip(['or', 'triggers', 'list', '--type', 'time', ...F, '--limit', '200'])).map((t) => ({ ...t, __tipo: 'time' })),
  ...intentar('triggers queue', () => uip(['or', 'triggers', 'list', '--type', 'queue', ...F, '--limit', '200'])).map((t) => ({ ...t, __tipo: 'queue' })),
].map((t) => ({ nombre: t.Name, tipo: t.__tipo, habilitado: t.Enabled ?? null, proceso: t.ReleaseName ?? null, cron: t.StartProcessCron ?? null, zona: t.TimeZoneId ?? null }));
const assets = intentar('assets', () => uipTodo(['or', 'assets', 'list', ...F], { maximo: 1000 })).map(sanitizarAsset);

const senales = {
  projectId: id,
  carpeta,
  ventana: { desde, hasta },
  colectadoEn: new Date().toISOString(),
  jobs,
  logs,
  queueItems,
  colas,
  procesos,
  triggers,
  assets,
  errores,
  conteos: {
    jobs: jobs.length,
    jobsPorEstado: jobs.reduce((a, j) => ((a[j.estado] = (a[j.estado] || 0) + 1), a), {}),
    logsErrorFatal: logs.length,
    jobsConLogsRevisados: paraLogs.length,
    queueItemsFallidos: queueItems.filter((i) => i.estado === 'Failed').length,
    queueItemsAbandonados: queueItems.filter((i) => i.estado === 'Abandoned').length,
  },
};

mkdirSync(dirname(salida), { recursive: true });
writeFileSync(salida, JSON.stringify(senales, null, 2));
console.log(JSON.stringify({ projectId: id, conteos: senales.conteos, errores: errores.length }));
