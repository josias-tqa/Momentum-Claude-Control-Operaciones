#!/usr/bin/env node
// Evaluación determinista de un proyecto: checks base + reglas compiladas.
//
// Uso:
//   node scripts/evaluate.mjs --senales <senales.json> --proyecto <project.json> --reglas <rules.json>
//        [--ajustes <settings.json>] --salida <hallazgos.json>
//
// Produce:
//   checks:     resultado de cada punto de control (lo que el tablero muestra por corrida)
//   hallazgos:  candidatos a incidente, agrupados por tema (fingerprint), con evidencia redactada
// El triage (decisión final, porqué) lo hace Claude después, con criterios y memoria.

import { writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fingerprint, normalizarFirma } from './lib/fingerprint.mjs';
import { arg, leerJson, desenvolver } from './lib/args.mjs';
import { normalizarProyecto, procesoPorNombre } from './lib/proyecto.mjs';

// ---------- clasificación por texto ----------
const CATEGORIAS = [
  ['login', /log ?in|credential|credencial|password|contrase|authenticat|autentic|unauthori|401\b|access denied|acceso denegado/i],
  ['selector', /selector|ui ?element|element (was )?not found|could not find the ui|elemento no encontrado|uielementnotfound|nodenotfound/i],
  ['app_down', /timeout|timed out|unreachable|connection (refused|reset)|service unavailable|\b50[234]\b|could not connect|no se pudo conectar|host not found|name resolution/i],
  ['infrastructure', /license|licencia|robot is not|machine|session|out of memory|disk|no space|unable to connect to the uipath/i],
  ['configuration', /asset|queue .*(does not exist|not found)|config(uration)? (key|value)|missing (key|setting)|orchestrator folder/i],
];

export function categorizar(texto, porDefecto = 'application') {
  for (const [cat, re] of CATEGORIAS) if (re.test(texto || '')) return cat;
  return porDefecto;
}

const ORDEN_SEV = { P1: 1, P2: 2, P3: 3, P4: 4 };
export const masGrave = (a, b) => (ORDEN_SEV[a] <= ORDEN_SEV[b] ? a : b);

// ---------- evaluación de reglas compiladas ----------
function registrosDe(senales, signal) {
  if (signal === 'logs') return senales.logs.map((l) => ({ ...l, _t: l.fecha, _texto: l.mensaje, _proceso: l.proceso }));
  if (signal === 'jobs') return senales.jobs.map((j) => ({ ...j, _t: j.fin || j.creado, _texto: j.info || '', _proceso: j.proceso }));
  if (signal === 'queueItems') return senales.queueItems.map((q) => ({ ...q, _t: q.fin || q.creado, _texto: q.motivo || '', _cola: q.cola }));
  return [];
}

function coincide(reg, f = {}) {
  if (f.process && !String(reg._proceso || '').toLowerCase().includes(String(f.process).toLowerCase())) return false;
  if (f.queue && String(reg._cola || reg.cola || '') !== f.queue) return false;
  if (f.level && ![].concat(f.level).includes(reg.nivel)) return false;
  if (f.state && ![].concat(f.state).includes(reg.estado)) return false;
  if (f.status && ![].concat(f.status).includes(reg.estado)) return false;
  if (f.exceptionType && reg.tipoExcepcion !== f.exceptionType) return false;
  if (f.messageRegex) {
    let re;
    try { re = new RegExp(f.messageRegex, 'i'); } catch { return false; }
    if (!re.test(reg._texto || '')) return false;
  }
  return true;
}

function comparar(valor, comparador, umbral) {
  switch (comparador || '>=') {
    case '>': return valor > umbral;
    case '>=': return valor >= umbral;
    case '<': return valor < umbral;
    case '<=': return valor <= umbral;
    case '==': return valor === umbral;
    default: return valor >= umbral;
  }
}

