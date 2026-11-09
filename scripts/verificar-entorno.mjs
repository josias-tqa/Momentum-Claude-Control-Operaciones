#!/usr/bin/env node
// Verificación de entorno (Fase 0.B) — Torre de Control de Operaciones UiPath (Grupo Momentum).
//
// Comprueba desde el entorno actual, SIN imprimir secretos ni datos de negocio:
//   1) que el CLI `uip` está instalado, fijado y con el tool de Orchestrator;
//   2) que el login headless con External App (client credentials) funciona;
//   3) que las lecturas que necesita la rutina responden, y con qué forma de datos;
//   4) que la API REST OData de Orchestrator responde (fallback si el CLI fallara);
//   5) que Bitbucket permite listar y clonar el repo de un proyecto con un token de solo lectura.
//
// Política de PII: del contenido de UiPath solo se registran NOMBRES DE CAMPOS y CONTEOS,
// nunca valores. Los secretos se pasan por variables de entorno o stdin, nunca por argv.
//
// Uso:
//   node scripts/verificar-entorno.mjs [--carpeta "<FolderPath>"] [--repo <workspace>/<repo>]
// Variables de entorno: ver docs/validacion-uip-cloud.md.

import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const VERSIONES = JSON.parse(readFileSync(join(RAIZ, 'config', 'versiones.json'), 'utf8'));
const ALCANCES_POR_DEFECTO = [
  'OR.Folders.Read', 'OR.Jobs.Read', 'OR.Queues.Read', 'OR.Assets.Read',
  'OR.Execution.Read', 'OR.Monitoring.Read', 'OR.Robots.Read', 'OR.Machines.Read',
].join(' ');
const USER_AGENT = 'TorreControlOperaciones/0.1 (verificacion)';

// ---------- argumentos ----------
const args = process.argv.slice(2);
function arg(nombre) {
  const i = args.indexOf(nombre);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : undefined;
}
const carpeta = arg('--carpeta') || process.env.UIPATH_CARPETA_PRUEBA || '';
const repoPrueba = arg('--repo') || process.env.BITBUCKET_REPO_PRUEBA || '';

const marca = new Date().toISOString().replace(/[:.]/g, '-');
const DIR_SALIDA = join(RAIZ, 'work', 'verificacion', marca);
mkdirSync(DIR_SALIDA, { recursive: true });

const resultados = [];
const formas = {};
const inicio = new Date();

function registrar(id, titulo, estado, detalle = '') {
  resultados.push({ id, titulo, estado, detalle });
  const icono = { ok: 'OK   ', falla: 'FALLA', aviso: 'AVISO', omitido: 'OMIT ' }[estado] || estado;
  console.log(`[${icono}] ${titulo}${detalle ? ' — ' + detalle : ''}`);
}

// ---------- utilidades ----------
const ENV_UIP = {
  ...process.env,
  UIPATH_TELEMETRY_DISABLED: 'true',
  UIPATH_CLI_DISABLE_VERSION_SYNC: 'true',
  UIPATH_CLI_DISABLE_AUTOINSTALL: 'true',
};

function ejecutar(cmd, argv, { env = process.env, input, timeoutMs = 120000 } = {}) {
  const r = spawnSync(cmd, argv, { env, input, encoding: 'utf8', timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 });
  return { codigo: r.status, stdout: r.stdout || '', stderr: r.stderr || '', error: r.error };
}

// El CLI devuelve un envelope JSON en stdout. Por si hubiera ruido antes (p. ej. avisos de update),
// se parsea desde la primera llave.
function parsearEnvelope(stdout) {
  const i = stdout.indexOf('{');
  if (i < 0) return null;
  try { return JSON.parse(stdout.slice(i)); } catch { return null; }
}

function uip(argv, opciones = {}) {
  const r = ejecutar('uip', [...argv, '--output', 'json'], { env: ENV_UIP, ...opciones });
  const env = parsearEnvelope(r.stdout);
  return { ...r, envelope: env, exito: r.codigo === 0 && env && env.Result === 'Success' };
}

