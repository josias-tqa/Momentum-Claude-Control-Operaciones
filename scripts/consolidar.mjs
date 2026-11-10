#!/usr/bin/env node
// Consolida una corrida: une los hallazgos (evaluate.mjs) con el triage de Claude y con los
// incidentes ya existentes en el tablero, y produce el plan de escrituras.
//
// Regla de oro: UNA tarjeta por tema. Si ya hay un incidente abierto con el mismo fingerprint
// (o Claude indicó `mergeInto`), se suma la ocurrencia en vez de crear otro. Si el tema se había
// cerrado hace menos de 30 días, se reabre la misma tarjeta.
//
// Uso:
//   node scripts/consolidar.mjs --run-id <id> --run-dir work/<run> [--triage work/<run>/triage.json]
//        [--trigger scheduled|manual|dry_run] [--session-url <url>] [--inicio <ISO>]
// Lee:  <run-dir>/<projectId>/hallazgos.json y senales.json, <run-dir>/db/{incidents,incidentWork,projects}/*.json
// Escribe: <run-dir>/plan.json  ({ writes, analizar, resumen })

import { readdirSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { arg, leerJson, desenvolver } from './lib/args.mjs';
import { inferirRol, slugProceso } from './lib/proyecto.mjs';
import { idiomaDe, m } from './lib/idioma.mjs';

const ORDEN_SEV = { P1: 1, P2: 2, P3: 3, P4: 4 };
const masGrave = (a, b) => (ORDEN_SEV[a] <= ORDEN_SEV[b] ? a : b);
const DIAS_REAPERTURA = 30;

// Lee una colección exportada con ArtifactData (out_dir). Los archivos traen solo el cuerpo del
// documento; la versión (necesaria para if_version) la registra el agente en <db>/_versiones.json
// como { "coleccion/docId": version }, copiándola del resultado del list/query.
export function leerColeccion(dir) {
  if (!existsSync(dir)) return [];
  const coleccion = dir.split('/').filter(Boolean).pop();
  const versiones = leerJson(join(dir, '..', '_versiones.json'), {});
  return readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => {
    const id = f.replace(/\.json$/, '');
    const doc = desenvolver(leerJson(join(dir, f)), id);
    if (!doc.__version && versiones[`${coleccion}/${id}`]) doc.__version = versiones[`${coleccion}/${id}`];
    return doc;
  });
}

function decisionPorDefecto(h) {
  if (h.conocidoPor) return 'known';
  if (h.decisionSugerida) return h.decisionSugerida;
  if (h.categoria === 'deploy') return 'monitor';
  return ORDEN_SEV[h.severidadSugerida] <= 2 ? 'escalate' : 'notify';
}

// Una tarjeta se "reporta" (aparece en la bandeja) si la decisión es escalate/notify.
export const esReportable = (decision) => decision === 'escalate' || decision === 'notify';

