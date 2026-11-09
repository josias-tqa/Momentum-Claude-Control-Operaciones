#!/usr/bin/env node
// Clona (superficial, solo lectura) el repo de un proyecto desde Bitbucket, en la versión desplegada
// cuando existe el tag `v<versión>` (estándar 14 de TQA); si no, en la rama configurada.
//
// Uso: node scripts/fetch-repo.mjs --proyecto <project.json> --destino work/<run>/repos/<id> [--version 1.4.0]
// Salida (stdout, JSON): { ruta, ref, sha, coincideVersion, docs: [...] }
//
// El token va por GIT_CONFIG_* (entorno), nunca en la URL ni en argv. Validado en la Fase 0.B:
// para git funciona Basic con usuario "x-token-auth" (access token) o BITBUCKET_USER (API token).

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { arg, leerJson, desenvolver } from './lib/args.mjs';

const proyecto = desenvolver(leerJson(arg('--proyecto')));
const destino = arg('--destino');
const version = arg('--version');
const { workspace, slug, branch } = proyecto.repo || {};
if (!workspace || !slug || !destino) { console.error('Faltan --proyecto con repo.workspace/slug o --destino'); process.exit(2); }

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

// ¿Existe el tag de la versión desplegada?
let ref = branch || null;
let coincideVersion = false;
if (version) {
  const tags = git(['ls-remote', '--tags', url]);
  if (tags.status === 0 && tags.stdout.split('\n').some((l) => l.endsWith(`refs/tags/v${version}`))) { ref = `v${version}`; coincideVersion = true; }
}

rmSync(destino, { recursive: true, force: true });
const args = ['clone', '--depth', '1', '--quiet', ...(ref ? ['--branch', ref] : []), url, destino];
const cl = git(args);
if (cl.status !== 0) { console.error(`No se pudo clonar ${workspace}/${slug}: ${(cl.stderr || '').trim().split('\n').pop()}`); process.exit(1); }
const sha = git(['-C', destino, 'rev-parse', 'HEAD']).stdout.trim();
const refReal = ref || git(['-C', destino, 'rev-parse', '--abbrev-ref', 'HEAD']).stdout.trim();

// Documentación: rutas configuradas o cualquier .md/.docx bajo docs/.
const docs = [];
for (const p of (proyecto.docs && proyecto.docs.paths) || []) if (existsSync(join(destino, p))) docs.push(p);
if (!docs.length && existsSync(join(destino, 'docs'))) {
  const recorrer = (d) => { for (const n of readdirSync(d)) { const f = join(d, n); if (statSync(f).isDirectory()) recorrer(f); else if (/\.(md|docx)$/i.test(n)) docs.push(relative(destino, f)); } };
  recorrer(join(destino, 'docs'));
}
console.log(JSON.stringify({ ruta: destino, ref: refReal, sha, coincideVersion, docs }));