// Forma de los datos: tipo, cantidad y nombres de campos (unión de los primeros 5 elementos).
function forma(data) {
  if (Array.isArray(data)) {
    const campos = new Set();
    for (const x of data.slice(0, 5)) if (x && typeof x === 'object') Object.keys(x).forEach((k) => campos.add(k));
    return { tipo: 'lista', cantidad: data.length, campos: [...campos].sort() };
  }
  if (data && typeof data === 'object') return { tipo: 'objeto', campos: Object.keys(data).sort() };
  return { tipo: typeof data };
}

function lista(envelope) {
  const d = envelope && envelope.Data;
  if (Array.isArray(d)) return d;
  if (d && typeof d === 'object') {
    for (const k of ['Items', 'items', 'value', 'Value', 'Results']) if (Array.isArray(d[k])) return d[k];
  }
  return [];
}

function motivoFalla(r) {
  const e = r.envelope;
  if (e) return [e.Result, e.ErrorCode, e.Context && e.Context.HttpStatus, e.Message && String(e.Message).split('\n')[0]].filter(Boolean).join(' | ');
  if (r.error) return String(r.error.message || r.error);
  return (r.stderr || r.stdout || '').split('\n').filter(Boolean).slice(-1)[0] || `código ${r.codigo}`;
}

function campoValor(obj, nombres) {
  for (const n of nombres) if (obj && obj[n] !== undefined && obj[n] !== null) return obj[n];
  return undefined;
}

function contarPor(items, nombresCampo) {
  const c = {};
  for (const it of items) {
    const v = campoValor(it, nombresCampo);
    const k = v === undefined ? '(sin campo)' : String(v);
    c[k] = (c[k] || 0) + 1;
  }
  return c;
}

function haceHoras(h) { return new Date(Date.now() - h * 3600 * 1000).toISOString(); }

// ---------- 1) variables de entorno (solo presencia) ----------
const requeridas = ['UIPATH_ORG', 'UIPATH_TENANT', 'UIPATH_CLIENT_ID', 'UIPATH_APP_SECRET'];
const opcionales = ['UIPATH_SCOPES', 'UIPATH_AUTHORITY', 'UIPATH_CARPETA_PRUEBA', 'BITBUCKET_TOKEN', 'BITBUCKET_USER', 'BITBUCKET_REPO_PRUEBA', 'OPS_ARTIFACT_URL'];
const faltantes = requeridas.filter((v) => !process.env[v]);
registrar('env.requeridas', 'Variables requeridas presentes', faltantes.length ? 'falla' : 'ok',
  faltantes.length ? `faltan: ${faltantes.join(', ')}` : requeridas.join(', '));
registrar('env.opcionales', 'Variables opcionales presentes', 'ok',
  opcionales.map((v) => `${v}=${process.env[v] ? 'sí' : 'no'}`).join(', '));

const authority = (process.env.UIPATH_AUTHORITY || 'https://cloud.uipath.com').replace(/\/+$/, '');
const alcances = process.env.UIPATH_SCOPES || ALCANCES_POR_DEFECTO;

// ---------- 2) CLI instalado y fijado ----------
const ver = ejecutar('uip', ['--version'], { env: ENV_UIP });
const version = (ver.stdout || '').trim();
if (ver.codigo !== 0) {
  registrar('cli.version', 'CLI uip instalado', 'falla', 'no se encontró `uip` (¿corrió scripts/setup-entorno.sh?)');
} else {
  registrar('cli.version', 'CLI uip instalado', version === VERSIONES.uipCli ? 'ok' : 'aviso',
    `versión ${version} (fijada: ${VERSIONES.uipCli})`);
}