export function consolidar({ runId, inicio, fin, trigger, sessionUrl, proyectos, incidentes, trabajo, porProyecto, triage = {}, librerias = [], reanalizar = [], ajustes = {} }) {
  const lang = idiomaDe(ajustes);
  const writes = [];
  const analizar = [];
  const runProyectos = [];
  const ahora = fin;
  const abiertos = incidentes.filter((i) => i.status === 'open');
  const cerradosRecientes = incidentes.filter((i) => i.status === 'closed' && i.closedAt && (Date.parse(ahora) - Date.parse(i.closedAt)) / 86400000 <= DIAS_REAPERTURA);
  const tocados = new Map(); // id -> doc actualizado (para no escribir dos veces el mismo doc)

  const buscarPorFp = (lista, fp, projectId, fpLegacy) => lista.find((i) => i.projectId === projectId && ((i.fingerprints || []).includes(fp) || (fpLegacy && (i.fingerprints || []).includes(fpLegacy))));

  for (const { projectId, hallazgos, senales, indice = null } of porProyecto) {
    const nuevos = [];
    const actualizados = [];
    const resumenHallazgos = [];
    for (const h of hallazgos.hallazgos) {
      const t = triage[h.id] || {};
      const decision = t.decision || decisionPorDefecto(h);
      const severidad = t.severity || h.severidadSugerida;
      const categoria = t.category || h.categoria;
      const tri = {
        category: categoria,
        severity: severidad,
        decision,
        rationale: t.rationale || (h.conocidoPor ? m(lang, 'cons.rationale.regla', { regla: h.conocidoPor }) : m(lang, 'cons.rationale.auto')),
        confidence: t.confidence || (t.rationale ? 'media' : 'baja'),
        matchedRules: t.matchedRules || (h.ruleId ? [h.ruleId] : h.conocidoPor ? [h.conocidoPor] : []),
        memoryRefs: t.memoryRefs || [],
        at: ahora,
      };
      const recurrencia = { runId, at: ahora, count: Number(h.conteo) || 1 };

      let existente = (t.mergeInto && (tocados.get(t.mergeInto) || incidentes.find((i) => i.id === t.mergeInto)))
        || [...tocados.values()].find((i) => i.projectId === projectId && (i.fingerprints.includes(h.fingerprint) || (h.fingerprintLegacy && i.fingerprints.includes(h.fingerprintLegacy))))
        || buscarPorFp(abiertos, h.fingerprint, projectId, h.fingerprintLegacy);
      let reabierto = false;
      if (!existente) {
        existente = buscarPorFp(cerradosRecientes, h.fingerprint, projectId, h.fingerprintLegacy);
        reabierto = Boolean(existente);
      }

      if (existente) {
        const doc = tocados.get(existente.id) || { ...existente };
        const sevAnterior = doc.severity;
        doc.fingerprints = [...new Set([...(doc.fingerprints || []), h.fingerprint])].slice(0, 50);
        doc.occurrences = (doc.occurrences || 0) + recurrencia.count;
        doc.lastSeenAt = maxIso(doc.lastSeenAt, h.ultima || ahora);
        doc.recurrences = [...(doc.recurrences || []), recurrencia].slice(-50);
        doc.severity = masGrave(doc.severity, severidad);
        // El título lo genera cada corrida (script o triage), en el idioma de Ajustes: se refresca para que una
        // tarjeta que se repite no quede en el idioma anterior. Si cambió el idioma, también el porqué del triage.
        doc.title = String(t.title || h.titulo).slice(0, 200);
        if (doc.language !== lang) { if (doc.triage) doc.triage = { ...doc.triage, rationale: tri.rationale }; doc.language = lang; }
        if (doc.severity !== sevAnterior) doc.severityRaisedAt = ahora;
        if (doc.decision !== decision || doc.severity !== sevAnterior) {
          doc.triageHistory = [...(doc.triageHistory || []), doc.triage].filter(Boolean).slice(-10);
          // Una decisión "más reportable" gana: un tema escalado no vuelve a silencioso por una ocurrencia menor.
          if (esReportable(decision) || !esReportable(doc.decision)) { doc.decision = decision; doc.triage = { ...tri, severity: doc.severity }; }
          else doc.triage = { ...doc.triage, severity: doc.severity };
        }
        doc.evidence = { ...(doc.evidence || {}), ultima: h.evidencia, ultimaCorrida: runId };
        if (h.libreria) doc.library = h.libreria;
        if (reabierto) {
          doc.status = 'open';
          doc.reopenCount = (doc.reopenCount || 0) + 1;
          doc.reopenedAt = ahora;
          doc.closedAt = null;
          doc.closedReason = null;
        }
        const reanalizar = esReportable(doc.decision) && doc.decision === 'escalate' && (reabierto || doc.severity !== sevAnterior || !doc.analysis || doc.analysis.status !== 'done');
        if (reanalizar) { doc.analysis = { ...(doc.analysis || {}), status: 'pending' }; analizar.push(doc.id); }
        tocados.set(doc.id, doc);
        actualizados.push(doc.id);
        resumenHallazgos.push({ incidentId: doc.id, title: doc.title, severity: doc.severity, decision: doc.decision, rationale: doc.triage.rationale, recurrence: true, reopened: reabierto });
      } else {
        const id = `inc-${ahora.slice(0, 10).replace(/-/g, '')}-${h.fingerprint.slice(0, 8)}`;
        const doc = {
          id,
          __version: null,
          projectId,
          status: 'open',
          fingerprints: [h.fingerprint],
          title: String(t.title || h.titulo).slice(0, 200),
          language: lang,
          category: categoria,
          severity: severidad,
          decision,
          process: h.proceso || null,
          processId: h.processId || null,
          library: h.libreria || null,
          queue: h.cola || null,
          checkId: h.checkId,
          ruleId: h.ruleId || null,
          signature: h.firma ? String(h.firma).slice(0, 600) : null,
          firstSeenAt: h.primera || ahora,
          lastSeenAt: h.ultima || ahora,
          occurrences: recurrencia.count,
          recurrences: [recurrencia],
          evidence: { primera: h.evidencia, ultima: h.evidencia, ultimaCorrida: runId },
          triage: tri,
          analysis: { status: decision === 'escalate' ? 'pending' : 'skipped' },
          learning: {},
          reopenCount: 0,
          createdRunId: runId,
        };
        if (decision === 'escalate') analizar.push(id);
        tocados.set(id, doc);
        nuevos.push(id);
        resumenHallazgos.push({ incidentId: id, title: doc.title, severity: doc.severity, decision, rationale: tri.rationale, recurrence: false });
      }

      if (h.categoria === 'deploy') {
        writes.push({ op: 'set', collection: 'history', doc_id: `hist-${runId}-${h.fingerprint.slice(0, 8)}`, data: { projectId, type: 'deploy_detected', at: ahora, summary: h.titulo, by: 'rutina' } });
        // Las tarjetas reportadas abiertas de ese proceso se marcan con el deploy y se re-analizan
        // (el análisis compara la versión anterior con la nueva).
        const ev = h.evidencia || {};
        for (const inc of [...tocados.values(), ...abiertos.filter((i) => !tocados.has(i.id))]) {
          if (inc.projectId !== projectId || inc.process !== h.proceso || inc.category === 'deploy' || inc.status !== 'open' || !esReportable(inc.decision)) continue;
          const d = tocados.get(inc.id) || { ...inc };
          d.deploy = { version: ev.versionNueva || null, previous: ev.versionAnterior || null, at: ahora };
          if (d.decision === 'escalate') { d.analysis = { ...(d.analysis || {}), status: 'pending' }; if (!analizar.includes(d.id)) analizar.push(d.id); }
          tocados.set(d.id, d);
        }
      }
    }

    // Proyecto: salud, watermarks e inventario vigente (para detectar deploys/triggers en la próxima corrida).
    const proyecto = proyectos.find((p) => p.id === projectId);
    if (proyecto) {
      const ultimoPorProceso = { ...((proyecto.watermarks || {}).lastJobByProcess || {}) };
      for (const j of senales.jobs || []) {
        const t = [j.creado, j.inicio, j.fin].filter(Boolean).sort().slice(-1)[0];
        if (j.proceso && t && (!ultimoPorProceso[j.proceso] || t > ultimoPorProceso[j.proceso])) ultimoPorProceso[j.proceso] = t;
      }
      const colectaOk = !(senales.errores || []).some((e) => /^login/.test(e));
      // Inventario de procesos: lo vigente de Orchestrator + lo indexado de los paquetes (índice de esta
      // corrida o lo ya guardado si la versión no cambió).
      const invPrevio = (proyecto.inventory && proyecto.inventory.processes) || [];
      const idx = (indice && indice.procesos) || [];
      const procesosInv = (senales.procesos || []).map((p) => {
        const i = idx.find((x) => x.name === p.nombre);
        const prev = invPrevio.find((x) => x.name === p.nombre) || {};
        const conservado = prev.indexedVersion === p.version ? { libraries: prev.libraries, systems: prev.systems, indexedVersion: prev.indexedVersion, hasSources: prev.hasSources, docs: prev.docs, hygiene: prev.hygiene } : {};
        return { name: p.nombre, version: p.version, key: p.key, package: p.paquete || prev.package || null, ...conservado, ...(i ? { libraries: i.libraries, systems: i.systems, indexedVersion: i.indexedVersion, hasSources: i.hasSources, docs: i.docs, hygiene: i.hygiene } : {}) };
      });
      // Procesos nuevos de la carpeta: se suman solos al proyecto (salvo includeAllProcesses: false).
      const declarados = new Set((proyecto.processes || []).map((x) => x.orchestratorProcess).filter(Boolean));
      const nuevosProcesos = proyecto.includeAllProcesses === false ? [] : (senales.procesos || []).filter((p) => !declarados.has(p.nombre)).map((p) => {
        const rol = inferirRol(p.nombre);
        let id = slugProceso(p.nombre);
        while ((proyecto.processes || []).some((x) => x.id === id)) id = `${id}-2`;
        return { id, label: p.nombre, orchestratorProcess: p.nombre, role: rol, folderPath: null, repo: null, docs: { paths: [] } };
      });
      writes.push({
        op: 'update', collection: 'projects', doc_id: projectId, if_version: proyecto.__version ?? undefined,
        data: {
          ...(colectaOk ? { watermarks: { since: senales.ventana.hasta, lastCheckedAt: ahora, lastJobByProcess: ultimoPorProceso } } : { watermarks: { lastCheckedAt: ahora } }),
          inventory: {
            ...(proyecto.inventory || {}),
            ...(procesosInv.length ? { processes: procesosInv } : {}),
            ...(senales.triggers && senales.triggers.length ? { triggers: senales.triggers.map((t) => ({ name: t.nombre, type: t.tipo, enabled: t.habilitado, cron: t.cron, process: t.proceso })) } : {}),
            ...(senales.colas && senales.colas.length ? { queues: senales.colas.map((q) => ({ name: q.nombre, key: q.key, maxRetries: q.maxReintentos })) } : {}),
            updatedAt: ahora,
          },
          ...(nuevosProcesos.length ? { processes: [...(proyecto.processes || []), ...nuevosProcesos] } : {}),
          updatedAt: ahora,
        },
      });
    }

    runProyectos.push({
      projectId,
      status: (senales.errores || []).length ? (hallazgos.hallazgos.some((h) => h.checkId === 'monitoring' && /login/.test(h.firma)) ? 'error' : 'ok') : 'ok',
      window: senales.ventana,
      signals: senales.conteos,
      checks: hallazgos.checks,
      findings: resumenHallazgos,
      incidentsNew: nuevos,
      incidentsUpdated: actualizados,
      errors: (senales.errores || []).slice(0, 50),
    });
  }

  // Auto-cierre: lo que nunca se reportó (monitor/known) y no volvió a aparecer en 24 h se cierra solo.
  // Lo reportado (escalate/notify) no se cierra solo: lo cierra una respuesta humana.
  const proyectosCorridos = new Set(porProyecto.map((x) => x.projectId));
  for (const inc of abiertos) {
    if (tocados.has(inc.id) || !proyectosCorridos.has(inc.projectId) || esReportable(inc.decision)) continue;
    if (!inc.lastSeenAt || (Date.parse(ahora) - Date.parse(inc.lastSeenAt)) / 3600000 < 24) continue;
    tocados.set(inc.id, { ...inc, status: 'closed', closedAt: ahora, closedReason: m(lang, 'cons.cerrado.sinRecurrencia') });
  }

  // Re-análisis pedido por un humano (requests reanalyze_incident).
  for (const id of reanalizar) {
    const inc = tocados.get(id) || incidentes.find((i) => i.id === id);
    if (!inc) continue;
    const d = tocados.get(id) || { ...inc };
    d.analysis = { ...(d.analysis || {}), status: 'pending' };
    tocados.set(id, d);
    if (!analizar.includes(id)) analizar.push(id);
  }

  // Catálogo de librerías: versiones en uso con sus actividades (fusionado con lo guardado).
  const porLib = {};
  for (const { indice } of porProyecto) for (const [name, vers] of Object.entries((indice && indice.libraries) || {})) Object.assign((porLib[name] ||= {}), vers);
  for (const [name, vers] of Object.entries(porLib)) {
    const prev = librerias.find((l) => l.name === name);
    const versions = { ...((prev && prev.versions) || {}) };
    for (const [v, info] of Object.entries(vers)) versions[v] = { activities: info.activities, hasSources: info.hasSources, dependencies: info.dependencies };
    writes.push({ op: 'set', collection: 'libraries', doc_id: slugProceso(name), ...(prev && prev.__version ? { if_version: prev.__version } : {}), data: { name, versions, updatedAt: ahora } });
  }

  // Incidentes tocados -> escrituras (set completo, fijado a la versión leída).
  for (const doc of tocados.values()) {
    const { id, __version, ...data } = doc;
    writes.push({ op: 'set', collection: 'incidents', doc_id: id, ...(__version ? { if_version: __version } : {}), data });
  }

  // Salud por proyecto, calculada sobre el estado resultante.
  const todos = [...incidentes.filter((i) => !tocados.has(i.id)), ...tocados.values()];
  for (const w of writes.filter((x) => x.collection === 'projects')) {
    const visibles = todos.filter((i) => i.projectId === w.doc_id && i.status === 'open' && esReportable(i.decision) && !silenciadoPorHumano(trabajo.find((t) => t.id === i.id), ahora));
    const porSev = { P1: 0, P2: 0, P3: 0, P4: 0 };
    for (const i of visibles) porSev[i.severity] = (porSev[i.severity] || 0) + 1;
    const level = porSev.P1 + porSev.P2 > 0 ? 'critical' : porSev.P3 + porSev.P4 > 0 ? 'warn' : 'ok';
    const rp = runProyectos.find((r) => r.projectId === w.doc_id);
    w.data.health = { level: rp && rp.status === 'error' ? 'critical' : level, openBySeverity: porSev, lastRunId: runId, lastCheckedAt: ahora };
  }

  const resumen = {
    projects: runProyectos.length,
    newIncidents: runProyectos.reduce((a, p) => a + p.incidentsNew.length, 0),
    updatedIncidents: runProyectos.reduce((a, p) => a + p.incidentsUpdated.length, 0),
    escalated: [...tocados.values()].filter((d) => d.decision === 'escalate').length,
    errors: runProyectos.reduce((a, p) => a + p.errors.length, 0),
  };
  const statusRun = runProyectos.some((p) => p.status === 'error') ? (runProyectos.every((p) => p.status === 'error') ? 'error' : 'partial') : 'ok';
  writes.unshift({ op: 'set', collection: 'runs', doc_id: runId, data: { startedAt: inicio, finishedAt: fin, status: statusRun, trigger, sessionUrl: sessionUrl || null, projects: runProyectos, summary: resumen } });

  return { writes, analizar, resumen };
}