// Categorías válidas de un incidente (schemas/incidents.schema.json). Una regla compilada con otra
// palabra ("no-ejecuto", "fallas-masivas"...) se traduce aquí para no romper la validación.
export const CATEGORIAS_VALIDAS = ['business', 'application', 'login', 'selector', 'app_down', 'data', 'infrastructure', 'configuration', 'scheduling', 'sla', 'regression', 'silent_failure', 'monitoring', 'deploy', 'other'];
export function normalizarCategoria(cat, textoAlternativo) {
  if (CATEGORIAS_VALIDAS.includes(cat)) return cat;
  const t = String(cat || '').toLowerCase();
  if (/ejecut|corri|run|ausen|schedul|trigger|program|pending/.test(t)) return 'scheduling';
  if (/login|credencial|auth/.test(t)) return 'login';
  if (/sla/.test(t)) return 'sla';
  if (/negocio|business/.test(t)) return 'business';
  if (/infra|robot|maquina|machine|licen/.test(t)) return 'infrastructure';
  if (/config|asset/.test(t)) return 'configuration';
  if (/selector|ui/.test(t)) return 'selector';
  if (/ca[ií]da|down|timeout/.test(t)) return 'app_down';
  return categorizar(textoAlternativo || t);
}

// Campos del filtro que definen el ALCANCE (sobre qué conjunto se calcula una tasa) frente a los que
// definen la CONDICIÓN (qué cuenta como "malo").
const ALCANCE = ['process', 'queue'];
const soloAlcance = (f = {}) => Object.fromEntries(Object.entries(f).filter(([k]) => ALCANCE.includes(k)));

export function evaluarRegla(regla, senales, proyecto = {}) {
  const c = regla.compiled || {};
  if (!c.signal || c.mode === 'llm') return { resultado: 'omitido', observado: null, motivo: 'regla en lenguaje natural: la evalúa Claude' };
  const todos = registrosDe(senales, c.signal).sort((a, b) => String(a._t).localeCompare(String(b._t)));
  const desdeVentana = c.windowMinutes ? new Date(Date.parse(senales.ventana.hasta) - c.windowMinutes * 60000).toISOString() : senales.ventana.desde;
  const enVentana = todos.filter((r) => !r._t || r._t >= desdeVentana);
  const match = enVentana.filter((r) => coincide(r, c.filter));
  let observado;
  switch (c.aggregate) {
    case 'consecutive': {
      let racha = 0;
      observado = 0;
      for (const r of enVentana) {
        racha = coincide(r, c.filter) ? racha + 1 : 0;
        observado = Math.max(observado, racha);
      }
      break;
    }
    case 'rate': {
      // Denominador: solo los registros del mismo alcance (p. ej. los jobs del Performer), no todos.
      const base = enVentana.filter((r) => coincide(r, soloAlcance(c.filter)));
      observado = base.length ? Math.round((match.length / base.length) * 1000) / 1000 : 0;
      if (base.length < Number(c.minSample || 3)) return { resultado: 'ok', observado, umbral: c.threshold ?? null, registros: [], motivo: 'muestra insuficiente' };
      break;
    }
    case 'absence': {
      // La colecta trae solo la última ventana (~1 h). Para "no corrió en N horas" se usa además el
      // último job conocido por proceso, que la consolidación guarda en watermarks.lastJobByProcess.
      const ultimoVisto = match.map((r) => r._t).filter(Boolean).sort().slice(-1)[0] || null;
      const proc = c.filter && c.filter.process;
      const guardado = proc && proyecto.watermarks && proyecto.watermarks.lastJobByProcess
        ? Object.entries(proyecto.watermarks.lastJobByProcess).filter(([n]) => n.toLowerCase().includes(String(proc).toLowerCase())).map(([, t]) => t).sort().slice(-1)[0]
        : null;
      const ultimo = [ultimoVisto, guardado].filter(Boolean).sort().slice(-1)[0] || null;
      if (!ultimo) return { resultado: 'omitido', observado: null, umbral: c.windowMinutes || null, registros: [], motivo: 'sin historial del proceso todavía' };
      const minutos = Math.round((Date.parse(senales.ventana.hasta) - Date.parse(ultimo)) / 60000);
      const limite = Number(c.windowMinutes || 60);
      return { resultado: minutos > limite ? 'alerta' : 'ok', observado: minutos, umbral: limite, registros: [], ultimo };
    }
    case 'count':
    default:
      observado = match.length;
  }
  const dispara = comparar(observado, c.comparator, Number(c.threshold ?? 1));
  return { resultado: dispara ? 'alerta' : 'ok', observado, umbral: c.threshold ?? 1, registros: dispara ? match : [] };
}