const tools = uip(['tools', 'list']);
const tieneOr = tools.exito && JSON.stringify(tools.envelope.Data || []).includes('orchestrator-tool');
if (!tieneOr && ver.codigo === 0) {
  const inst = uip(['tools', 'install', '@uipath/orchestrator-tool'], { timeoutMs: 300000 });
  registrar('cli.or', 'Tool de Orchestrator', inst.exito ? 'aviso' : 'falla',
    inst.exito ? 'no estaba instalado; se instaló ahora (agregarlo al setup script)' : motivoFalla(inst));
} else {
  registrar('cli.or', 'Tool de Orchestrator', tieneOr ? 'ok' : 'falla', tieneOr ? 'instalado' : 'CLI no disponible');
}

// Skills oficiales copiadas por el setup script.
const dirSkills = join(process.env.HOME || '/root', '.claude', 'skills');
const skillsPresentes = existsSync(dirSkills) ? readdirSync(dirSkills) : [];
const skillsFaltantes = VERSIONES.skillsOficialesIncluidas.filter((s) => !skillsPresentes.includes(s));
registrar('skills', 'Skills oficiales de UiPath en ~/.claude/skills', skillsFaltantes.length ? 'aviso' : 'ok',
  skillsFaltantes.length ? `faltan: ${skillsFaltantes.join(', ')}` : VERSIONES.skillsOficialesIncluidas.join(', '));

// ---------- 3) login headless ----------
let logueado = false;
if (!faltantes.length && ver.codigo === 0) {
  const argvLogin = ['login', '--client-id', 'env.UIPATH_CLIENT_ID', '--client-secret', 'env.UIPATH_APP_SECRET',
    '-t', process.env.UIPATH_TENANT, '-s', alcances];
  if (process.env.UIPATH_AUTHORITY) argvLogin.push('--authority', authority);
  const login = uip(argvLogin);
  logueado = login.exito;
  registrar('cli.login', 'Login headless (client credentials)', logueado ? 'ok' : 'falla',
    logueado ? `alcances solicitados: ${alcances}` : motivoFalla(login));
  if (logueado) {
    const st = uip(['login', 'status']);
    formas['login status'] = st.envelope ? forma(st.envelope.Data) : null;
    registrar('cli.status', 'Estado de sesión', st.exito ? 'ok' : 'aviso', st.exito ? 'sesión activa' : motivoFalla(st));
  }
} else {
  registrar('cli.login', 'Login headless (client credentials)', 'omitido', 'faltan variables o CLI');
}

// ---------- 4) lecturas que necesita la rutina ----------
function lectura(id, titulo, argv, extra) {
  if (!logueado) { registrar(id, titulo, 'omitido', 'sin login'); return null; }
  const r = uip(argv);
  if (!r.exito) { registrar(id, titulo, 'falla', motivoFalla(r)); return null; }
  const items = lista(r.envelope);
  formas[argv.slice(0, 3).join(' ')] = Array.isArray(r.envelope.Data) ? forma(r.envelope.Data) : forma(r.envelope.Data);
  registrar(id, titulo, 'ok', extra ? extra(items, r.envelope) : `${items.length} elemento(s)`);
  return { items, envelope: r.envelope };
}

const alcanceCarpeta = carpeta ? ['--folder-path', carpeta] : ['--all-folders'];
if (!carpeta) registrar('carpeta', 'Carpeta de prueba', 'aviso', 'sin --carpeta: se usa --all-folders con límite bajo');

lectura('or.folders', 'Listar carpetas', ['or', 'folders', 'list', '--limit', '50']);
const jobs = lectura('or.jobs', 'Jobs de las últimas 24 h', ['or', 'jobs', 'list', ...alcanceCarpeta, '--created-after', haceHoras(24), '--limit', '20'],
  (items) => `${items.length} job(s); por estado: ${JSON.stringify(contarPor(items, ['State', 'state']))}`);
lectura('or.jobs.faulted', 'Jobs Faulted de los últimos 7 días', ['or', 'jobs', 'list', ...alcanceCarpeta, '--state', 'Faulted', '--created-after', haceHoras(24 * 7), '--limit', '5']);