export function silenciadoPorHumano(work, ahora) {
  if (!work) return false;
  if (work.state === 'dismissed' || work.state === 'responded') return true;
  if (work.state === 'snoozed' && work.snoozeUntil && work.snoozeUntil > ahora) return true;
  return false;
}

function maxIso(a, b) { return !a ? b : !b ? a : (a > b ? a : b); }

// ---------- CLI ----------
if (process.argv[1] && process.argv[1].endsWith('consolidar.mjs')) {
  const runDir = arg('--run-dir');
  const runId = arg('--run-id');
  const dbDir = join(runDir, 'db');
  const proyectos = leerColeccion(join(dbDir, 'projects'));
  const incidentes = leerColeccion(join(dbDir, 'incidents'));
  const trabajo = leerColeccion(join(dbDir, 'incidentWork'));
  const triagePath = arg('--triage') || join(runDir, 'triage.json');
  const triage = existsSync(triagePath) ? leerJson(triagePath) : {};
  const ajustes = desenvolver(leerJson(join(dbDir, 'config', 'settings.json'), {}));
  const porProyecto = [];
  for (const p of proyectos) {
    const hp = join(runDir, p.id, 'hallazgos.json');
    const sp = join(runDir, p.id, 'senales.json');
    const ip = join(runDir, p.id, 'indice.json');
    if (existsSync(hp) && existsSync(sp)) porProyecto.push({ projectId: p.id, hallazgos: leerJson(hp), senales: leerJson(sp), indice: existsSync(ip) ? leerJson(ip) : null });
  }
  const fin = new Date().toISOString();
  const librerias = leerColeccion(join(dbDir, 'libraries'));
  const reanalizar = (arg('--reanalizar') || '').split(',').filter(Boolean);
  const plan = consolidar({ runId, inicio: arg('--inicio') || fin, fin, trigger: arg('--trigger') || 'scheduled', sessionUrl: arg('--session-url'), proyectos, incidentes, trabajo, porProyecto, triage, librerias, reanalizar, ajustes });
  writeFileSync(join(runDir, 'plan.json'), JSON.stringify(plan, null, 2));
  console.log(JSON.stringify({ escrituras: plan.writes.length, analizar: plan.analizar, resumen: plan.resumen }));
}
