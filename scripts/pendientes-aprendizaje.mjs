#!/usr/bin/env node
// Lista lo que /control-aprendizaje tiene que procesar: respuestas humanas nuevas (a incidentes y a
// discrepancias de proyecto) y re-controles vencidos.
// Uso: node scripts/pendientes-aprendizaje.mjs --db work/<run>/db [--ahora <ISO>]
import { join } from 'node:path';
import { arg } from './lib/args.mjs';
import { leerColeccion } from './consolidar.mjs';

export function pendientes(incidentes, trabajo, ahora) {
  const respuestas = [];
  const recontroles = [];
  for (const w of trabajo) {
    const inc = incidentes.find((i) => i.id === w.id);
    if (!inc) continue;
    const procesado = (inc.learning && inc.learning.workUpdatedAt) || '';
    if (w.updatedAt && w.updatedAt > procesado && ['dismissed', 'responded', 'snoozed'].includes(w.state)) {
      respuestas.push({ incidentId: inc.id, projectId: inc.projectId, title: inc.title, state: w.state, dismissReason: w.dismissReason || null, response: w.response || null, by: w.updatedBy || null, at: w.updatedAt });
    }
    const vence = (w.response && w.response.recheckAt) || (w.state === 'snoozed' ? w.snoozeUntil : null);
    if (vence && vence <= ahora && inc.status === 'open') {
      const volvio = (inc.recurrences || []).some((r) => r.at > (w.updatedAt || ''));
      recontroles.push({ incidentId: inc.id, projectId: inc.projectId, title: inc.title, vence, volvioAOcurrir: volvio });
    }
  }
  return { respuestas, recontroles };
}

// Respuestas humanas a discrepancias de proyecto (discrepancyWork) que la rutina todavía no anotó en la memoria.
// `cierra`: la respuesta da el tema por terminado (descarte, o "es correcto así"); si no, queda una corrección
// pendiente, que se da por hecha cuando un re-análisis deja de detectar la discrepancia.
export function pendientesDiscrepancias(discrepancias, trabajo) {
  const out = [];
  for (const w of trabajo) {
    const d = discrepancias.find((x) => x.id === w.id);
    if (!d) continue;
    const procesado = (d.learning && d.learning.workUpdatedAt) || '';
    if (!w.updatedAt || w.updatedAt <= procesado || !['dismissed', 'responded'].includes(w.state)) continue;
    const decision = (w.response || {}).decision || null;
    out.push({ discrepancyId: d.id, projectId: d.projectId, title: d.title, kind: d.kind, status: d.status, state: w.state, dismissReason: w.dismissReason || null,
      response: w.response || null, by: w.updatedBy || null, at: w.updatedAt, cierra: w.state === 'dismissed' || decision === 'expected' });
  }
  return out;
}

if (process.argv[1] && process.argv[1].endsWith('pendientes-aprendizaje.mjs')) {
  const db = arg('--db');
  const ahora = arg('--ahora') || new Date().toISOString();
  const r = pendientes(leerColeccion(join(db, 'incidents')), leerColeccion(join(db, 'incidentWork')), ahora);
  r.discrepancias = pendientesDiscrepancias(leerColeccion(join(db, 'discrepancies')), leerColeccion(join(db, 'discrepancyWork')));
  console.log(JSON.stringify(r, null, 2));
}