// Preferir un job ya terminado (Faulted/Successful): uno Pending o Running todavía no tiene logs.
const conClave = (j) => campoValor(j, ['Key', 'key', 'JobKey']);
const terminado = (j) => ['Faulted', 'Successful', 'Stopped'].includes(String(campoValor(j, ['State', 'state'])));
const jobConLogs = jobs && (jobs.items.find((j) => conClave(j) && terminado(j)) || jobs.items.find(conClave));
if (jobConLogs) {
  const clave = campoValor(jobConLogs, ['Key', 'key', 'JobKey']);
  lectura('or.logs', 'Logs de un job (conteo por nivel)', ['or', 'jobs', 'logs', String(clave), ...(carpeta ? ['--folder-path', carpeta] : []), '--limit', '100'],
    (items) => `${items.length} línea(s); por nivel: ${JSON.stringify(contarPor(items, ['Level', 'level']))}`);
  lectura('or.jobs.history', 'Historial de estados de un job', ['or', 'jobs', 'history', String(clave)]);
} else {
  registrar('or.logs', 'Logs de un job', logueado ? 'aviso' : 'omitido',
    logueado ? 'no hubo jobs en 24 h para probar (repetir con otra carpeta o más tarde)' : 'sin login');
}

lectura('or.queues', 'Listar colas', ['or', 'queues', 'list', ...alcanceCarpeta, '--limit', '50']);
lectura('or.queueitems', 'Queue items Failed (con todos los campos, solo nombres)', ['or', 'queue-items', 'list', ...alcanceCarpeta, '--status', 'Failed', '--sort-by', 'Id desc', '--limit', '5', '--all-fields']);
lectura('or.assets', 'Listar assets (solo tipos, nunca valores)', ['or', 'assets', 'list', ...alcanceCarpeta, '--limit', '50'],
  (items) => `${items.length} asset(s); por tipo: ${JSON.stringify(contarPor(items, ['ValueType', 'Type', 'type']))}`);
lectura('or.processes', 'Listar procesos', ['or', 'processes', 'list', ...alcanceCarpeta, '--limit', '50']);
lectura('or.triggers.time', 'Triggers de tiempo', ['or', 'triggers', 'list', '--type', 'time', ...(carpeta ? ['--folder-path', carpeta] : []), '--limit', '50'],
  (items) => `${items.length} trigger(s); habilitados: ${JSON.stringify(contarPor(items, ['Enabled', 'enabled', 'IsEnabled']))}`);
lectura('or.triggers.queue', 'Triggers de cola', ['or', 'triggers', 'list', '--type', 'queue', ...(carpeta ? ['--folder-path', carpeta] : []), '--limit', '50']);
lectura('or.machines', 'Listar máquinas', ['or', 'machines', 'list', ...(carpeta ? ['--folder-path', carpeta] : []), '--limit', '20']);

// ---------- 5) fallback REST OData (independiente del CLI) ----------
// curl lee su configuración desde stdin (-K -): el secreto y el token no aparecen en argv.
function curlConfig(lineas) {
  return ejecutar('curl', ['-sS', '-K', '-', '-w', '\n__HTTP__%{http_code}'], { input: lineas.join('\n') + '\n', timeoutMs: 60000 });
}
function escapar(v) { return String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"'); }
function separarHttp(stdout) {
  const i = stdout.lastIndexOf('__HTTP__');
  return i < 0 ? { cuerpo: stdout, http: '000' } : { cuerpo: stdout.slice(0, i), http: stdout.slice(i + 8).trim() };
}

if (!faltantes.length) {
  const cuerpoToken = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: process.env.UIPATH_CLIENT_ID,
    client_secret: process.env.UIPATH_APP_SECRET,
    scope: alcances,
  }).toString();
  const tok = curlConfig([
    `url = "${authority}/identity_/connect/token"`,
    'request = "POST"',
    'header = "Content-Type: application/x-www-form-urlencoded"',
    `user-agent = "${USER_AGENT}"`,
    `data = "${escapar(cuerpoToken)}"`,
  ]);
  const t = separarHttp(tok.stdout);
  let token = null;
  try { token = JSON.parse(t.cuerpo).access_token || null; } catch { /* cuerpo no JSON */ }
  registrar('rest.token', 'REST: token de client credentials', token ? 'ok' : 'falla', `HTTP ${t.http}`);
  if (token) {
    const base = `${authority}/${process.env.UIPATH_ORG}/${process.env.UIPATH_TENANT}/orchestrator_`;
    const fol = curlConfig([
      `url = "${base}/odata/Folders?$top=1"`,
      `header = "Authorization: Bearer ${token}"`,
      `user-agent = "${USER_AGENT}"`,
    ]);
    const f = separarHttp(fol.stdout);
    registrar('rest.folders', 'REST: GET /odata/Folders', f.http === '200' ? 'ok' : 'falla', `HTTP ${f.http}`);
  }
} else {
  registrar('rest.token', 'REST: token de client credentials', 'omitido', 'faltan variables');
}