// ---------- utilidades de agrupación ----------
function agrupar(items, claveFn) {
  const m = new Map();
  for (const it of items) {
    const k = claveFn(it);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(it);
  }
  return m;
}

const minimo = (xs) => xs.filter(Boolean).sort()[0] || null;
const maximo = (xs) => xs.filter(Boolean).sort().slice(-1)[0] || null;

// ---------- evaluación ----------
const GENERICAS = new Set(['main', 'process', 'login', 'logout', 'init', 'initallapplications', 'initallsettings', 'closeallapplications', 'killallprocesses', 'gettransactiondata', 'settransactionstatus', 'retrycurrenttransaction', 'takescreenshot', 'test', 'validar', 'cerrar']);

// ¿El error ocurrió dentro de una librería que usa el proceso? Busca, como palabra completa, el nombre de
// una actividad de esas librerías (6+ letras, no genérica) o el nombre de la librería en el texto.
export function atribuirLibreria(texto, libsDelProceso, catalogo) {
  if (!texto || !libsDelProceso || !libsDelProceso.length) return null;
  const t = String(texto);
  const palabra = (w) => new RegExp(`(^|[^A-Za-z0-9_])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^A-Za-z0-9_])`).test(t);
  for (const l of libsDelProceso) {
    const acts = ((catalogo[l.name] && catalogo[l.name][l.version] && catalogo[l.name][l.version].activities) || [])
      .filter((a) => a.length >= 6 && !GENERICAS.has(a.toLowerCase()))
      .sort((a, b) => b.length - a.length);
    const act = acts.find(palabra);
    if (act) return { name: l.name, version: l.version, activity: act };
  }
  const porNombre = libsDelProceso.find((l) => palabra(l.name));
  return porNombre ? { name: porNombre.name, version: porNombre.version, activity: null } : null;
}

