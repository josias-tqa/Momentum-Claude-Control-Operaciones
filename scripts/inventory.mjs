#!/usr/bin/env node
// Inventario y baseline de un proyecto para el alta (/control-alta-proyecto). Solo lectura.
//
// Uso: node scripts/inventory.mjs --proyecto <project.json> --salida work/alta/<id>/inventario.json [--dias 30]
//
// Calcula, sobre los últimos N días:
//  - procesos y versiones, colas (con reintentos), assets (solo nombre/tipo), triggers, máquinas;
//  - volumen de jobs por proceso, tasa de falla, duración p50/p95, brecha máxima entre ejecuciones
//    (base de `baseline.expectedMaxGapHours`);
//  - excepciones de negocio por día y por cola (base de `baseline.businessExceptionsPerDay`);
//  - firmas de error más frecuentes (redactadas).

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { uip, uipTodo, login } from './lib/uip.mjs';
import { sanitizarJob, sanitizarQueueItem, sanitizarAsset, sanitizarLog } from './lib/redact.mjs';
import { normalizarFirma } from './lib/fingerprint.mjs';
import { arg, leerJson, desenvolver } from './lib/args.mjs';

const proyecto = desenvolver(leerJson(arg('--proyecto')));
const salida = arg('--salida');
const dias = Number(arg('--dias') || 30);
const F = ['--folder-path', proyecto.orchestrator.folderPath];
const desde = new Date(Date.now() - dias * 86400000).toISOString();
const errores = [];
const intentar = (n, fn, d = []) => { try { return fn(); } catch (e) { errores.push(`${n}: ${e.message}`); return d; } };

try { login(); } catch (e) { errores.push(`login: ${e.message}`); }

const percentil = (xs, p) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]; };

const procesos = intentar('processes', () => uipTodo(['or', 'processes', 'list', ...F], { maximo: 500 })).map((p) => ({ name: p.Name, version: p.ProcessVersion, key: p.Key, package: p.ProcessKey }));
const colas = intentar('queues', () => uipTodo(['or', 'queues', 'list', ...F], { maximo: 500 })).map((q) => ({ name: q.Name, key: q.Key, maxRetries: q.MaxNumberOfRetries ?? null, uniqueReference: q.EnforceUniqueReference ?? null, autoRetry: q.AcceptAutomaticallyRetry ?? null }));
const assets = intentar('assets', () => uipTodo(['or', 'assets', 'list', ...F], { maximo: 1000 })).map(sanitizarAsset);
const triggers = [
  ...intentar('triggers time', () => uip(['or', 'triggers', 'list', '--type', 'time', ...F, '--limit', '200'])).map((t) => ({ ...t, __t: 'time' })),
  ...intentar('triggers queue', () => uip(['or', 'triggers', 'list', '--type', 'queue', ...F, '--limit', '200'])).map((t) => ({ ...t, __t: 'queue' })),
].map((t) => ({ name: t.Name, type: t.__t, enabled: t.Enabled ?? null, cron: t.StartProcessCron ?? null, timezone: t.TimeZoneId ?? null, process: t.ReleaseName ?? null }));
const maquinas = intentar('machines', () => uip(['or', 'machines', 'list', ...F, '--limit', '100'])).map((m) => ({ name: m.Name, type: m.Type, unattendedSlots: m.UnattendedSlots ?? null }));

const jobs = intentar('jobs', () => uipTodo(['or', 'jobs', 'list', ...F, '--created-after', desde, '--sort-by', 'CreationTime desc'], { maximo: 10000 })).map(sanitizarJob);
const porProceso = {};
for (const j of jobs) (porProceso[j.proceso] ||= []).push(j);
const estadisticas = {};
const expectedMaxGapHours = {};
for (const [proc, js] of Object.entries(porProceso)) {
  const dur = js.filter((j) => j.inicio && j.fin).map((j) => (Date.parse(j.fin) - Date.parse(j.inicio)) / 60000);
  const creados = js.map((j) => Date.parse(j.creado)).filter(Number.isFinite).sort((a, b) => a - b);
  const brechas = creados.slice(1).map((t, i) => (t - creados[i]) / 3600000);
  const brechaMax = brechas.length ? Math.max(...brechas) : null;
  estadisticas[proc] = {
    jobs: js.length,
    porDia: Math.round((js.length / dias) * 10) / 10,
    tasaFalla: js.length ? Math.round((js.filter((j) => j.estado === 'Faulted').length / js.length) * 1000) / 1000 : 0,
    duracionMinP50: percentil(dur, 50),
    duracionMinP95: percentil(dur, 95),
    brechaMaxHoras: brechaMax !== null ? Math.round(brechaMax * 10) / 10 : null,
    horasDelDia: [...new Set(js.map((j) => new Date(j.creado).getUTCHours()))].sort((a, b) => a - b),
  };
  // Esperar como máximo 1,5x la brecha más larga observada (mínimo 2 h), si el proceso corre seguido.
  if (brechaMax !== null && js.length >= 10) expectedMaxGapHours[proc] = Math.max(2, Math.round(brechaMax * 1.5));
}

// Firmas de error más frecuentes (muestra de hasta 40 jobs fallidos).
const firmas = {};
for (const j of jobs.filter((x) => x.estado === 'Faulted').slice(0, 40)) {
  const lineas = intentar(`logs ${j.key}`, () => uip(['or', 'jobs', 'logs', j.key, ...F, '--level', 'Error', '--limit', '50']));
  const ult = (Array.isArray(lineas) ? lineas : []).filter((l) => ['Error', 'Fatal'].includes(l.Level)).slice(-1)[0];
  if (!ult) continue;
  const s = sanitizarLog(ult, j.key);
  const k = `${j.proceso}|${normalizarFirma(s.mensaje)}`;
  (firmas[k] ||= { proceso: j.proceso, ejemplo: s.mensaje, cantidad: 0 }).cantidad += 1;
}

// Excepciones de negocio por día y por cola (muestra limitada).
const businessExceptionsPerDay = {};
for (const q of colas) {
  const items = intentar(`queue-items ${q.name}`, () => uipTodo(['or', 'queue-items', 'list', ...F, '--queue-name', q.name, '--status', 'Failed', '--sort-by', 'Id desc', '--all-fields'], { maximo: 3000, corte: (it) => (it.EndProcessing || it.CreationTime || '') < desde }))
    .map((it) => sanitizarQueueItem(it, q.name)).filter((it) => (it.fin || it.creado) >= desde);
  const negocio = items.filter((i) => i.tipoExcepcion === 'Business').length;
  businessExceptionsPerDay[q.name] = Math.round((negocio / dias) * 10) / 10;
}

const resultado = {
  projectId: proyecto.id,
  generadoEn: new Date().toISOString(),
  dias,
  inventory: { processes: procesos, queues: colas, assets, triggers, machines: maquinas },
  estadisticas,
  firmasFrecuentes: Object.values(firmas).sort((a, b) => b.cantidad - a.cantidad).slice(0, 15),
  baseline: { expectedMaxGapHours, businessExceptionsPerDay },
  errores,
};
mkdirSync(dirname(salida), { recursive: true });
writeFileSync(salida, JSON.stringify(resultado, null, 2));
console.log(JSON.stringify({ projectId: proyecto.id, procesos: procesos.length, colas: colas.length, jobs: jobs.length, errores: errores.length }));