// ---------- 6) Bitbucket (token de solo lectura) ----------
if (process.env.BITBUCKET_TOKEN && repoPrueba) {
  // El header de autenticación va por GIT_CONFIG_* (entorno), no por argv ni en la URL.
  // Bitbucket acepta distintas formas según el tipo de token; se prueban en orden y se reporta cuál sirvió:
  //  - access token de repositorio/proyecto/workspace: Basic con usuario fijo "x-token-auth";
  //  - API token de Atlassian: Basic con BITBUCKET_USER (usuario o email) + token;
  //  - Bearer: válido para la API REST con access tokens.
  const tok = process.env.BITBUCKET_TOKEN;
  const basic = (u) => 'Basic ' + Buffer.from(`${u}:${tok}`).toString('base64');
  const estrategias = [
    ...(process.env.BITBUCKET_USER ? [{ nombre: 'Basic BITBUCKET_USER', cred: basic(process.env.BITBUCKET_USER) }] : []),
    { nombre: 'Basic x-token-auth (access token)', cred: basic('x-token-auth') },
    { nombre: 'Bearer', cred: `Bearer ${tok}` },
  ];
  const url = `https://bitbucket.org/${repoPrueba}.git`;

  // Diagnóstico por API REST: distingue token inválido / sin acceso al repo / tipo de token.
  for (const e of estrategias) {
    const r = curlConfig([`url = "https://api.bitbucket.org/2.0/repositories/${repoPrueba}?fields=slug"`, `header = "Authorization: ${e.cred}"`, `user-agent = "${USER_AGENT}"`]);
    registrar(`bb.api.${e.nombre}`, `Bitbucket API (${e.nombre})`, separarHttp(r.stdout).http === '200' ? 'ok' : 'aviso', `HTTP ${separarHttp(r.stdout).http}`);
  }

  let envGit = null;
  let lsr = { codigo: 1, stderr: 'sin estrategias' };
  for (const e of estrategias) {
    const env = { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'http.https://bitbucket.org/.extraHeader', GIT_CONFIG_VALUE_0: `Authorization: ${e.cred}` };
    lsr = ejecutar('git', ['ls-remote', '--heads', '--tags', url], { env, timeoutMs: 60000 });
    if (lsr.codigo === 0) { envGit = env; registrar('bb.auth', 'Bitbucket: forma de autenticación git', 'ok', e.nombre); break; }
  }
  if (lsr.codigo !== 0) {
    registrar('bb.lsremote', 'Bitbucket: ls-remote', 'falla', (lsr.stderr || '').split('\n').filter(Boolean).slice(-1)[0] || `código ${lsr.codigo}`);
  } else {
    const refs = lsr.stdout.split('\n').filter(Boolean);
    const tagsV = refs.filter((l) => /refs\/tags\/v\d/.test(l) && !l.endsWith('^{}')).length;
    registrar('bb.lsremote', 'Bitbucket: ls-remote', 'ok', `${refs.filter((l) => l.includes('refs/heads/')).length} rama(s), ${tagsV} tag(s) v<versión>`);
    const destino = join(DIR_SALIDA, 'clon');
    const cl = ejecutar('git', ['clone', '--depth', '1', '--quiet', url, destino], { env: envGit, timeoutMs: 300000 });
    if (cl.codigo !== 0) {
      registrar('bb.clone', 'Bitbucket: clon superficial', 'falla', (cl.stderr || '').split('\n').filter(Boolean).slice(-1)[0] || `código ${cl.codigo}`);
    } else {
      const docs = existsSync(join(destino, 'docs')) ? readdirSync(join(destino, 'docs')).filter((n) => /\.(md|docx)$/i.test(n)) : [];
      const contar = (re) => ejecutar('bash', ['-c', `find "${destino}" -type f -not -path '*/.git/*' | grep -Ei '${re}' | wc -l`]).stdout.trim();
      registrar('bb.clone', 'Bitbucket: clon superficial', 'ok',
        `docs/: ${docs.length ? docs.join(', ') : '(sin .md/.docx)'}; project.json: ${contar('project\\.json$')}; .xaml: ${contar('\\.xaml$')}; .cs: ${contar('\\.cs$')}`);
      rmSync(destino, { recursive: true, force: true });
    }
  }
} else {
  registrar('bb.lsremote', 'Bitbucket', 'omitido', 'faltan BITBUCKET_TOKEN o --repo');
}

