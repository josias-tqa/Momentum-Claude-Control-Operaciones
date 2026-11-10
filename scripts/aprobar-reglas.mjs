#!/usr/bin/env node
// Aprobación automática de reglas (determinista, sin modelo).
//
// Por defecto las reglas que propone la rutina esperan a un Admin. Si un Admin activó en Ajustes
// "Aprobar automáticamente las reglas que propone la rutina" (config/settings.autoApproveRules), las reglas
// se activan en el momento, sin esperar a otra corrida:
//  - aprobarEnPlan: toda regla que un plan está por crear como `proposed` nace `active`. Lo aplica
//    build-writes.mjs a cada plan, así que vale para cualquier skill que proponga reglas;
//  - aprobarAutomatico (este CLI): pasa a `active` las `proposed` que ya estaban en la base (por si quedó alguna).
// El tablero, al encender el interruptor, aprueba él mismo las que estaban esperando.
//
// No toca los cambios sugeridos (`suggestion`) sobre reglas existentes: esos siempre los aplica una persona.
//
// Uso: node scripts/aprobar-reglas.mjs --db work/<run>/db [--ahora <ISO>] --salida work/<run>/aprobacion-plan.json
// Salida: { activa, aprobadas: [ids], writes }: el archivo sirve tal cual como --plan de build-writes.mjs.
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { arg, leerJson, desenvolver } from './lib/args.mjs';
import { leerColeccion } from './consolidar.mjs';

// Reescribe las escrituras de un plan: una regla nueva `proposed` nace aprobada. Devuelve los ids aprobados.
export function aprobarEnPlan(writes, ajustes, ahora) {
  if (!ajustes || ajustes.autoApproveRules !== true) return [];
  const aprobadas = [];
  for (const w of writes || []) {
    if (w.collection !== 'rules' || w.op !== 'set' || !w.data || w.data.status !== 'proposed') continue;
    Object.assign(w.data, { status: w.data.compiled ? 'active' : 'pending_compile', approvedBy: 'rutina', approvedAt: ahora, autoApproved: true });
    aprobadas.push(w.doc_id);
  }
  return aprobadas;
}

export function aprobarAutomatico({ reglas, ajustes, ahora }) {
  if (!ajustes || ajustes.autoApproveRules !== true) return { activa: false, aprobadas: [], writes: [] };
  const writes = [];
  const aprobadas = [];
  const porProyecto = {};
  for (const r of reglas) {
    if (r.status !== 'proposed') continue;
    // Una propuesta de la rutina ya viene traducida; si no, la compila esta misma corrida.
    const data = { status: r.compiled ? 'active' : 'pending_compile', approvedBy: 'rutina', approvedAt: ahora, autoApproved: true };
    writes.push({ op: 'update', collection: 'rules', doc_id: r.id, ...(r.__version ? { if_version: r.__version } : {}), data });
    aprobadas.push(r.id);
    if (r.projectId && r.projectId !== '*') (porProyecto[r.projectId] ||= []).push(r.id);
  }
  // Rastro en la memoria de producción: qué se activó sin pasar por una persona.
  const marca = ahora.replace(/[^0-9]/g, '').slice(0, 12);
  for (const [projectId, ids] of Object.entries(porProyecto)) {
    writes.push({
      op: 'set', collection: 'history', doc_id: `h-auto-${projectId}-${marca}`.slice(0, 190),
      data: { projectId, type: 'rule_added', at: ahora, by: 'rutina', ruleId: ids[0],
        summary: `Aprobación automática: ${ids.length === 1 ? 'se activó 1 regla propuesta' : `se activaron ${ids.length} reglas propuestas`} (${ids.join(', ')}).`.slice(0, 4000) },
    });
  }
  return { activa: true, aprobadas, writes };
}

if (process.argv[1] && process.argv[1].endsWith('aprobar-reglas.mjs')) {
  const db = arg('--db');
  const r = aprobarAutomatico({
    reglas: leerColeccion(join(db, 'rules')),
    ajustes: desenvolver(leerJson(join(db, 'config', 'settings.json'), {})),
    ahora: arg('--ahora') || new Date().toISOString(),
  });
  mkdirSync(dirname(arg('--salida')), { recursive: true });
  writeFileSync(arg('--salida'), JSON.stringify(r, null, 2));
  console.log(JSON.stringify({ activa: r.activa, aprobadas: r.aprobadas }));
}
