#!/usr/bin/env node
// Clona (superficial, solo lectura) el repo de UN PROCESO de un proyecto desde Bitbucket, en la versión
// desplegada cuando existe el tag `v<versión>` (estándar 14 de TQA); si no, en la rama configurada.
//
// Uso:
//   node scripts/fetch-repo.mjs --proyecto <project.json> --proceso <id|nombre en Orchestrator> --destino work/<run>/repos/<id>/<proceso> [--version 1.4.0]
//   (sin --proceso, si el proyecto tiene un solo proceso, usa ese)
// Salida (stdout, JSON): { proceso, ruta, ref, sha, coincideVersion, paquete, docs: [...] }
//   `paquete` es el "name" del project.json del repo: sirve para emparejar el repo con su proceso de
//   Orchestrator (scripts/emparejar-procesos.mjs).
//
// El token va por GIT_CONFIG_* (entorno), nunca en la URL ni en argv. Validado en la Fase 0.B:
// para git funciona Basic con usuario "x-token-auth" (access token) o BITBUCKET_USER (API token).

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, rmSync, statSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { arg, leerJson, desenvolver } from './lib/args.mjs';
import { normalizarProyecto, procesoPorNombre } from './lib/proyecto.mjs';

const proyecto = normalizarProyecto(desenvolver(leerJson(arg('--proyecto'))));
const destino = arg('--destino');
const pedido = arg('--proceso');
let proc = null;
if (pedido) proc = proyecto.processes.find((x) => x.id === pedido) || procesoPorNombre(proyecto, pedido);
else if (proyecto.processes.length === 1) proc = proyecto.processes[0];
if (!proc) { console.error(`No se encontró el proceso "${pedido || ''}" en el proyecto (procesos: ${proyecto.processes.map((x) => x.id).join(', ') || 'ninguno'})`); process.exit(2); }
const { workspace, slug, branch } = proc.repo || {};
if (!workspace || !slug || !destino) { console.error(`El proceso ${proc.id} no tiene repo (workspace/slug) o falta --destino`); process.exit(2); }

// Versión desplegada: la indicada o la del inventario del proyecto para ese proceso.
const inv = ((proyecto.inventory && proyecto.inventory.processes) || []).find((x) => x.name === proc.orchestratorProcess);
const version = arg('--version') || (inv && inv.version) || null;

const tok = process.env.BITBUCKET_TOKEN;
if (!tok) { console.error('Falta BITBUCKET_TOKEN'); process.exit(2); }
const usuario = process.env.BITBUCKET_USER || 'x-token-auth';
const envGit = {
  ...process.env,
  GIT_TERMINAL_PROMPT: '0',
  GIT_CONFIG_COUNT: '1',
  GIT_CONFIG_KEY_0: 'http.https://bitbucket.org/.extraHeader',
  GIT_CONFIG_VALUE_0: `Authorization: Basic ${Buffer.from(`${usuario}:${tok}`).toString('base64')}`,
};
const url = `https://bitbucket.org/${workspace}/${slug}.git`;
const git = (args, opts = {}) => spawnSync('git', args, { env: envGit, encoding: 'utf8', timeout: 300000, ...opts });

let ref = branch || null;
let coincideVersion = false;
if (version) {
  const tags = git(['ls-remote', '--tags', url]);
  if (tags.status === 0 && tags.stdout.split('\n').some((l) => l.endsWith(`refs/tags/v${version}`))) { ref = `v${version}`; coincideVersion = true; }
}

rmSync(destino, { recursive: true, force: true });
const cl = git(['clone', '--depth', '1', '--quiet', ...(ref ? ['--branch', ref] : []), url, destino]);
if (cl.status !== 0) { console.error(`No se pudo clonar ${workspace}/${slug} (proceso ${proc.id}): ${(cl.stderr || '').trim().split('\n').pop()}`); process.exit(1); }
const sha = git(['-C', destino, 'rev-parse', 'HEAD']).stdout.trim();
const refReal = ref || git(['-C', destino, 'rev-parse', '--abbrev-ref', 'HEAD']).stdout.trim();

// project.json de UiPath (raíz o primer nivel) -> nombre del paquete.
let paquete = null;
for (const cand of ['project.json', ...readdirSync(destino).filter((n) => !n.startsWith('.')).map((n) => join(n, 'project.json'))]) {
  const f = join(destino, cand);
  if (existsSync(f)) { try { paquete = JSON.parse(readFileSync(f, 'utf8')).name || null; } catch { /* project.json inválido */ } if (paquete) break; }
}

// Documentación: rutas del proceso, luego las del proyecto, o cualquier .md/.docx bajo docs/.
const docs = [];
for (const p of [...((proc.docs && proc.docs.paths) || []), ...((proyecto.docs && proyecto.docs.paths) || [])]) if (existsSync(join(destino, p)) && !docs.includes(p)) docs.push(p);
if (!docs.length && existsSync(join(destino, 'docs'))) {
  const recorrer = (d) => { for (const n of readdirSync(d)) { const f = join(d, n); if (statSync(f).isDirectory()) recorrer(f); else if (/\.(md|docx)$/i.test(n)) docs.push(relative(destino, f)); } };
  recorrer(join(destino, 'docs'));
}
console.log(JSON.stringify({ proceso: proc.id, orchestratorProcess: proc.orchestratorProcess || null, repo: `${workspace}/${slug}`, ruta: destino, ref: refReal, sha, version, coincideVersion, paquete, docs }));