// ---------- 7) red: hosts bloqueados por el proxy durante la verificación ----------
if (process.env.HTTPS_PROXY) {
  const px = ejecutar('curl', ['-sS', '--max-time', '10', `${process.env.HTTPS_PROXY}/__agentproxy/status`]);
  try {
    const fallas = (JSON.parse(px.stdout).recentRelayFailures || []).filter((f) => new Date(f.ts) >= inicio);
    const hosts = [...new Set(fallas.map((f) => (f.detail.match(/https?:\/\/[^/\s]+/) || [f.detail])[0]))];
    registrar('red', 'Hosts bloqueados por la política de red', hosts.length ? 'aviso' : 'ok', hosts.length ? hosts.join(', ') : 'ninguno');
  } catch {
    registrar('red', 'Hosts bloqueados por la política de red', 'aviso', 'no se pudo leer el estado del proxy');
  }
}

// ---------- veredicto ----------
const ok = (id) => resultados.some((r) => r.id === id && r.estado === 'ok');
const lecturasClave = ['or.jobs', 'or.queueitems', 'or.processes'];
let veredicto;
if (ok('cli.login') && lecturasClave.every(ok)) veredicto = 'GO';
else if (ok('rest.folders')) veredicto = 'GO CON FALLBACK (REST)';
else veredicto = 'NO-GO';

const informe = [
  `# Verificación de entorno — ${inicio.toISOString()}`,
  '',
  `**Veredicto UiPath:** ${veredicto}`,
  `**Bitbucket:** ${ok('bb.clone') ? 'OK' : (resultados.find((r) => r.id === 'bb.lsremote') || {}).estado || 'sin probar'}`,
  `**Pendiente (lo verifica el agente):** escritura con ArtifactData en OPS_ARTIFACT_URL sin prompts.`,
  '',
  '| Estado | Comprobación | Detalle |',
  '|---|---|---|',
  ...resultados.map((r) => `| ${r.estado} | ${r.titulo} | ${String(r.detalle).replace(/\|/g, '\\|')} |`),
  '',
  '## Forma de las respuestas (solo nombres de campos)',
  '',
  '```json',
  JSON.stringify(formas, null, 2),
  '```',
  '',
].join('\n');
writeFileSync(join(DIR_SALIDA, 'reporte.md'), informe);
writeFileSync(join(DIR_SALIDA, 'formas.json'), JSON.stringify(formas, null, 2));
console.log(`\nVeredicto UiPath: ${veredicto}`);
console.log(`Reporte: ${join(DIR_SALIDA, 'reporte.md')}`);
process.exit(veredicto === 'NO-GO' ? 1 : 0);
