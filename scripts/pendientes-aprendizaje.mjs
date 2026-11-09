#!/usr/bin/env node
// Lista lo que /control-aprendizaje tiene que procesar: respuestas humanas nuevas y re-controles vencidos.
// Uso: node scripts/pendientes-aprendizaje.mjs --db work/<run>/db [--ahora <ISO>]
import { join } from 'node:path';
import { arg } from './lib/args.mjs';
import { leerColeccion } from './consolidar.mjs';

const db = arg('--db');
const ahora = arg('--ahora') || new Date().toISOString();
const incidentes = leerColeccion(join(db, 'incidents'));
const trabajo = leerColeccion(join(db, 'incidentWork'));

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

console.log(JSON.stringify(pendientes(incidentes, trabajo, ahora), null, 2));
