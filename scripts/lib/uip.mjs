// Acceso de solo lectura a Orchestrator a través del CLI `uip` (validado en la Fase 0).
//
// - Solo permite verbos de lectura (lista blanca). Cualquier otro comando lanza un error
//   antes de ejecutarse: la Torre de Control solo reporta.
// - Modo fixtures: si OPS_FIXTURES apunta a un directorio, las respuestas se leen de archivos
//   JSON en lugar de llamar al CLI. Lo usan los tests y el modo --dry-run.
// - Las variables UIPATH_TELEMETRY_DISABLED / UIPATH_CLI_DISABLE_VERSION_SYNC evitan ruido en stdout.

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

// Recurso -> verbos permitidos. Todo lo demás está prohibido.
// Excluidos a propósito: assets get-asset-value (secretos), attachments, jobs healing-data
// (capturas con posible PII) y cualquier verbo que modifique algo.
export const LECTURA_PERMITIDA = {
  folders: ['list', 'get'],
  jobs: ['list', 'get', 'logs', 'history'],
  'queue-items': ['list', 'get', 'get-history'],
  queues: ['list', 'get', 'get-stats'],
  assets: ['list', 'get'],
  processes: ['list', 'get', 'version-history'],
  triggers: ['list', 'get', 'history'],
  machines: ['list', 'get'],
  'audit-logs': ['list'],
  // Paquetes y librerías (feed del tenant): metadatos y DESCARGA del .nupkg para leer el código de la
  // versión desplegada. La descarga solo se permite hacia work/ (ver destinoPermitido).
  packages: ['list', 'get', 'versions', 'entry-points', 'download'],
  libraries: ['list', 'get', 'versions', 'download'],
};

const FLAGS_PROHIBIDOS = ['--export'];

// Una descarga (packages/libraries download) solo puede escribir dentro de un directorio work/.
export function destinoPermitido(ruta) {
  if (!ruta) return false;
  const r = String(ruta).replace(/\\/g, '/');
  if (r.includes('..')) return false;
  return /^(\.\/)?work\//.test(r) || /\/work\//.test(r);
}

export class ErrorUip extends Error {
  constructor(mensaje, envelope) {
    super(mensaje);
    this.envelope = envelope || null;
  }
}

export function validarComandoLectura(argv) {
  if (argv[0] === 'login') return; // login / login status
  if (argv[0] !== 'or') throw new ErrorUip(`Comando no permitido (solo 'uip or ...' de lectura): ${argv.slice(0, 3).join(' ')}`);
  const [, recurso, verbo] = argv;
  const verbos = LECTURA_PERMITIDA[recurso];
  if (!verbos || !verbos.includes(verbo)) throw new ErrorUip(`Verbo no permitido para la Torre de Control: uip or ${recurso} ${verbo}`);
  if (argv.some((a) => FLAGS_PROHIBIDOS.includes(a))) throw new ErrorUip('Flag no permitido (exportación a archivo)');
  const iDest = argv.findIndex((a) => a === '--destination' || a === '-d');
  if (verbo === 'download') {
    if (iDest < 0 || !destinoPermitido(argv[iDest + 1])) throw new ErrorUip('Descarga permitida solo con --destination dentro de work/');
  } else if (iDest >= 0) {
    throw new ErrorUip('Flag --destination solo permitido en descargas de paquetes o librerías');
  }
}

const ENV_UIP = {
  UIPATH_TELEMETRY_DISABLED: 'true',
  UIPATH_CLI_DISABLE_VERSION_SYNC: 'true',
  UIPATH_CLI_DISABLE_AUTOINSTALL: 'true',
};

export function parsearEnvelope(stdout) {
  const i = (stdout || '').indexOf('{');
  if (i < 0) return null;
  try { return JSON.parse(stdout.slice(i)); } catch { return null; }
}

// Clave estable de una invocación, usada para nombrar los archivos de fixtures.
export function claveFixture(argv) {
  const sinSalida = argv.filter((a, i) => !(a === '--output' || argv[i - 1] === '--output'));
  const legible = sinSalida.slice(1, 3).join('_');
  const hash = createHash('sha1').update(sinSalida.join('\u0000')).digest('hex').slice(0, 10);
  return `${legible}__${hash}`;
}

