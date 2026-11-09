#!/usr/bin/env node
// Hook PreToolUse (Bash): garantiza que la Torre de Control SOLO LEE.
//
// Bloquea (exit 2, el motivo va a stderr y Claude lo ve):
//  - cualquier `uip` que no sea lectura: solo se permiten --version, login, tools list,
//    skills list/show y `uip or <recurso> <verbo>` con los verbos de scripts/lib/uip.mjs;
//  - `assets get-asset-value`, adjuntos, healing-data y exportaciones (secretos / PII);
//  - `git push` y `git commit` dentro de los clones de proyectos (work/) o hacia Bitbucket;
//  - llamadas HTTP de escritura (POST/PUT/PATCH/DELETE) a UiPath o Bitbucket.
// Es una red de seguridad: la External App y el token de Bitbucket ya son de solo lectura.

import { revisar } from '../../scripts/lib/guard.mjs';

let entrada = '';
process.stdin.on('data', (c) => (entrada += c));
process.stdin.on('end', () => {
  let payload = {};
  try { payload = JSON.parse(entrada || '{}'); } catch { payload = {}; }
  const comando = (payload.tool_input && payload.tool_input.command) || '';
  const cwd = payload.cwd || process.cwd();
  const motivo = revisar(comando, cwd);
  if (motivo) {
    process.stderr.write(`Bloqueado por la Torre de Control (solo lectura): ${motivo}\n`);
    process.exit(2);
  }
  process.exit(0);
});
