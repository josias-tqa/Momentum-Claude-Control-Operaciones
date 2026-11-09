#!/usr/bin/env node
// Inserta el resultado de /control-analisis en el documento del incidente dentro del plan de la corrida.
// Uso: node scripts/set-analisis.mjs --plan work/<run>/plan.json --incidente <inc-id> --analisis work/<run>/analisis/<inc-id>.json
// El JSON de análisis debe seguir la forma documentada en .claude/skills/control-analisis/SKILL.md.
import { writeFileSync } from 'node:fs';
import { arg, leerJson } from './lib/args.mjs';
import { redactarTexto } from './lib/redact.mjs';

const planPath = arg('--plan');
const id = arg('--incidente');
const plan = leerJson(planPath);
const a = leerJson(arg('--analisis'));
const w = plan.writes.find((x) => x.collection === 'incidents' && x.doc_id === id);
if (!w) { console.error(`El incidente ${id} no está en el plan`); process.exit(1); }

const txt = (v, n = 2000) => (v === undefined || v === null ? null : redactarTexto(String(v), { largo: n }));
w.data.analysis = {
  status: 'done',
  summary: txt(a.summary, 3000),
  hypotheses: (a.hypotheses || []).slice(0, 6).map((h) => ({ text: txt(h.text, 800), likelihood: ['alta', 'media', 'baja'].includes(h.likelihood) ? h.likelihood : 'media', evidence: txt(h.evidence, 1200) })),
  codeRefs: (a.codeRefs || []).slice(0, 15).map((c) => ({ file: String(c.file || '').slice(0, 300), line: c.line ?? null, sha: String(c.sha || '').slice(0, 40), note: txt(c.note, 400) })),
  docRefs: (a.docRefs || []).slice(0, 15).map((d) => ({ file: String(d.file || '').slice(0, 300), section: txt(d.section, 200), note: txt(d.note, 400) })),
  scope: txt(a.scope, 600),
  regression: typeof a.regression === 'boolean' ? a.regression : null,
  requiresFix: typeof a.requiresFix === 'boolean' ? a.requiresFix : null,
  suggestedActions: (a.suggestedActions || []).slice(0, 8).map((s) => txt(s, 500)),
  responseOptions: (a.responseOptions || []).slice(0, 5).map((s) => txt(s, 200)),
  repo: a.repo ? { ref: String(a.repo.ref || ''), sha: String(a.repo.sha || ''), matchesDeployedVersion: Boolean(a.repo.matchesDeployedVersion) } : null,
  analyzedAt: new Date().toISOString(),
};
plan.analizar = (plan.analizar || []).filter((x) => x !== id);
writeFileSync(planPath, JSON.stringify(plan, null, 2));
console.log(JSON.stringify({ incidente: id, hipotesis: w.data.analysis.hypotheses.length, pendientes: plan.analizar.length }));