function desdeFixture(dir, argv) {
  const exacto = join(dir, `${claveFixture(argv)}.json`);
  // Alternativa genérica por recurso/verbo: útil para fixtures escritos a mano.
  const generico = join(dir, `${argv.slice(1, 3).join('_')}.json`);
  const archivo = existsSync(exacto) ? exacto : existsSync(generico) ? generico : null;
  if (!archivo) return { Result: 'Success', Code: 'Fixture', Data: [] };
  const contenido = JSON.parse(readFileSync(archivo, 'utf8'));
  // Un fixture genérico puede tener respuestas por argumento clave (p. ej. por job key o por cola).
  if (contenido.__porArgumento) {
    const k = argv.find((a) => contenido.__porArgumento[a] !== undefined);
    return k ? contenido.__porArgumento[k] : (contenido.__defecto || { Result: 'Success', Data: [] });
  }
  return contenido;
}

export function uip(argv, { timeoutMs = 120000 } = {}) {
  validarComandoLectura(argv);
  const completo = [...argv, '--output', 'json'];
  if (process.env.OPS_FIXTURES) {
    const env = desdeFixture(process.env.OPS_FIXTURES, completo);
    if (env.Result !== 'Success') throw new ErrorUip(env.Message || env.ErrorCode || 'Error en fixture', env);
    return env.Data;
  }
  const r = spawnSync('uip', completo, {
    env: { ...process.env, ...ENV_UIP },
    encoding: 'utf8',
    timeout: timeoutMs,
    maxBuffer: 256 * 1024 * 1024,
  });
  const env = parsearEnvelope(r.stdout);
  if (r.status !== 0 || !env || env.Result !== 'Success') {
    const motivo = env ? [env.Result, env.ErrorCode, env.Message && String(env.Message).split('\n')[0]].filter(Boolean).join(' | ') : (r.error ? String(r.error.message) : `código ${r.status}`);
    throw new ErrorUip(`uip ${argv.slice(0, 3).join(' ')}: ${motivo}`, env);
  }
  return env.Data;
}

// Paginación con --limit/--offset hasta agotar resultados o llegar a `maximo`.
export function uipTodo(argv, { pagina = 100, maximo = 2000, corte } = {}) {
  const items = [];
  for (let offset = 0; offset < maximo; offset += pagina) {
    const data = uip([...argv, '--limit', String(pagina), '--offset', String(offset)]);
    const lote = Array.isArray(data) ? data : [];
    items.push(...lote);
    // `corte(item)` permite detener la paginación (p. ej. al pasar el watermark en listados por Id desc).
    if (lote.length < pagina || (corte && lote.some(corte))) break;
  }
  return items;
}

export function login() {
  if (process.env.OPS_FIXTURES) return { simulado: true };
  const faltan = ['UIPATH_TENANT', 'UIPATH_CLIENT_ID', 'UIPATH_APP_SECRET'].filter((v) => !process.env[v]);
  if (faltan.length) throw new ErrorUip(`Faltan variables de entorno: ${faltan.join(', ')}`);
  const alcances = process.env.UIPATH_SCOPES || 'OR.Folders.Read OR.Jobs.Read OR.Queues.Read OR.Assets.Read OR.Execution.Read OR.Monitoring.Read OR.Robots.Read OR.Machines.Read';
  const argv = ['login', '--client-id', 'env.UIPATH_CLIENT_ID', '--client-secret', 'env.UIPATH_APP_SECRET', '-t', process.env.UIPATH_TENANT, '-s', alcances];
  if (process.env.UIPATH_AUTHORITY) argv.push('--authority', process.env.UIPATH_AUTHORITY);
  return uip(argv);
}

// Link directo a Orchestrator para que un humano vea el dato crudo con sus permisos de UiPath.
export function linkOrchestrator(tipo, clave) {
  const org = process.env.UIPATH_ORG;
  const tenant = process.env.UIPATH_TENANT;
  if (!org || !tenant || !clave) return null;
  const base = `${(process.env.UIPATH_AUTHORITY || 'https://cloud.uipath.com').replace(/\/+$/, '')}/${org}/${tenant}/orchestrator_`;
  if (tipo === 'job') return `${base}/jobs?key=${encodeURIComponent(clave)}`;
  return base;
}
