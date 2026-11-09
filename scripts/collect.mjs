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
import { arg, leerJson, desenvolver } from './lib/args.mjs';
import { normalizarProyecto, carpetasDe, filtroDeProcesos } from './lib/proyecto.mjs';

const proyectoPath = arg('--proyecto');
const desde = arg('--desde');
const hasta = arg('--hasta') || new Date().toISOString();
const salida = arg('--salida');
const maxJobsLogs = Number(arg('--max-jobs-logs') || 40);
if (!proyectoPath || !desde || !salida) {
  console.error('Uso: collect.mjs --proyecto <json> --desde <ISO> --salida <json>');
  process.exit(2);
}

const proyecto = normalizarProyecto(desenvolver(leerJson(proyectoPath), proyectoPath.split('/').pop().replace('.json', '')));
const id = proyecto.id;
// Un proyecto puede tener varios procesos (dispatcher, performer...) en una o más carpetas.
const carpetas = carpetasDe(proyecto);
const soloProcesos = filtroDeProcesos(proyecto); // null = toda la carpeta
const errores = [];
if (!carpetas.length) errores.push('configuración: el proyecto no tiene carpeta de Orchestrator');
const delProyecto = (nombre) => !soloProcesos || soloProcesos.has(nombre);

function intentar(nombre, fn, porDefecto = []) {
  try { return fn(); } catch (e) { errores.push(`${nombre}: ${e.message}`); return porDefecto; }
}

const enVentana = (iso) => iso && iso >= desde && iso <= hasta;

try { login(); } catch (e) { errores.push(`login: ${e.message}`); }

const porKey = new Map();
let revisados = 0;
const jobs = [];
const logs = [];
const colas = [];
const queueItems = [];
const procesos = [];
const triggers = [];
const assets = [];

for (const carpeta of carpetas) {
  const F = ['--folder-path', carpeta];
  // Jobs creados en la ventana + los que siguen Pending/Running desde antes.
  const jobsVentana = intentar(`jobs [${carpeta}]`, () => uipTodo(['or', 'jobs', 'list', ...F, '--created-after', desde, '--sort-by', 'CreationTime desc'], { maximo: 3000 }));
  const pendientes = intentar(`jobs pending [${carpeta}]`, () => uipTodo(['or', 'jobs', 'list', ...F, '--state', 'Pending'], { maximo: 500 }));
  const corriendo = intentar(`jobs running [${carpeta}]`, () => uipTodo(['or', 'jobs', 'list', ...F, '--state', 'Running'], { maximo: 500 }));
  // Jobs creados ANTES de la ventana que terminaron dentro de ella (p. ej. esperaron horas en Pending).
  const terminadosVentana = intentar(`jobs ended [${carpeta}]`, () => uipTodo(['or', 'jobs', 'list', ...F, '--ended-after', desde, '--sort-by', 'EndTime desc'], { maximo: 3000 }));
  const nuevos = [];
  for (const j of [...jobsVentana, ...terminadosVentana, ...pendientes, ...corriendo]) {
    if (!j || !j.Key || porKey.has(j.Key) || !delProyecto(j.ProcessName)) continue;
    porKey.set(j.Key, j);
    const s = { ...sanitizarJob(j), carpeta };
    nuevos.push(s); jobs.push(s);
  }

  // Logs Error/Fatal de los jobs terminados en la ventana (los Pending/Running todavía no tienen).
  const terminados = nuevos
    .filter((j) => ['Faulted', 'Successful', 'Stopped'].includes(j.estado) && (enVentana(j.fin) || enVentana(j.creado)))
    .sort((a, b) => String(b.fin || b.creado).localeCompare(String(a.fin || a.creado)));
  // Prioridad: primero los fallidos, después los exitosos (para detectar fallas silenciosas).
  const paraLogs = [...terminados.filter((j) => j.estado !== 'Successful'), ...terminados.filter((j) => j.estado === 'Successful')].slice(0, Math.max(0, maxJobsLogs - revisados));
  revisados += paraLogs.length;
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
  const colasRaw = intentar(`queues [${carpeta}]`, () => uipTodo(['or', 'queues', 'list', ...F], { maximo: 500 }));
  const colasCarpeta = colasRaw.map((q) => ({ nombre: q.Name, key: q.Key, id: q.Id, carpeta, maxReintentos: q.MaxNumberOfRetries ?? null, pendientes: q.ItemsToProcess ?? null, enProceso: q.ItemsInProgress ?? null }))
    .filter((q) => !colas.some((c) => c.key && c.key === q.key));
  colas.push(...colasCarpeta);
  for (const q of colasCarpeta) {
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

  procesos.push(...intentar(`processes [${carpeta}]`, () => uipTodo(['or', 'processes', 'list', ...F], { maximo: 500 }))
    .filter((p) => delProyecto(p.Name))
    .map((p) => ({ nombre: p.Name, version: p.ProcessVersion, key: p.Key, paquete: p.ProcessKey, ultimaVersion: p.IsLatestVersion ?? null, carpeta })));
  triggers.push(...[
    ...intentar(`triggers time [${carpeta}]`, () => uip(['or', 'triggers', 'list', '--type', 'time', ...F, '--limit', '200'])).map((t) => ({ ...t, __tipo: 'time' })),
    ...intentar(`triggers queue [${carpeta}]`, () => uip(['or', 'triggers', 'list', '--type', 'queue', ...F, '--limit', '200'])).map((t) => ({ ...t, __tipo: 'queue' })),
  ].filter((t) => delProyecto(t.ReleaseName))
    .map((t) => ({ nombre: t.Name, tipo: t.__tipo, habilitado: t.Enabled ?? null, proceso: t.ReleaseName ?? null, cron: t.StartProcessCron ?? null, zona: t.TimeZoneId ?? null, carpeta })));
  assets.push(...intentar(`assets [${carpeta}]`, () => uipTodo(['or', 'assets', 'list', ...F], { maximo: 1000 })).map((a) => ({ ...sanitizarAsset(a), carpeta })));
} // fin del ciclo por carpeta

const senales = {
  projectId: id,
  carpetas,
  procesosDelProyecto: proyecto.processes.map((x) => ({ id: x.id, label: x.label, orchestratorProcess: x.orchestratorProcess || null, role: x.role })),
  filtradoPorProceso: Boolean(soloProcesos),
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
    jobsConLogsRevisados: revisados,
    queueItemsFallidos: queueItems.filter((i) => i.estado === 'Failed').length,
    queueItemsAbandonados: queueItems.filter((i) => i.estado === 'Abandoned').length,
  },
};

mkdirSync(dirname(salida), { recursive: true });
writeFileSync(salida, JSON.stringify(senales, null, 2));
console.log(JSON.stringify({ projectId: id, conteos: senales.conteos, errores: errores.length }));