export function evaluar({ senales, proyecto: proyectoIn, reglas = [], ajustes = {}, librerias = {}, indice = null }) {
  const proyecto = normalizarProyecto(proyectoIn);
  const projectId = senales.projectId;
  // Firma con el formato anterior de cada mensaje (para no duplicar tarjetas abiertas antes del cambio).
  const firmaV1 = new Map();
  for (const l of senales.logs || []) if (l.firmaV1) firmaV1.set(l.mensaje, l.firmaV1);
  for (const q of senales.queueItems || []) if (q.firmaV1) firmaV1.set(q.motivo, q.firmaV1);
  // Librerías por proceso (índice de esta corrida o inventario guardado) y catálogo de actividades.
  const catalogo = { ...librerias, ...((indice && indice.libraries) || {}) };
  const libsDe = (proc) => {
    const i = ((indice && indice.procesos) || []).find((x) => x.name === proc)
      || (((proyecto.inventory && proyecto.inventory.processes) || []).find((x) => x.name === proc));
    return (i && i.libraries) || [];
  };
  const checks = [];
  const hallazgos = [];
  const pendMax = Number(ajustes.pendingMaxMinutes || 30);
  const hasta = senales.ventana.hasta;

  function hallazgo(h) {
    const fp = fingerprint({ projectId, categoria: h.categoria, proceso: h.proceso, cola: h.cola, firma: h.firmaBase ?? h.firma });
    const v1 = h.firmaBase === undefined && firmaV1.get(h.firma);
    const fpV1 = v1 ? fingerprint({ projectId, categoria: h.categoria, proceso: h.proceso, cola: h.cola, firmaNormalizada: v1 }) : null;
    // Proceso del proyecto (dispatcher, performer...) al que pertenece.
    const proc = procesoPorNombre(proyecto, h.proceso);
    // Librería donde ocurrió el error, si corresponde (procesos de los jobs / items involucrados).
    const procesosLib = [h.proceso, ...((h.evidencia && h.evidencia.logs) || []).map((l) => l.proceso)].filter(Boolean);
    const textos = [h.firma, ...((h.evidencia && (h.evidencia.logs || h.evidencia.muestra)) || []).map((x) => x.mensaje), ...((h.evidencia && h.evidencia.queueItems) || []).map((q) => q.motivo)].filter(Boolean).join(' \n ');
    const libsCandidatas = [...new Map(procesosLib.flatMap(libsDe).concat(h.proceso ? [] : proyecto.processes.flatMap((x) => libsDe(x.orchestratorProcess))).map((l) => [`${l.name}@${l.version}`, l])).values()];
    const libreria = atribuirLibreria(textos, libsCandidatas, catalogo);
    hallazgos.push({ id: fp, fingerprint: fp, fingerprintLegacy: fpV1 && fpV1 !== fp ? fpV1 : null, projectId, processId: proc ? proc.id : null, libreria, ...h, firmaNormalizada: normalizarFirma(h.firmaBase ?? h.firma) });
  }
  function check(id, nombre, resultado, observado, umbral) {
    checks.push({ id, nombre, resultado, observado, umbral: umbral ?? null });
  }

  // Mensaje de error representativo de un job: el último log Error/Fatal del job.
  const logsPorJob = agrupar(senales.logs, (l) => l.jobKey);
  const errorDeJob = (j) => {
    const ls = (logsPorJob.get(j.key) || []).slice().sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)));
    const ultimo = ls.filter((l) => l.nivel === 'Fatal').slice(-1)[0] || ls.slice(-1)[0];
    return ultimo ? ultimo.mensaje : (j.info || 'Job fallido sin mensaje de error disponible');
  };

  // 1) Jobs Faulted, agrupados por proceso + firma del error.
  const faulted = senales.jobs.filter((j) => j.estado === 'Faulted' && (j.fin || j.creado) >= senales.ventana.desde);
  check('jobs_faulted', 'Jobs con error (Faulted)', faulted.length ? 'alerta' : 'ok', faulted.length, 0);
  for (const [, grupo] of agrupar(faulted, (j) => `${j.proceso}|${normalizarFirma(errorDeJob(j))}`)) {
    const msg = errorDeJob(grupo[0]);
    const cat = categorizar(msg);
    hallazgo({
      checkId: 'jobs_faulted', categoria: cat, proceso: grupo[0].proceso, firma: msg,
      titulo: `${grupo[0].proceso}: ${grupo.length} job(s) con error${cat === 'login' ? ' de login' : ''}`,
      severidadSugerida: cat === 'login' || grupo.length >= 3 ? 'P2' : 'P3',
      conteo: grupo.length, primera: minimo(grupo.map((j) => j.fin || j.creado)), ultima: maximo(grupo.map((j) => j.fin || j.creado)),
      evidencia: { jobs: grupo.slice(0, 20).map((j) => ({ key: j.key, estado: j.estado, fin: j.fin, maquina: j.maquina })), logs: (logsPorJob.get(grupo[0].key) || []).slice(-5) },
    });
  }

  // 2) Jobs detenidos.
  const detenidos = senales.jobs.filter((j) => ['Stopped', 'Terminating'].includes(j.estado) && (j.fin || j.creado) >= senales.ventana.desde);
  check('jobs_stopped', 'Jobs detenidos', detenidos.length ? 'alerta' : 'ok', detenidos.length, 0);
  for (const [proc, grupo] of agrupar(detenidos, (j) => j.proceso)) {
    hallazgo({ checkId: 'jobs_stopped', categoria: 'infrastructure', proceso: proc, firma: 'job detenido', titulo: `${proc}: ${grupo.length} job(s) detenido(s)`,
      severidadSugerida: 'P3', conteo: grupo.length, primera: minimo(grupo.map((j) => j.fin || j.creado)), ultima: maximo(grupo.map((j) => j.fin || j.creado)),
      evidencia: { jobs: grupo.slice(0, 20).map((j) => ({ key: j.key, estado: j.estado, fin: j.fin })) } });
  }

  // 3) Jobs que esperan (o esperaron) robot demasiado tiempo: siguen en Pending, o arrancaron en esta
  //    ventana después de estar más de N minutos en cola.
  const minutosDesde = (iso) => (Date.parse(hasta) - Date.parse(iso)) / 60000;
  const espera = (j) => (j.estado === 'Pending' ? minutosDesde(j.creado) : (j.inicio && j.creado ? (Date.parse(j.inicio) - Date.parse(j.creado)) / 60000 : 0));
  const colgados = senales.jobs.filter((j) => j.creado && (j.estado === 'Pending' || (j.inicio && j.inicio >= senales.ventana.desde)) && espera(j) > pendMax);
  check('jobs_pending_long', `Jobs que esperaron robot más de ${pendMax} min`, colgados.length ? 'alerta' : 'ok', colgados.length, 0);
  for (const [proc, grupo] of agrupar(colgados, (j) => j.proceso)) {
    const peor = Math.max(...grupo.map(espera));
    const siguen = grupo.filter((j) => j.estado === 'Pending').length;
    hallazgo({ checkId: 'jobs_pending_long', categoria: 'scheduling', proceso: proc, firma: 'job pending demasiado tiempo',
      titulo: siguen ? `${proc}: ${siguen} job(s) esperando robot hace más de ${pendMax} min` : `${proc}: ${grupo.length} job(s) esperaron ${Math.round(peor / 60 * 10) / 10} h antes de arrancar`,
      severidadSugerida: peor > pendMax * 3 ? 'P2' : 'P3',
      conteo: grupo.length, primera: minimo(grupo.map((j) => j.creado)), ultima: maximo(grupo.map((j) => j.inicio || j.creado)),
      evidencia: { jobs: grupo.slice(0, 20).map((j) => ({ key: j.key, creado: j.creado, inicio: j.inicio || null, estado: j.estado })), minutosMaximo: Math.round(peor) } });
  }

  // 4) Falla silenciosa: job Successful con logs Fatal (quirk del framework TQA: GetTransactionData
  //    agota reintentos, loguea Fatal y el job termina Successful).
  const silenciosos = senales.jobs.filter((j) => j.estado === 'Successful' && (logsPorJob.get(j.key) || []).some((l) => l.nivel === 'Fatal'));
  check('silent_failure', 'Jobs exitosos con errores Fatal (falla silenciosa)', silenciosos.length ? 'alerta' : 'ok', silenciosos.length, 0);
  for (const [, grupo] of agrupar(silenciosos, (j) => `${j.proceso}|${normalizarFirma(errorDeJob(j))}`)) {
    const msg = errorDeJob(grupo[0]);
    hallazgo({ checkId: 'silent_failure', categoria: 'silent_failure', proceso: grupo[0].proceso, firma: msg,
      titulo: `${grupo[0].proceso}: terminó "Successful" pero registró errores Fatal`, severidadSugerida: 'P2', conteo: grupo.length,
      primera: minimo(grupo.map((j) => j.fin)), ultima: maximo(grupo.map((j) => j.fin)),
      evidencia: { jobs: grupo.slice(0, 20).map((j) => ({ key: j.key, fin: j.fin })), logs: (logsPorJob.get(grupo[0].key) || []).filter((l) => l.nivel === 'Fatal').slice(-5) } });
  }

  // 5) Queue items: excepciones de aplicación agrupadas por cola + motivo; abandonados por cola.
  const fallidosApp = senales.queueItems.filter((q) => q.estado === 'Failed' && q.tipoExcepcion !== 'Business');
  check('queue_app_exceptions', 'Items fallidos por excepción de sistema', fallidosApp.length ? 'alerta' : 'ok', fallidosApp.length, 0);
  for (const [, grupo] of agrupar(fallidosApp, (q) => `${q.cola}|${normalizarFirma(q.motivo)}`)) {
    const cat = categorizar(grupo[0].motivo);
    hallazgo({ checkId: 'queue_app_exceptions', categoria: cat, cola: grupo[0].cola, firma: grupo[0].motivo || 'sin motivo',
      titulo: `Cola ${grupo[0].cola}: ${grupo.length} item(s) con error de sistema`, severidadSugerida: cat === 'login' || grupo.length >= 10 ? 'P2' : 'P3',
      conteo: grupo.length, primera: minimo(grupo.map((q) => q.fin || q.creado)), ultima: maximo(grupo.map((q) => q.fin || q.creado)),
      evidencia: { queueItems: grupo.slice(0, 10) } });
  }
  const abandonados = senales.queueItems.filter((q) => q.estado === 'Abandoned');
  check('queue_abandoned', 'Items abandonados', abandonados.length ? 'alerta' : 'ok', abandonados.length, 0);
  for (const [cola, grupo] of agrupar(abandonados, (q) => q.cola)) {
    hallazgo({ checkId: 'queue_abandoned', categoria: 'infrastructure', cola, firma: 'items abandonados', titulo: `Cola ${cola}: ${grupo.length} item(s) abandonado(s)`,
      severidadSugerida: 'P3', conteo: grupo.length, primera: minimo(grupo.map((q) => q.creado)), ultima: maximo(grupo.map((q) => q.creado)),
      evidencia: { queueItems: grupo.slice(0, 10) } });
  }

  // 6) Excepciones de negocio por encima del baseline (si el alta calculó uno).
  const negocio = senales.queueItems.filter((q) => q.estado === 'Failed' && q.tipoExcepcion === 'Business');
  const base = (proyecto.baseline && proyecto.baseline.businessExceptionsPerDay) || {};
  const horasVentana = Math.max(1, (Date.parse(hasta) - Date.parse(senales.ventana.desde)) / 3600000);
  let sobreBase = 0;
  for (const [cola, grupo] of agrupar(negocio, (q) => q.cola)) {
    const esperado = base[cola] !== undefined ? (base[cola] * horasVentana) / 24 : null;
    if (esperado === null || grupo.length < 5 || grupo.length <= esperado * 2) continue;
    sobreBase += 1;
    hallazgo({ checkId: 'queue_business_rate', categoria: 'business', cola, firma: 'excepciones de negocio sobre baseline',
      titulo: `Cola ${cola}: ${grupo.length} excepciones de negocio (esperado ~${Math.round(esperado)})`, severidadSugerida: 'P3', conteo: grupo.length,
      primera: minimo(grupo.map((q) => q.fin)), ultima: maximo(grupo.map((q) => q.fin)),
      evidencia: { esperado: Math.round(esperado), motivos: [...agrupar(grupo, (q) => q.motivo)].map(([m, g]) => ({ motivo: m, cantidad: g.length })).slice(0, 10) } });
  }
  check('queue_business_rate', 'Excepciones de negocio sobre el baseline', sobreBase ? 'alerta' : (Object.keys(base).length ? 'ok' : 'omitido'), negocio.length, null);

  // 7) Triggers que estaban habilitados en el inventario y ahora no.
  const invTriggers = (proyecto.inventory && proyecto.inventory.triggers) || [];
  const deshabilitados = senales.triggers.filter((t) => t.habilitado === false && invTriggers.some((i) => i.name === t.nombre && i.enabled));
  check('trigger_disabled', 'Triggers deshabilitados', deshabilitados.length ? 'alerta' : 'ok', deshabilitados.length, 0);
  for (const t of deshabilitados) {
    hallazgo({ checkId: 'trigger_disabled', categoria: 'scheduling', proceso: t.proceso, firma: `trigger ${t.nombre} deshabilitado`, titulo: `Trigger "${t.nombre}" deshabilitado`,
      severidadSugerida: 'P3', conteo: 1, primera: hasta, ultima: hasta, evidencia: { trigger: t } });
  }

  // 8) Procesos sin ejecuciones más allá del intervalo esperado (baseline del alta).
  const brechas = (proyecto.baseline && proyecto.baseline.expectedMaxGapHours) || {};
  let sinCorrer = 0;
  for (const [proc, horas] of Object.entries(brechas)) {
    // Última actividad conocida: lo más reciente entre creación, inicio y fin de los jobs colectados y el
    // último job guardado de corridas anteriores. Sin ningún dato todavía no se alerta (primera corrida).
    const actividad = senales.jobs.filter((j) => j.proceso === proc).flatMap((j) => [j.creado, j.inicio, j.fin]);
    const guardado = proyecto.watermarks && proyecto.watermarks.lastJobByProcess && proyecto.watermarks.lastJobByProcess[proc];
    const ultimo = [...actividad, guardado].filter(Boolean).sort().slice(-1)[0] || null;
    if (!ultimo) continue;
    const horasSin = (Date.parse(hasta) - Date.parse(ultimo)) / 3600000;
    if (horasSin > horas) {
      sinCorrer += 1;
      hallazgo({ checkId: 'process_no_runs', categoria: 'scheduling', proceso: proc, firma: 'proceso sin ejecuciones', titulo: `${proc}: sin ejecuciones hace ${Number.isFinite(horasSin) ? Math.round(horasSin) + ' h' : 'mucho tiempo'}`,
        severidadSugerida: 'P2', conteo: 1, primera: ultimo || null, ultima: hasta, evidencia: { ultimoJob: ultimo || null, esperadoCadaHoras: horas } });
    }
  }
  check('process_no_runs', 'Procesos que no corrieron cuando se esperaba', sinCorrer ? 'alerta' : (Object.keys(brechas).length ? 'ok' : 'omitido'), sinCorrer, 0);

  // 9) Deploy detectado (cambio de versión respecto del inventario).
  const invProc = (proyecto.inventory && proyecto.inventory.processes) || [];
  const cambios = senales.procesos.filter((p) => { const i = invProc.find((x) => x.name === p.nombre); return i && i.version && p.version && i.version !== p.version; });
  check('deploy_detected', 'Versiones nuevas desplegadas', cambios.length ? 'alerta' : 'ok', cambios.length, 0);
  for (const p of cambios) {
    const anterior = invProc.find((x) => x.name === p.nombre).version;
    hallazgo({ checkId: 'deploy_detected', categoria: 'deploy', proceso: p.nombre, firma: `deploy ${p.version}`, titulo: `${p.nombre}: nueva versión ${p.version} (antes ${anterior})`,
      severidadSugerida: 'P4', conteo: 1, primera: hasta, ultima: hasta, evidencia: { versionAnterior: anterior, versionNueva: p.version } });
  }

  // 10) La propia colecta falló (credenciales vencidas, permisos, red).
  check('monitoring', 'Colecta de datos completa', senales.errores.length ? 'alerta' : 'ok', senales.errores.length, 0);
  if (senales.errores.length) {
    const loginFallo = senales.errores.some((e) => /^login/.test(e));
    hallazgo({ checkId: 'monitoring', categoria: 'monitoring', firma: loginFallo ? 'login fallido' : 'errores de colecta', titulo: loginFallo ? 'La Torre de Control no pudo iniciar sesión en Orchestrator' : `La colecta tuvo ${senales.errores.length} error(es)`,
      severidadSugerida: loginFallo ? 'P2' : 'P3', conteo: senales.errores.length, primera: hasta, ultima: hasta, evidencia: { errores: senales.errores.slice(0, 20) } });
  }

  // 11) Reglas compiladas activas del proyecto (y globales).
  const activas = reglas.filter((r) => r.status === 'active' && (r.projectId === projectId || r.projectId === '*'));
  for (const r of activas) {
    const c = r.compiled || {};
    const ev = evaluarRegla(r, senales, proyecto);
    check(`rule:${r.id}`, `Regla: ${r.text}`, ev.resultado, ev.observado, ev.umbral);
    if (ev.resultado !== 'alerta' || ['known', 'ignore'].includes(c.action)) continue;
    const muestra = ev.registros.slice(-5);
    const texto = muestra.map((x) => x._texto).find(Boolean) || r.text;
    const categoriaRegla = normalizarCategoria(c.category, texto);
    const procesoRegla = (c.filter && c.filter.process) || (muestra[0] && muestra[0]._proceso) || null;
    // Mismo tema que un hallazgo base (misma categoría y proceso/cola): se suma a esa tarjeta en vez de crear otra.
    const mismoTema = hallazgos.find((x) => x.categoria === categoriaRegla && (x.proceso || null) === procesoRegla && (!c.filter || !c.filter.queue || x.cola === c.filter.queue));
    if (mismoTema) {
      mismoTema.reglas = [...(mismoTema.reglas || []), r.id];
      mismoTema.ruleId = mismoTema.ruleId || r.id;
      mismoTema.severidadSugerida = masGrave(mismoTema.severidadSugerida, c.severity || 'P3');
      if (c.action === 'escalate') mismoTema.decisionSugerida = 'escalate';
      mismoTema.evidencia = { ...mismoTema.evidencia, regla: { id: r.id, texto: r.text, observado: ev.observado, umbral: ev.umbral } };
      continue;
    }
    hallazgo({ checkId: `rule:${r.id}`, ruleId: r.id, categoria: categoriaRegla, proceso: (c.filter && c.filter.process) || (muestra[0] && muestra[0]._proceso) || null,
      cola: (c.filter && c.filter.queue) || null, firma: `regla ${r.id}`, titulo: c.title || `Se cumplió la regla: ${r.text}`, severidadSugerida: c.severity || 'P3',
      decisionSugerida: c.action === 'escalate' ? 'escalate' : 'notify', conteo: ev.observado, primera: minimo(muestra.map((x) => x._t)), ultima: maximo(muestra.map((x) => x._t)),
      evidencia: { observado: ev.observado, umbral: ev.umbral, muestra: muestra.map(({ _t, _texto, _proceso, _cola, ...resto }) => resto) } });
  }

  // 12) Reglas "known"/"ignore": marcan hallazgos que coinciden como comportamiento conocido.
  for (const r of activas.filter((x) => ['known', 'ignore'].includes((x.compiled || {}).action))) {
    const f = (r.compiled || {}).filter || {};
    for (const h of hallazgos) {
      if (h.conocidoPor) continue;
      if (f.process && !String(h.proceso || '').toLowerCase().includes(String(f.process).toLowerCase())) continue;
      if (f.queue && h.cola !== f.queue) continue;
      if (f.messageRegex) { try { if (!new RegExp(f.messageRegex, 'i').test(h.firma || '')) continue; } catch { continue; } }
      if (!f.process && !f.queue && !f.messageRegex) continue;
      h.conocidoPor = r.id;
      h.decisionSugerida = r.compiled.action === 'ignore' ? 'known' : 'known';
    }
  }

  return { projectId, ventana: senales.ventana, conteos: senales.conteos, checks, hallazgos };
}

// ---------- CLI ----------
if (process.argv[1] && process.argv[1].endsWith('evaluate.mjs')) {
  const senales = leerJson(arg('--senales'));
  const proyecto = desenvolver(leerJson(arg('--proyecto')));
  const reglasIn = arg('--reglas') ? leerJson(arg('--reglas'), []) : [];
  // Acepta un array de reglas, un objeto {id: regla} o un único documento exportado.
  const lista = Array.isArray(reglasIn) ? reglasIn : (reglasIn && (reglasIn.data || reglasIn.text) ? [reglasIn] : Object.entries(reglasIn || {}).map(([id, r]) => ({ id, ...r })));
  const reglas = lista.map((r) => desenvolver(r));
  const ajustes = arg('--ajustes') ? desenvolver(leerJson(arg('--ajustes'), {})) : {};
  const indice = arg('--indice') ? leerJson(arg('--indice'), null) : null;
  // Catálogo guardado: directorio exportado de la colección libraries (un JSON por librería: { name, versions }).
  const librerias = {};
  if (arg('--librerias') && existsSync(arg('--librerias'))) {
    for (const f of readdirSync(arg('--librerias')).filter((x) => x.endsWith('.json'))) {
      const d = desenvolver(leerJson(join(arg('--librerias'), f)));
      if (d.name && d.versions) librerias[d.name] = d.versions;
    }
  }
  const salida = arg('--salida');
  const res = evaluar({ senales, proyecto, reglas, ajustes, indice, librerias });
  mkdirSync(dirname(salida), { recursive: true });
  writeFileSync(salida, JSON.stringify(res, null, 2));
  console.log(JSON.stringify({ projectId: res.projectId, alertas: res.checks.filter((c) => c.resultado === 'alerta').map((c) => c.id), hallazgos: res.hallazgos.length }));
}
