// Tests de los scripts de la rutina. Ejecutar: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, cpSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { redactarTexto, sanitizarQueueItem, sanitizarAsset, detectarPii } from '../scripts/lib/redact.mjs';
import { normalizarFirma, fingerprint } from '../scripts/lib/fingerprint.mjs';
import { validarComandoLectura } from '../scripts/lib/uip.mjs';
import { evaluar, evaluarRegla, categorizar, enHorario } from '../scripts/evaluate.mjs';
import { consolidar } from '../scripts/consolidar.mjs';
import { prepararLotes } from '../scripts/build-writes.mjs';

const RAIZ = new URL('..', import.meta.url).pathname;
const FIX = join(RAIZ, 'fixtures', 'tenant-ejemplo');

function senalesDeFixture() {
  const dir = mkdtempSync(join(tmpdir(), 'torre-'));
  const salida = join(dir, 'senales.json');
  execFileSync('node', [join(RAIZ, 'scripts/collect.mjs'), '--proyecto', join(FIX, 'db/projects/facturacion.json'), '--desde', '2026-11-09T10:00:00Z', '--hasta', '2026-11-09T11:00:00Z', '--salida', salida], { env: { ...process.env, OPS_FIXTURES: join(FIX, 'uip') } });
  return { dir, senales: JSON.parse(readFileSync(salida, 'utf8')) };
}

const proyecto = () => { const d = JSON.parse(readFileSync(join(FIX, 'db/projects/facturacion.json'), 'utf8')); return { id: d.id, __version: d.version, ...d.data }; };
const regla = () => { const d = JSON.parse(readFileSync(join(FIX, 'db/rules/regla-login.json'), 'utf8')); return { id: d.id, ...d.data }; };

test('redacción: emails, usuarios de Windows, CUIT y parámetros de URL', () => {
  const s = redactarTexto('Login failed for ACME\\jperez (jperez@cliente.com) CUIT 20-12345678-9 en https://sap.local/x?user=jperez');
  assert.ok(!s.includes('jperez'), s);
  assert.ok(!s.includes('20-12345678-9'), s);
  assert.match(s, /\[USUARIO\]/);
  assert.match(s, /\[EMAIL\]/);
});

test('redacción: no rompe rutas de workflows ni mensajes técnicos', () => {
  const s = redactarTexto("Could not find the UI element 'Guardar' in Framework\\InitAllSettings.xaml");
  assert.match(s, /Framework\\InitAllSettings\.xaml/);
});

test('queue items: nunca se guarda SpecificContent ni la Reference en claro', () => {
  const it = sanitizarQueueItem({ Id: 1, Status: 'Failed', Reference: 'FAC-1', SpecificContent: { Cliente: 'Juan Pérez' }, ProcessingException: { Reason: 'Error para juan@x.com', Type: 'BusinessException' } }, 'Q');
  const txt = JSON.stringify(it);
  assert.ok(!txt.includes('Juan Pérez'));
  assert.ok(!txt.includes('FAC-1'));
  assert.deepEqual(it.camposContenido, ['Cliente']);
  assert.equal(it.tipoExcepcion, 'Business');
  assert.ok(!txt.includes('juan@x.com'));
});

test('assets: el valor se descarta siempre', () => {
  assert.deepEqual(Object.keys(sanitizarAsset({ Name: 'A', ValueType: 'Text', Value: 'secreto' })).sort(), ['alcance', 'nombre', 'tipo']);
});

test('fingerprint: estable ante números, fechas y GUIDs', () => {
  const a = normalizarFirma('Timeout 30s at 2026-11-09T10:00:00Z job 3f2504e0-4f89-11d3-9a0c-0305e82c3301');
  const b = normalizarFirma('Timeout 45s at 2026-11-10T08:12:00Z job 9a2504e0-4f89-11d3-9a0c-0305e82c3302');
  assert.equal(a, b);
  assert.equal(fingerprint({ projectId: 'p', categoria: 'app_down', firma: 'x 1' }), fingerprint({ projectId: 'p', categoria: 'app_down', firma: 'x 2' }));
});

test('solo lectura: bloquea verbos que modifican Orchestrator o exponen secretos', () => {
  assert.doesNotThrow(() => validarComandoLectura(['or', 'jobs', 'list']));
  assert.doesNotThrow(() => validarComandoLectura(['or', 'packages', 'download', 'Pkg:1.0.0', '--destination', 'work/r/pkg.nupkg']));
  assert.doesNotThrow(() => validarComandoLectura(['or', 'libraries', 'download', 'k', '-d', '/home/user/repo/work/x.nupkg']));
  for (const argv of [['or', 'packages', 'download', 'P:1'], ['or', 'packages', 'download', 'P:1', '-d', '/tmp/x.nupkg'], ['or', 'libraries', 'download', 'k', '-d', 'work/../../etc/x'], ['or', 'packages', 'upload', 'x'], ['or', 'packages', 'delete', 'P:1'], ['or', 'libraries', 'upload', 'x'], ['or', 'jobs', 'list', '-d', 'work/x']]) {
    assert.throws(() => validarComandoLectura(argv), argv.join(' '));
  }
  for (const argv of [['or', 'jobs', 'start'], ['or', 'jobs', 'stop'], ['or', 'assets', 'get-asset-value'], ['or', 'queues', 'delete'], ['or', 'processes', 'rollback'], ['solution', 'deploy'], ['or', 'jobs', 'logs', 'k', '--export']]) {
    assert.throws(() => validarComandoLectura(argv), argv.join(' '));
  }
});

test('categorización por texto', () => {
  assert.equal(categorizar('Login failed: invalid credentials'), 'login');
  assert.equal(categorizar("Could not find the UI element 'Guardar'"), 'selector');
  assert.equal(categorizar('The remote server returned an error: (503) Server Unavailable'), 'app_down');
});

test('evaluación: checks base del escenario de ejemplo', () => {
  const { senales } = senalesDeFixture();
  const r = evaluar({ senales, proyecto: proyecto(), reglas: [regla()] });
  const alerta = (id) => r.checks.find((c) => c.id === id).resultado === 'alerta';
  for (const id of ['jobs_faulted', 'silent_failure', 'queue_app_exceptions', 'queue_abandoned', 'queue_business_rate', 'trigger_disabled', 'deploy_detected', 'jobs_pending_long', 'rule:regla-login']) assert.ok(alerta(id), id);
  // La regla de login se suma a la tarjeta de jobs con error de login: no se duplica el tema.
  const login = r.hallazgos.filter((h) => h.categoria === 'login');
  assert.equal(login.length, 1);
  assert.deepEqual(login[0].reglas, ['regla-login']);
  assert.equal(login[0].decisionSugerida, 'escalate');
  assert.ok(!JSON.stringify(r).includes('jperez'), 'no debe haber PII en los hallazgos');
});

test('regla "consecutive": cuenta la racha más larga', () => {
  const s = { ventana: { desde: '2026-01-01T00:00:00Z', hasta: '2026-01-01T01:00:00Z' }, jobs: [], queueItems: [], logs: [
    ...Array.from({ length: 11 }, (_, i) => ({ nivel: 'Error', mensaje: 'login failed', fecha: `2026-01-01T00:${String(i).padStart(2, '0')}:00Z` })),
    { nivel: 'Error', mensaje: 'otra cosa', fecha: '2026-01-01T00:30:00Z' },
  ] };
  const r = evaluarRegla({ compiled: { signal: 'logs', filter: { messageRegex: 'login' }, aggregate: 'consecutive', threshold: 10, comparator: '>' } }, s);
  assert.equal(r.observado, 11);
  assert.equal(r.resultado, 'alerta');
});

test('regla "known": marca el hallazgo como comportamiento conocido', () => {
  const { senales } = senalesDeFixture();
  const known = { id: 'k1', projectId: 'facturacion', status: 'active', text: 'Abandonados de FIN_FAC_Facturas son normales', compiled: { action: 'known', filter: { queue: 'FIN_FAC_Facturas', messageRegex: 'abandonados' } } };
  const r = evaluar({ senales, proyecto: proyecto(), reglas: [known] });
  assert.equal(r.hallazgos.find((h) => h.checkId === 'queue_abandoned').conocidoPor, 'k1');
});

function correr(incidentes, trabajo = [], runId = 'run-1', fin = '2026-11-09T11:00:00Z') {
  const { senales } = senalesDeFixture();
  const p = proyecto();
  const hallazgos = evaluar({ senales, proyecto: p, reglas: [regla()] });
  return consolidar({ runId, inicio: fin, fin, trigger: 'dry_run', proyectos: [p], incidentes, trabajo, porProyecto: [{ projectId: p.id, hallazgos, senales }] });
}

const comoIncidentes = (plan) => plan.writes.filter((w) => w.collection === 'incidents').map((w) => ({ id: w.doc_id, __version: 1, ...w.data }));

test('consolidación: una sola tarjeta por tema entre corridas', () => {
  const r1 = correr([]);
  assert.equal(r1.resumen.newIncidents, 8);
  const r2 = correr(comoIncidentes(r1), [], 'run-2', '2026-11-09T12:00:00Z');
  assert.equal(r2.resumen.newIncidents, 0);
  assert.equal(r2.resumen.updatedIncidents, 8);
  const login = comoIncidentes(r2).find((i) => i.category === 'login');
  assert.equal(login.recurrences.length, 2);
  assert.ok(r2.writes.filter((w) => w.collection === 'incidents').every((w) => w.if_version === 1));
});

test('consolidación: un tema cerrado hace poco se reabre en la misma tarjeta', () => {
  const r1 = correr([]);
  const cerrados = comoIncidentes(r1).map((i) => ({ ...i, status: 'closed', closedAt: '2026-11-08T00:00:00Z' }));
  const r2 = correr(cerrados, [], 'run-2', '2026-11-09T12:00:00Z');
  assert.equal(r2.resumen.newIncidents, 0);
  const reabierto = comoIncidentes(r2)[0];
  assert.equal(reabierto.status, 'open');
  assert.equal(reabierto.reopenCount, 1);
});

test('consolidación: salud del proyecto ignora lo descartado por humanos', () => {
  const r1 = correr([]);
  const inc = comoIncidentes(r1);
  const trabajo = inc.map((i) => ({ id: i.id, state: 'dismissed' }));
  const r2 = correr(inc, trabajo, 'run-2', '2026-11-09T12:00:00Z');
  assert.equal(r2.writes.find((w) => w.collection === 'projects').data.health.level, 'ok');
});

test('lotes: el plan de ejemplo es válido y cabe en un lote', () => {
  const { errores, lotes } = prepararLotes(correr([]).writes);
  assert.deepEqual(errores, []);
  assert.equal(lotes.length, 1);
});

test('lotes: rechaza documentos con PII o fuera de esquema', () => {
  const { errores } = prepararLotes([
    { op: 'set', collection: 'activity', doc_id: 'a1', data: { incidentId: 'i', type: 'comment', at: 'x', text: 'avisar a juan@cliente.com' } },
    { op: 'set', collection: 'incidents', doc_id: 'i2', data: { projectId: 'p' } },
  ]);
  assert.ok(errores.some((e) => e.includes('PII')));
  assert.ok(errores.some((e) => e.includes("falta 'fingerprints'")));
});

test('PII residual: detecta emails pero no fechas ni ids', () => {
  assert.equal(detectarPii({ a: '2026-11-09T10:00:00Z', b: 'job-01' }).length, 0);
  assert.equal(detectarPii({ a: 'x@y.com' }).length, 1);
});

test('fixtures: copiar el escenario no requiere red', () => {
  const dir = mkdtempSync(join(tmpdir(), 'torre-'));
  cpSync(join(FIX, 'db'), join(dir, 'db'), { recursive: true });
  assert.ok(readFileSync(join(dir, 'db/projects/facturacion.json'), 'utf8').includes('Produccion/Finanzas'));
});

import { revisar } from '../scripts/lib/guard.mjs';

test('hook de solo lectura: permite lecturas y bloquea escrituras', () => {
  for (const ok of ['uip --version', 'uip login --client-id env.A --client-secret env.B -t T -s "OR.Jobs.Read"', 'uip login status', 'UIPATH_TELEMETRY_DISABLED=true uip or jobs list --folder-path "Prod/Fin" --output json', 'uip or jobs logs abc --level Error', 'node scripts/collect.mjs --proyecto x', 'git clone --depth 1 https://bitbucket.org/ws/repo.git work/r/clon', 'git -C work/r/clon log -1']) {
    assert.equal(revisar(ok), null, ok);
  }
  assert.equal(revisar('uip or packages download ValidacionDeDerechosPerformer:1.0.128 --destination work/v/p.nupkg --output json'), null);
  for (const mal2 of ['uip or packages download X:1 --destination /tmp/x.nupkg', 'uip or libraries download k', 'uip or packages upload x.nupkg', 'uip or libraries delete k']) assert.ok(revisar(mal2), mal2);
  for (const mal of ['uip or jobs start --process X', 'uip or assets get-asset-value k', 'uip or queues delete k', 'uip solution deploy run', 'echo hola && uip or processes rollback k', 'uip or jobs logs k --export -d x.csv', 'git -C work/r/clon push origin main', 'curl -X POST https://cloud.uipath.com/org/t/orchestrator_/odata/Jobs', 'uipcli package deploy']) {
    assert.ok(revisar(mal), mal);
  }
});

test('redacción: datos de pacientes (Colombia) — cédula, NIT y nombres etiquetados', () => {
  const s = redactarTexto('Paciente: María Fernanda López Gómez con CC 1023456 no tiene derechos vigentes en EPS NIT 900.123.456-7; afiliado Juan Pérez');
  for (const x of ['María', 'López', '1023456', '900.123.456-7', 'Juan', 'Pérez']) assert.ok(!s.includes(x), `${x} en: ${s}`);
  assert.match(s, /Paciente: \[NOMBRE\]/);
  assert.match(s, /CC \[DOCUMENTO\]/);
  // No debe comerse texto técnico normal.
  assert.equal(redactarTexto('Usuario o contraseña inválidos en el portal'), 'Usuario o contraseña inválidos en el portal');
});

import { normalizarProyecto, carpetasDe, filtroDeProcesos, procesoPorNombre } from '../scripts/lib/proyecto.mjs';
import { emparejar } from '../scripts/emparejar-procesos.mjs';

test('proyecto con varios procesos: la colecta filtra por los procesos del proyecto', () => {
  const { senales } = senalesDeFixture();
  assert.ok(!senales.jobs.some((j) => j.proceso === 'OTRO_Proyecto_Performer'), 'no trae jobs de otro proyecto de la misma carpeta');
  assert.ok(!senales.procesos.some((p) => p.nombre === 'OTRO_Proyecto_Performer'));
  assert.deepEqual(senales.procesosDelProyecto.map((x) => x.id), ['dispatcher', 'performer']);
  assert.equal(senales.filtradoPorProceso, false, 'por defecto se controla toda la carpeta');
  assert.ok(filtroDeProcesos({ includeAllProcesses: false, processes: [{ orchestratorProcess: 'A', repo: { workspace: 'w', slug: 'a' } }] }).has('A'), 'solo filtra si un Admin eligió procesos');
});

test('proyecto con varios procesos: cada hallazgo sabe a qué proceso (y repo) pertenece', () => {
  const { senales } = senalesDeFixture();
  const r = evaluar({ senales, proyecto: proyecto(), reglas: [regla()] });
  assert.equal(r.hallazgos.find((h) => h.categoria === 'login').processId, 'performer');
  const plan = consolidar({ runId: 'r', inicio: 'x', fin: '2026-11-09T11:00:00Z', trigger: 'dry_run', proyectos: [proyecto()], incidentes: [], trabajo: [], porProyecto: [{ projectId: 'facturacion', hallazgos: r, senales }] });
  assert.equal(plan.writes.find((w) => w.collection === 'incidents' && w.data.category === 'login').data.processId, 'performer');
});

test('proyecto: el formato anterior (un solo repo) se lee como un proceso', () => {
  const n = normalizarProyecto({ name: 'X', orchestrator: { folderPath: 'A' }, repo: { workspace: 'w', slug: 'x-performer' }, docs: { paths: ['docs/SDD.md'] } });
  assert.equal(n.processes.length, 1);
  assert.equal(n.processes[0].role, 'performer');
  assert.equal(n.processes[0].repo.slug, 'x-performer');
  assert.equal(filtroDeProcesos(n), null, 'sin nombre de Orchestrator no filtra');
});

test('proyecto: carpetas por proceso y búsqueda por nombre de Orchestrator', () => {
  const p = { orchestrator: { folderPath: 'Prod/VD' }, processes: [
    { id: 'd', label: 'Dispatcher', orchestratorProcess: 'VD_Dispatcher', repo: { workspace: 'w', slug: 'd' } },
    { id: 'r', label: 'Reporter', folderPath: 'Prod/Reportes', repo: { workspace: 'w', slug: 'r' } },
  ] };
  assert.deepEqual(carpetasDe(p), ['Prod/VD', 'Prod/Reportes']);
  assert.equal(procesoPorNombre(p, 'VD_Dispatcher').id, 'd');
  assert.equal(procesoPorNombre(p, 'VD_Reporter').id, 'r', 'por rol cuando falta el nombre');
});

test('emparejar procesos: por paquete, por rol, y sin adivinar ante ambigüedad', () => {
  const proyecto = { orchestrator: { folderPath: 'Prod/VD' }, processes: [
    { id: 'dispatcher', label: 'Dispatcher', repo: { workspace: 'w', slug: 'vd-dispatcher' } },
    { id: 'performer', label: 'Performer', repo: { workspace: 'w', slug: 'vd-performer' } },
    { id: 'otro', label: 'Otro', role: 'other', repo: { workspace: 'w', slug: 'vd-otro' } },
  ] };
  const inventario = { inventory: { processes: [{ name: 'VD_Dispatcher', package: 'VD.Dispatcher' }, { name: 'VD_Performer', package: 'CO_CL_Performer' }, { name: 'VD_Reporter', package: 'VD.Reporter' }] } };
  const r = emparejar(proyecto, inventario, [{ proceso: 'performer', paquete: 'CO_CL_Performer' }]);
  const m = Object.fromEntries(r.processes.map((x) => [x.id, x.orchestratorProcess]));
  assert.equal(m.performer, 'VD_Performer');
  assert.equal(m.dispatcher, 'VD_Dispatcher');
  assert.equal(m.otro, null);
  assert.deepEqual(r.sinDeclarar, ['VD_Reporter']);
});

import { normalizarCategoria } from '../scripts/evaluate.mjs';

test('reglas: "no corrió en N horas" usa el último job conocido, no solo la ventana colectada', () => {
  const s = { ventana: { desde: '2026-11-09T19:00:00Z', hasta: '2026-11-09T20:00:00Z' }, jobs: [], queueItems: [], logs: [] };
  const regla = { compiled: { signal: 'jobs', aggregate: 'absence', filter: { process: 'VD_Dispatcher' }, windowMinutes: 540 } };
  assert.equal(evaluarRegla(regla, s, { watermarks: { lastJobByProcess: { VD_Dispatcher: '2026-11-09T18:00:00Z' } } }).resultado, 'ok', '2 h < 9 h');
  assert.equal(evaluarRegla(regla, s, { watermarks: { lastJobByProcess: { VD_Dispatcher: '2026-11-09T08:00:00Z' } } }).resultado, 'alerta', '12 h > 9 h');
  assert.equal(evaluarRegla(regla, s, {}).resultado, 'omitido', 'sin historial no alerta');
});

test('reglas: la tasa se calcula sobre los jobs del mismo proceso', () => {
  const j = (p, e, i) => ({ proceso: p, estado: e, creado: `2026-11-09T19:${String(i).padStart(2, '0')}:00Z` });
  const s = { ventana: { desde: '2026-11-09T19:00:00Z', hasta: '2026-11-09T20:00:00Z' }, queueItems: [], logs: [],
    jobs: [j('VD_Performer', 'Faulted', 1), j('VD_Performer', 'Faulted', 2), j('VD_Performer', 'Successful', 3), ...Array.from({ length: 10 }, (_, i) => j('VD_Dispatcher', 'Successful', 10 + i))] };
  const r = evaluarRegla({ compiled: { signal: 'jobs', aggregate: 'rate', filter: { process: 'VD_Performer', state: ['Faulted'] }, threshold: 0.6, comparator: '>' } }, s);
  assert.equal(r.observado, 0.667);
  assert.equal(r.resultado, 'alerta');
});

test('reglas: categorías inventadas se traducen a las válidas', () => {
  assert.equal(normalizarCategoria('no-ejecuto'), 'scheduling');
  assert.equal(normalizarCategoria('login'), 'login');
  assert.equal(normalizarCategoria('fallas-masivas', 'Login failed for user'), 'login');
  assert.equal(normalizarCategoria('fallas-masivas', 'error inesperado'), 'application');
});

test('colecta: un job creado antes de la ventana que corrió dentro de ella cuenta como actividad', () => {
  const s = { ventana: { desde: '2026-11-09T20:00:00Z', hasta: '2026-11-09T21:00:00Z' }, queueItems: [], logs: [], triggers: [], procesos: [], errores: [], conteos: {},
    jobs: [{ key: 'j1', proceso: 'VD_Dispatcher', estado: 'Successful', creado: '2026-11-09T15:00:00Z', inicio: '2026-11-09T20:34:00Z', fin: '2026-11-09T20:35:00Z' }] };
  const r = evaluar({ senales: { ...s, projectId: 'p' }, proyecto: { baseline: { expectedMaxGapHours: { VD_Dispatcher: 9, VD_Reporter: 9 } } } });
  assert.ok(!r.hallazgos.some((h) => h.checkId === 'process_no_runs'), 'ni el Dispatcher (corrió) ni el Reporter (sin datos aún) alertan');
  const espera = r.hallazgos.find((h) => h.checkId === 'jobs_pending_long');
  assert.ok(espera, 'detecta que el job esperó 5,5 h antes de arrancar');
  assert.match(espera.titulo, /esperaron 5\.6 h/);
});

test('consolidación: lo no reportado que no se repite en 24 h se cierra solo', () => {
  const viejo = { id: 'inc-x', projectId: 'facturacion', status: 'open', decision: 'monitor', severity: 'P4', fingerprints: ['zzz'], lastSeenAt: '2026-11-07T00:00:00Z', triage: {} };
  const escalado = { ...viejo, id: 'inc-y', decision: 'escalate', fingerprints: ['yyy'] };
  const plan = correr([viejo, escalado], [], 'run-9', '2026-11-09T11:00:00Z');
  const w = plan.writes.find((x) => x.doc_id === 'inc-x');
  assert.equal(w.data.status, 'closed');
  assert.ok(!plan.writes.some((x) => x.doc_id === 'inc-y'), 'lo escalado no se cierra solo');
});

import { planDescubrimiento } from '../scripts/plan-descubrimiento.mjs';

test('descubrimiento: agrupa procesos por carpeta, marca registrados y arma el plan de alta', () => {
  const dir = mkdtempSync(join(tmpdir(), 'desc-'));
  execFileSync('node', [join(RAIZ, 'scripts/descubrir.mjs'), '--salida', join(dir, 'c.json'), '--registrados', join(FIX, 'db/projects'), '--sin-bitbucket'], { env: { ...process.env, OPS_FIXTURES: join(FIX, 'uip') } });
  const c = JSON.parse(readFileSync(join(dir, 'c.json'), 'utf8'));
  const fin = c.candidatos.find((x) => x.folderPath === 'Produccion/Finanzas');
  const otro = c.candidatos.find((x) => x.folderPath === 'Produccion/Otro');
  assert.equal(fin.registradoComo, 'facturacion', 'la carpeta ya registrada se reconoce');
  assert.deepEqual(fin.processes.map((p) => p.role).sort(), ['dispatcher', 'performer']);
  assert.ok(otro.activo, 'tiene jobs en la ventana');
  // Los jobs se atribuyen por Key aunque Orchestrator devuelva mayúsculas en el proceso y minúsculas en el job.
  assert.equal(fin.processes.find((p) => p.role === 'performer')._info.jobs, 6);
  assert.equal(otro.jobs, 1);
  const plan = planDescubrimiento(c, { ahora: '2026-11-09T21:00:00Z' });
  assert.deepEqual(plan.creados.map((x) => x.folderPath), ['Produccion/Otro']);
  assert.ok(plan.writes.some((w) => w.collection === 'requests' && w.data.type === 'onboard_project'));
  assert.ok(!JSON.stringify(plan.writes).includes('_info'));
  const { errores } = prepararLotes(plan.writes);
  assert.deepEqual(errores, []);
});

import { permitido, listar, extraerSeguro, leerDependencias, actividadesDe } from '../scripts/lib/paquetes.mjs';
import { indexar } from '../scripts/indexar-codigo.mjs';
import { atribuirLibreria } from '../scripts/evaluate.mjs';
import { compactarMensajeUiPath, sanitizarLog } from '../scripts/lib/redact.mjs';
import { readdirSync } from 'node:fs';

const PKG = join(FIX, 'paquetes');
const conFixtures = (fn) => { const prev = process.env.OPS_FIXTURES; const prevC = process.env.OPS_PAQUETES_CACHE; process.env.OPS_FIXTURES = join(FIX, 'uip'); process.env.OPS_PAQUETES_CACHE = mkdtempSync(join(tmpdir(), 'pkg-')); try { return fn(); } finally { process.env.OPS_FIXTURES = prev ?? ''; if (!prev) delete process.env.OPS_FIXTURES; process.env.OPS_PAQUETES_CACHE = prevC ?? ''; if (!prevC) delete process.env.OPS_PAQUETES_CACHE; } };

test('paquetes: la extracción solo saca código y documentación (nunca datos, capturas ni rutas raras)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'x-'));
  const sacados = extraerSeguro(join(PKG, 'FIN_Facturacion_Performer@1.4.0.nupkg'), dir);
  assert.deepEqual(sacados.sort(), ['Framework/InitAllApplications.xaml', 'Main.xaml', 'Process.xaml', 'README.md', 'project.json']);
  for (const e of ['content/Data/Config.xlsx', 'content/Exceptions_Screenshots/x.png', 'content/.autopilot/a.md', 'content/../evil.xaml', 'lib/net8.0/P.dll']) assert.equal(permitido(e), false, e);
  assert.ok(!readdirSync(dir).includes('Data'));
});

test('paquetes: dependencias propias con versión exacta y actividades de la librería', () => {
  const deps = leerDependencias({ dependencies: { 'UiPath.System.Activities': '[25.10.0]', ValidarEPS: '[1.0.147]' } });
  assert.deepEqual(deps, [{ name: 'ValidarEPS', version: '1.0.147' }]);
  assert.deepEqual(actividadesDe(listar(join(PKG, 'LIB_Sap@2.2.0.nupkg'))), ['GuardarFactura', 'LoginSap']);
});

test('índice: librerías directas e indirectas por proceso, sin re-indexar versiones ya vistas', () => conFixtures(() => {
  const procesos = [{ nombre: 'FIN_Facturacion_Performer', paquete: 'FIN_Facturacion_Performer', version: '1.4.0' }];
  const r = indexar({ procesos });
  assert.deepEqual(r.procesos[0].libraries.map((l) => `${l.name}@${l.version}`), ['LIB_Sap@2.2.0', 'LIB_Comun@1.0.0']);
  assert.equal(r.procesos[0].hygiene.capturas, 1);
  assert.deepEqual(r.libraries.LIB_Comun['1.0.0'].activities, ['EnviarCorreoAlerta']);
  assert.equal(indexar({ procesos, inventario: [{ name: 'FIN_Facturacion_Performer', indexedVersion: '1.4.0' }] }).procesos.length, 0);
}));

test('atribución: el error se asigna a la actividad de la librería, sin falsos positivos con "login"', () => {
  const libs = [{ name: 'LIB_Sap', version: '2.2.0' }];
  const cat = { LIB_Sap: { '2.2.0': { activities: ['GuardarFactura', 'LoginSap', 'Login'] } } };
  assert.deepEqual(atribuirLibreria('System exception at source: LoginSap', libs, cat), { name: 'LIB_Sap', version: '2.2.0', activity: 'LoginSap' });
  assert.equal(atribuirLibreria('Login failed: invalid credentials', libs, cat), null);
  assert.equal(atribuirLibreria('Error en LoginSapViejo', libs, cat), null, 'palabra completa');
});

test('evidencia: se quita el bloque fijo de UiPath y queda visible "at source"', () => {
  const m = 'Login Famisanar no se completó: Could not find the user-interface (UI) element for this action.\r\n\r\nPossible solutions:\r\n • Ensure application is opened\r\n • Increase the "Delay before" value at source: Validar - Invoke Workflow File';
  assert.equal(compactarMensajeUiPath(m), 'Login Famisanar no se completó: Could not find the user-interface (UI) element for this action. at source: Validar - Invoke Workflow File');
  assert.ok(sanitizarLog({ Level: 'Error', Message: m }, 'j').firmaV1);
});

test('consolidación: una tarjeta con la firma anterior se actualiza (no se duplica) y toma la librería', () => {
  const s = { projectId: 'facturacion', ventana: { desde: '2026-11-09T10:00:00Z', hasta: '2026-11-09T11:00:00Z' }, jobs: [{ key: 'j', proceso: 'FIN_Facturacion_Performer', estado: 'Faulted', creado: '2026-11-09T10:01:00Z', fin: '2026-11-09T10:02:00Z' }],
    logs: [sanitizarLog({ Level: 'Fatal', Message: 'Fallo at source: LoginSap\r\nPossible solutions:\r\n • x', TimeStamp: '2026-11-09T10:01:30Z' }, 'j')].map((l) => ({ ...l, proceso: 'FIN_Facturacion_Performer' })),
    queueItems: [], colas: [], procesos: [], triggers: [], assets: [], errores: [], conteos: {} };
  const proyectoInv = { ...proyecto(), inventory: { processes: [{ name: 'FIN_Facturacion_Performer', libraries: [{ name: 'LIB_Sap', version: '2.2.0' }] }] } };
  const r = evaluar({ senales: s, proyecto: proyectoInv, librerias: { LIB_Sap: { '2.2.0': { activities: ['LoginSap'] } } } });
  const h = r.hallazgos.find((x) => x.checkId === 'jobs_faulted');
  assert.equal(h.libreria.activity, 'LoginSap');
  assert.ok(h.fingerprintLegacy && h.fingerprintLegacy !== h.fingerprint);
  const vieja = { id: 'inc-viejo', __version: 4, projectId: 'facturacion', status: 'open', decision: 'escalate', severity: 'P2', category: h.categoria, fingerprints: [h.fingerprintLegacy], occurrences: 1, recurrences: [], triage: {}, process: 'FIN_Facturacion_Performer' };
  const plan = consolidar({ runId: 'r', inicio: 'x', fin: '2026-11-09T11:00:00Z', trigger: 'dry_run', proyectos: [proyectoInv], incidentes: [vieja], trabajo: [], porProyecto: [{ projectId: 'facturacion', hallazgos: r, senales: s }] });
  assert.equal(plan.resumen.newIncidents, 0);
  const w = plan.writes.find((x) => x.doc_id === 'inc-viejo');
  assert.equal(w.data.library.name, 'LIB_Sap');
});

test('consolidación: un deploy marca las tarjetas abiertas del proceso y las manda a re-análisis', () => {
  const { senales } = senalesDeFixture();
  const p = proyecto();
  const hall = evaluar({ senales, proyecto: p, reglas: [regla()] });
  const abierta = { id: 'inc-a', __version: 1, projectId: 'facturacion', status: 'open', decision: 'escalate', severity: 'P2', category: 'selector', fingerprints: ['zzz'], occurrences: 1, recurrences: [], triage: {}, process: 'FIN_Facturacion_Performer', analysis: { status: 'done' } };
  const plan = consolidar({ runId: 'r', inicio: 'x', fin: '2026-11-09T11:00:00Z', trigger: 'dry_run', proyectos: [p], incidentes: [abierta], trabajo: [], porProyecto: [{ projectId: 'facturacion', hallazgos: hall, senales }] });
  const w = plan.writes.find((x) => x.doc_id === 'inc-a');
  assert.deepEqual([w.data.deploy.previous, w.data.deploy.version], ['1.3.2', '1.4.0']);
  assert.ok(plan.analizar.includes('inc-a'));
});

test('consolidación: procesos nuevos de la carpeta se suman solos; re-análisis pedido por un humano', () => {
  const { senales } = senalesDeFixture();
  const p = { ...proyecto(), processes: proyecto().processes.slice(0, 1) };
  const hall = evaluar({ senales, proyecto: p });
  const inc = { id: 'inc-r', __version: 2, projectId: 'facturacion', status: 'open', decision: 'escalate', fingerprints: ['q'], analysis: { status: 'done' } };
  const plan = consolidar({ runId: 'r', inicio: 'x', fin: '2026-11-09T11:00:00Z', trigger: 'dry_run', proyectos: [p], incidentes: [inc], trabajo: [], porProyecto: [{ projectId: 'facturacion', hallazgos: hall, senales }], reanalizar: ['inc-r'] });
  const wp = plan.writes.find((x) => x.collection === 'projects');
  assert.ok(wp.data.processes.some((x) => x.orchestratorProcess === 'FIN_Facturacion_Performer'));
  assert.ok(plan.analizar.includes('inc-r'));
  assert.deepEqual(prepararLotes(plan.writes.filter((w) => w.collection !== 'incidents')).errores, []);
});

// ---------- excepciones de una regla ("está bien, pero no aplica cuando…") ----------
const TZ = { timezone: 'America/Argentina/Buenos_Aires' }; // UTC-3

test('excepciones: los registros exceptuados no cuentan para la regla', () => {
  const s = { ventana: { desde: '2026-01-01T00:00:00Z', hasta: '2026-01-01T01:00:00Z' }, jobs: [], queueItems: [], logs: [
    ...Array.from({ length: 8 }, (_, i) => ({ nivel: 'Error', mensaje: 'login failed', proceso: 'VD_Performer', fecha: `2026-01-01T00:${String(i).padStart(2, '0')}:00Z` })),
    ...Array.from({ length: 6 }, (_, i) => ({ nivel: 'Error', mensaje: 'login failed', proceso: 'VD_Reporter', fecha: `2026-01-01T00:${20 + i}:00Z` })),
  ] };
  const compiled = { signal: 'logs', filter: { messageRegex: 'login' }, aggregate: 'count', threshold: 10, comparator: '>' };
  assert.equal(evaluarRegla({ compiled }, s).resultado, 'alerta', 'sin excepción: 14 > 10');
  const r = evaluarRegla({ compiled: { ...compiled, exceptions: [{ text: 'no aplica al Reporter', filter: { process: 'VD_Reporter' } }] } }, s);
  assert.equal(r.observado, 8);
  assert.equal(r.exceptuados, 6);
  assert.equal(r.resultado, 'ok');
  // Una excepción sin filtro quedó en lenguaje natural: la aplica el triage, no descarta registros.
  assert.equal(evaluarRegla({ compiled: { ...compiled, exceptions: [{ text: 'salvo cierre de mes', mode: 'llm' }, { text: 'vacía', filter: {} }] } }, s).resultado, 'alerta');
});

test('excepciones: condición de día y hora en la zona horaria de los ajustes', () => {
  // 2026-11-09 es lunes. 11:30Z = 08:30 en Buenos Aires; 13:30Z = 10:30.
  const log = (t) => ({ nivel: 'Error', mensaje: 'SAP no responde', fecha: t });
  const s = { ventana: { desde: '2026-11-09T11:00:00Z', hasta: '2026-11-09T14:00:00Z' }, jobs: [], queueItems: [],
    logs: [log('2026-11-09T11:10:00Z'), log('2026-11-09T11:30:00Z'), log('2026-11-09T13:30:00Z')] };
  const compiled = { signal: 'logs', filter: { messageRegex: 'SAP' }, aggregate: 'count', threshold: 2, comparator: '>=',
    exceptions: [{ text: 'los lunes antes de las 9 hay mantenimiento de SAP', filter: { days: ['mon'], hourTo: 9 } }] };
  const r = evaluarRegla({ compiled }, s, {}, TZ);
  assert.equal(r.observado, 1, 'solo cuenta el de las 10:30');
  assert.equal(r.resultado, 'ok');
  assert.equal(evaluarRegla({ compiled: { ...compiled, exceptions: [{ filter: { days: ['tue'], hourTo: 9 } }] } }, s, {}, TZ).resultado, 'alerta', 'la excepción es de otro día');
  assert.equal(enHorario('2026-11-10T02:30:00Z', { hourFrom: 22, hourTo: 6 }, TZ.timezone), true, '23:30 local: rango que cruza la medianoche');
  assert.equal(enHorario('2026-11-09T15:00:00Z', { hourFrom: 22, hourTo: 6 }, TZ.timezone), false);
});

test('excepciones: "no corrió en N horas" no alerta mientras rige la excepción', () => {
  // 2026-11-08 es domingo.
  const s = { ventana: { desde: '2026-11-08T19:00:00Z', hasta: '2026-11-08T20:00:00Z' }, jobs: [], queueItems: [], logs: [] };
  const compiled = { signal: 'jobs', aggregate: 'absence', filter: { process: 'VD_Dispatcher' }, windowMinutes: 540 };
  const p = { watermarks: { lastJobByProcess: { VD_Dispatcher: '2026-11-07T08:00:00Z' } } };
  assert.equal(evaluarRegla({ compiled }, s, p, TZ).resultado, 'alerta');
  const r = evaluarRegla({ compiled: { ...compiled, exceptions: [{ text: 'los fines de semana no corre', filter: { days: ['sat', 'sun'] } }] } }, s, p, TZ);
  assert.equal(r.resultado, 'omitido');
  assert.match(r.motivo, /fines de semana/);
});

test('excepciones: una regla "known" deja de tapar el hallazgo que cae en su excepción', () => {
  const { senales } = senalesDeFixture();
  const known = (exceptions) => ({ id: 'k1', projectId: 'facturacion', status: 'active', text: 'Abandonados de FIN_FAC_Facturas son normales',
    compiled: { action: 'known', filter: { queue: 'FIN_FAC_Facturas', messageRegex: 'abandonados' }, exceptions } });
  const abandonados = (reglas) => evaluar({ senales, proyecto: proyecto(), reglas, ajustes: TZ }).hallazgos.find((h) => h.checkId === 'queue_abandoned');
  const dia = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][new Date(Date.parse(abandonados([]).ultima) - 3 * 3600000).getUTCDay()];
  assert.equal(abandonados([known([{ filter: { days: [dia] } }])]).conocidoPor, undefined, 'la excepción aplica: se reporta');
  assert.equal(abandonados([known([{ filter: { days: [dia === 'mon' ? 'tue' : 'mon'] } }])]).conocidoPor, 'k1', 'otro día: sigue siendo conocido');
});

// ---------- propuestas de reglas: similitud entre procesos y revisión diaria ----------
import { sugerir, mapaDeSistemas } from '../scripts/sugerir-reglas.mjs';
import { sistemasEnTexto } from '../scripts/lib/paquetes.mjs';

test('sistemas: portales y aplicaciones del código, sin esquemas XML, navegadores ni credenciales', () => {
  const xaml = `<Activity xmlns="http://schemas.microsoft.com/netfx/2009/xaml/activities" xmlns:ui="http://schemas.uipath.com/workflow/activities">
    <ui:OpenBrowser Url="https://www.portal-eps.com.co/login?user=x" /> <ui:Click Selector="&lt;wnd app='saplogon.exe' /&gt;" />
    <ui:Click Selector="&lt;html app=&apos;chrome.exe&apos; url='https://otro.portal.gov/x' /&gt;" /> https://usuario:clave@privado.com/x</Activity>`;
  assert.deepEqual(sistemasEnTexto(xaml), ['app:saplogon.exe', 'web:otro.portal.gov', 'web:portal-eps.com.co']);
});

const AHORA = '2026-11-10T12:00:00Z';
const hace = (d) => new Date(Date.parse(AHORA) - d * 86400000).toISOString();
const proy = (id, procesos) => ({ id, name: id, status: 'active', inventory: { processes: procesos.map(([name, systems, libs = []]) => ({ name, systems, libraries: libs.map((l) => ({ name: l, version: '1.0.0' })) })) } });
const PROYS = [
  proy('derechos', [['VD_Performer', ['web:portal-eps.com'], ['LIB_Comun']], ['VD_Reporter', [], ['LIB_Comun']]]),
  proy('autorizaciones', [['AUT_Performer', ['web:portal-eps.com'], ['LIB_Comun']]]),
  proy('nomina', [['NOM_Performer', ['app:saplogon.exe'], ['LIB_Comun']]]),
];
const reglaPortal = { id: 'derechos-portal', projectId: 'derechos', status: 'active', origin: 'manual', text: 'Más de 5 errores de login al portal, escalar', approvedAt: hace(0.1),
  compiled: { signal: 'logs', filter: { process: 'VD_Performer', messageRegex: 'login' }, aggregate: 'count', threshold: 5, severity: 'P2', action: 'escalate' } };

test('propuestas por similitud: la regla se ofrece al proceso que usa el mismo portal, una sola vez', () => {
  assert.deepEqual(mapaDeSistemas(PROYS).procesos.find((x) => x.name === 'VD_Reporter').claves, [], 'la librería que usan todos no cuenta');
  const base = { proyectos: PROYS, incidentes: [], trabajo: [], ahora: AHORA };
  const r = sugerir({ ...base, reglas: [reglaPortal], salud: { rulesReview: { similarityAt: hace(1), dailyAt: AHORA } } });
  assert.equal(r.diario, false);
  assert.deepEqual(r.candidatos.map((c) => [c.tipo, c.projectId, c.process]), [['similar', 'autorizaciones', 'AUT_Performer']]);
  assert.equal(r.candidatos[0].comparten[0].sistema, 'web:portal-eps.com');
  assert.equal(r.plan.writes.find((w) => w.doc_id === 'health').data.rulesReview.similarityAt, AHORA);
  // Ya propuesta (aunque la hayan rechazado), ya revisada, o descartada por la rutina: no se repite.
  const key = r.candidatos[0].key;
  assert.equal(sugerir({ ...base, reglas: [reglaPortal, { id: 'x', projectId: 'autorizaciones', status: 'rejected', proposalKey: key }], salud: { rulesReview: { dailyAt: AHORA } } }).candidatos.length, 0);
  assert.equal(sugerir({ ...base, reglas: [reglaPortal], salud: { rulesReview: { similarityAt: AHORA, dailyAt: AHORA } } }).candidatos.length, 0);
  assert.equal(sugerir({ ...base, reglas: [reglaPortal], salud: { rulesReview: { dailyAt: AHORA, descartados: { [key]: hace(5) } } } }).candidatos.length, 0);
});

test('revisión diaria: regla ruidosa, severidad que sobra, regla sin uso y tema repetido sin regla', () => {
  const inc = (id, extra) => ({ id, projectId: 'derechos', status: 'open', category: 'login', process: 'VD_Performer', lastSeenAt: hace(2), decision: 'escalate', triage: { matchedRules: [] }, ...extra });
  const r1 = { ...reglaPortal, approvedAt: hace(100) };
  const r2 = { id: 'derechos-cola', projectId: 'derechos', status: 'active', text: 'Más de 3 abandonados, avisar', createdAt: hace(100), compiled: { severity: 'P2', action: 'alert' } };
  const r3 = { id: 'derechos-vieja', projectId: 'derechos', status: 'active', text: 'Regla que nunca dispara', createdAt: hace(100), compiled: { severity: 'P3' }, __version: 4 };
  const incidentes = [
    inc('a1', { triage: { matchedRules: ['derechos-portal'] } }), inc('a2', { triage: { matchedRules: ['derechos-portal'] } }), inc('a3', { evidence: { ultima: { regla: { id: 'derechos-portal' } } } }),
    inc('b1', { triage: { matchedRules: ['derechos-cola'] } }), inc('b2', { triage: { matchedRules: ['derechos-cola'] } }),
    inc('c1', { category: 'selector', reopenCount: 1 }),
    inc('d1', { category: 'data', decision: 'notify', recurrences: Array.from({ length: 6 }, (_, n) => ({ at: hace(n + 1) })) }),
  ];
  const trabajo = [
    { id: 'a1', state: 'dismissed', dismissReason: 'false_positive' }, { id: 'a2', state: 'responded', response: { decision: 'expected_behavior' } },
    { id: 'b1', state: 'snoozed' }, { id: 'b2', state: 'snoozed' }, { id: 'c1', state: 'dismissed', dismissReason: 'expected' },
  ];
  const salud = { rulesReview: { similarityAt: AHORA, dailyAt: hace(1), trackingSince: hace(90) } };
  const r = sugerir({ proyectos: PROYS, reglas: [r1, r2, r3], incidentes, trabajo, salud, ahora: AHORA });
  assert.equal(r.diario, true);
  // Tope de 3 por proyecto, por prioridad: quedan afuera el tema recurrente y la regla sin uso.
  assert.deepEqual(r.candidatos.map((c) => c.tipo), ['ruidosa', 'severidad', 'descartado_repetido']);
  assert.equal(r.recortadosPorTope, 2);
  assert.equal(r.candidatos[1].value, 'P3');
  assert.ok(r.plan.writes.some((w) => w.collection === 'rules' && w.doc_id === 'derechos-portal' && w.data.lastTriggeredAt === hace(2)));
  // Con un cambio sugerido sin resolver o rechazado hace poco, no se insiste; con menos pendientes entra el resto.
  const r1b = { ...r1, suggestion: { kind: 'exception', why: 'x', key: 'sug:derechos-portal:ruidosa' } };
  const r2b = { ...r2, dismissedSuggestions: [{ kind: 'severity', at: hace(10) }] };
  const otra = sugerir({ proyectos: PROYS, reglas: [r1b, r2b, r3], incidentes, trabajo, salud, ahora: AHORA });
  assert.deepEqual(otra.candidatos.map((c) => c.tipo), ['descartado_repetido', 'recurrente_sin_regla', 'sin_uso']);
  // Sin 60 días de seguimiento todavía no se propone retirar nada.
  const nuevo = sugerir({ proyectos: PROYS, reglas: [r3], incidentes: [], trabajo: [], salud: { rulesReview: { similarityAt: AHORA } }, ahora: AHORA });
  assert.equal(nuevo.candidatos.length, 0);
  assert.equal(nuevo.plan.writes.find((w) => w.doc_id === 'health').data.rulesReview.trackingSince, AHORA);
  assert.deepEqual(prepararLotes(r.plan.writes).errores, []);
});

test('índice de código: cada proceso trae los sistemas de su paquete y de sus librerías', async () => {
  const { indexar } = await import('../scripts/indexar-codigo.mjs');
  process.env.OPS_FIXTURES = join(FIX, 'uip');
  const { senales } = senalesDeFixture();
  const r = indexar({ procesos: senales.procesos, todo: true });
  delete process.env.OPS_FIXTURES;
  assert.ok(r.procesos.length && r.procesos.every((p) => Array.isArray(p.systems)));
});

// ---------- carpeta a escanear, aprobación automática, discrepancias y documentos ----------
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { listaDeCarpetas, raizDe, dentroDe } from '../scripts/lib/carpetas.mjs';
import { aprobarAutomatico } from '../scripts/aprobar-reglas.mjs';
import { consolidarDiscrepancias, idDiscrepancia, claveDiscrepancia } from '../scripts/consolidar-discrepancias.mjs';
import { pendientesDiscrepancias } from '../scripts/pendientes-aprendizaje.mjs';

test('carpetas a escanear: rutas limpias y pertenencia a una raíz', () => {
  assert.deepEqual(listaDeCarpetas(' /Produccion/ , Clientes\\Produccion\nproduccion'), ['Produccion', 'Clientes/Produccion'], 'sin barras sobrantes ni repetidos');
  assert.equal(raizDe('Produccion/Finanzas/Pagos', ['Produccion', 'Produccion/Finanzas']), 'Produccion/Finanzas', 'la raíz más específica');
  assert.equal(raizDe('produccion', ['Produccion']), 'Produccion', 'la raíz misma, sin distinguir mayúsculas');
  assert.equal(raizDe('ProduccionVieja/X', ['Produccion']), null, 'un prefijo de nombre no es una subcarpeta');
  assert.ok(dentroDe('Cualquiera', []), 'sin raíces no hay filtro');
});

test('descubrimiento: con una carpeta raíz solo se propone lo que está adentro, y nunca lo ignorado', () => {
  const dir = mkdtempSync(join(tmpdir(), 'raiz-'));
  const correrDesc = (extra) => {
    execFileSync('node', [join(RAIZ, 'scripts/descubrir.mjs'), '--salida', join(dir, 'c.json'), '--plan-tablero', join(dir, 'p.json'), '--sin-bitbucket', ...extra], { env: { ...process.env, OPS_FIXTURES: join(FIX, 'uip') } });
    return { c: JSON.parse(readFileSync(join(dir, 'c.json'), 'utf8')), tablero: JSON.parse(readFileSync(join(dir, 'p.json'), 'utf8')).writes[0].data };
  };
  // Raíz "Produccion": las dos carpetas con procesos son propuestas (acá no hay proyectos registrados).
  let r = correrDesc(['--raices', 'Produccion']);
  assert.deepEqual(r.tablero.folders.map((f) => f.folderPath).sort(), ['Produccion/Finanzas', 'Produccion/Otro']);
  assert.deepEqual(r.tablero.roots, ['Produccion']);
  assert.ok(r.tablero.folders.every((f) => f.root === 'Produccion'));
  assert.equal(r.tablero.note, undefined, 'sin avisos cuando el listado funciona');
  assert.deepEqual(prepararLotes([{ op: 'set', collection: 'config', doc_id: 'discovery', data: r.tablero }]).errores, []);
  // Raíz más acotada: lo que queda afuera se marca y no se propone ni se registra solo.
  r = correrDesc(['--raices', 'Produccion/Otro']);
  assert.deepEqual(r.tablero.folders.map((f) => f.folderPath), ['Produccion/Otro']);
  assert.ok(r.c.candidatos.every((x) => x.folderPath !== 'Produccion/Finanzas'), 'ni siquiera se consulta lo que está fuera de la raíz');
  assert.equal(r.c.orchestrator.fuenteCarpetas.fueraDeLasRaices, 2);
  // Los ajustes del tablero mandan: carpeta raíz e ignoradas. Un proyecto registrado fuera de la raíz se sigue reconociendo.
  writeFileSync(join(dir, 'settings.json'), JSON.stringify({ id: 'settings', version: 3, data: { triageCriteria: '', retention: {}, discovery: { rootFolders: ['Produccion/Otro'], ignoredFolders: ['produccion/otro/'] } } }));
  r = correrDesc(['--ajustes', join(dir, 'settings.json'), '--registrados', join(FIX, 'db/projects')]);
  const otro = r.c.candidatos.find((x) => x.folderPath === 'Produccion/Otro');
  assert.ok(otro.ignorada, 'la carpeta ignorada se marca aunque cambie la forma de escribirla');
  assert.equal(r.c.candidatos.find((x) => x.folderPath === 'Produccion/Finanzas').registradoComo, 'facturacion');
  assert.deepEqual(r.tablero.folders.map((f) => f.folderPath), ['Produccion/Otro'], 'el tablero recibe la ignorada: la oculta con su propia lista');
  const plan = planDescubrimiento(r.c, { ahora: '2026-11-10T12:00:00Z' });
  assert.deepEqual(plan.creados, [], 'una carpeta ignorada no se registra sola');
  assert.ok(plan.omitidos.some((o) => /ignorada/.test(o.motivo)));
  // Una raíz donde no hay nada: el tablero recibe un aviso que dice qué revisar.
  r = correrDesc(['--raices', 'NoExiste']);
  assert.deepEqual(r.tablero.folders, []);
  assert.match(r.tablero.note, /No se encontraron procesos dentro de NoExiste/);
});

test('aprobación automática: solo con el interruptor activo, solo propuestas, con rastro en la memoria', () => {
  const reglas = [
    { id: 'p-1', __version: 4, projectId: 'p', text: 'a', status: 'proposed', origin: 'learned', compiled: { severity: 'P2' } },
    { id: 'p-2', projectId: 'p', text: 'b', status: 'proposed', origin: 'similar' },
    { id: 'p-3', projectId: 'p', text: 'c', status: 'rejected', origin: 'review', compiled: {} },
    { id: 'p-4', projectId: 'p', text: 'd', status: 'active', origin: 'manual', compiled: {}, suggestion: { kind: 'severity', value: 'P4', why: 'x' } },
  ];
  for (const ajustes of [null, {}, { autoApproveRules: false }, { autoApproveRules: 'true' }]) {
    const r = aprobarAutomatico({ reglas, ajustes, ahora: AHORA });
    assert.equal(r.activa, false); assert.deepEqual(r.writes, [], 'apagado por defecto: nada se activa solo');
  }
  const r = aprobarAutomatico({ reglas, ajustes: { autoApproveRules: true }, ahora: AHORA });
  assert.deepEqual(r.aprobadas, ['p-1', 'p-2'], 'ni las rechazadas ni las que tienen un cambio sugerido');
  const w1 = r.writes.find((w) => w.doc_id === 'p-1');
  assert.deepEqual(w1.data, { status: 'active', approvedBy: 'rutina', approvedAt: AHORA, autoApproved: true });
  assert.equal(w1.if_version, 4);
  assert.equal(r.writes.find((w) => w.doc_id === 'p-2').data.status, 'pending_compile', 'sin traducir: la compila esta corrida');
  const h = r.writes.find((w) => w.collection === 'history');
  assert.ok(h.data.projectId === 'p' && /se activaron 2 reglas/.test(h.data.summary));
  assert.equal(r.writes.length, 3);
  assert.deepEqual(prepararLotes(r.writes).errores, []);
});

test('discrepancias: una tarjeta por discrepancia entre análisis; las respuestas humanas mandan', () => {
  const T1 = '2026-11-01T10:00:00Z'; const T2 = '2026-11-08T10:00:00Z'; const T3 = '2026-11-15T10:00:00Z';
  const encontradas = [
    { key: 'Orchestrator: cola: RRHH_NOV Items', kind: 'orchestrator', title: 'La cola RRHH_NOV_Items del SDD no existe en Orchestrator', detail: 'El SDD la lista en Handover.', suggestion: 'Crear la cola o corregir el SDD.', processId: 'performer', refs: [{ source: 'SDD.docx · Handover', note: 'Work Queues' }, { note: 'sin fuente: se descarta' }] },
    { key: 'trigger:nov_diario', kind: 'trigger', title: 'El trigger corre a las 8 y el SDD dice a las 6' },
    { key: 'hygiene:nov_performer', kind: 'inventado', title: 'El paquete publica capturas' },
  ];
  assert.equal(claveDiscrepancia('Orchestrator: cola: RRHH_NOV Items'), claveDiscrepancia('orchestrator:cola:rrhh-nov-items'), 'la clave no depende de mayúsculas ni separadores');
  const id = (k) => idDiscrepancia('nomina', k);
  // Primer análisis: todas nuevas y abiertas.
  let r = consolidarDiscrepancias({ projectId: 'nomina', encontradas, ahora: T1 });
  assert.deepEqual(r.resumen, { nuevas: 3, actualizadas: 0, reabiertas: 0, resueltas: 0, sinCambios: 0 });
  assert.ok(r.writes.every((w) => w.op === 'set' && w.collection === 'discrepancies' && w.data.status === 'open' && w.data.seenCount === 1));
  const cola = r.writes.find((w) => w.doc_id === id('orchestrator:cola:rrhh_nov_items'));
  assert.deepEqual(cola.data.refs, [{ source: 'SDD.docx · Handover', note: 'Work Queues' }]);
  assert.equal(r.writes.find((w) => w.doc_id === id('hygiene:nov_performer')).data.kind, 'other', 'un tipo desconocido no rompe el esquema');
  assert.deepEqual(prepararLotes(r.writes).errores, []);
  const comoDocs = (writes, previos = []) => { const m = new Map(previos.map((d) => [d.id, d])); for (const w of writes) m.set(w.doc_id, { ...(m.get(w.doc_id) || {}), id: w.doc_id, __version: 2, ...w.data }); return [...m.values()]; };
  let docs = comoDocs(r.writes);
  docs.push({ id: 'disc-otro-x', projectId: 'otro', key: 'x', kind: 'docs', title: 'De otro proyecto', status: 'open' });
  // Segundo análisis: el trigger ya no se detecta; la cola sigue y está descartada por una persona; las capturas, con fix pendiente.
  const trabajo = [
    { id: id('orchestrator:cola:rrhh_nov_items'), state: 'dismissed', dismissReason: 'expected', updatedAt: '2026-11-02T09:00:00Z' },
    { id: id('hygiene:nov_performer'), state: 'responded', response: { decision: 'fix_code' }, updatedAt: '2026-11-02T09:00:00Z' },
  ];
  r = consolidarDiscrepancias({ projectId: 'nomina', encontradas: [encontradas[0], encontradas[2]], existentes: docs, trabajo, ahora: T2 });
  assert.deepEqual(r.resumen, { nuevas: 0, actualizadas: 2, reabiertas: 0, resueltas: 1, sinCambios: 0 });
  const trig = r.writes.find((w) => w.doc_id === id('trigger:nov_diario'));
  assert.deepEqual(trig.data, { status: 'resolved', resolvedAt: T2, resolvedReason: 'Ya no se detecta en el análisis del proyecto.' });
  assert.equal(trig.if_version, 2);
  assert.equal(r.writes.find((w) => w.doc_id === id('orchestrator:cola:rrhh_nov_items')).data.seenCount, 2);
  assert.ok(!r.writes.some((w) => w.doc_id === 'disc-otro-x'), 'no toca las discrepancias de otros proyectos');
  assert.deepEqual(prepararLotes(r.writes).errores, []);
  docs = comoDocs(r.writes, docs);
  // Tercer análisis: no se detecta nada. Lo abierto se cierra; lo ya resuelto queda como está.
  r = consolidarDiscrepancias({ projectId: 'nomina', encontradas: [], existentes: docs, trabajo, ahora: T2 });
  assert.deepEqual(r.resumen, { nuevas: 0, actualizadas: 0, reabiertas: 0, resueltas: 2, sinCambios: 1 });
  docs = comoDocs(r.writes, docs);
  // Cuarto análisis: vuelven las tres. La descartada por una persona no reaparece como pendiente; las otras dos sí.
  r = consolidarDiscrepancias({ projectId: 'nomina', encontradas, existentes: docs, trabajo, ahora: T3 });
  assert.deepEqual(r.resumen, { nuevas: 0, actualizadas: 1, reabiertas: 2, resueltas: 0, sinCambios: 0 });
  const descartada = r.writes.find((w) => w.doc_id === id('orchestrator:cola:rrhh_nov_items')).data;
  assert.ok(descartada.status === 'open' && descartada.reopenedAt === undefined, 'se sigue detectando, pero la respuesta humana se respeta');
  const conFix = r.writes.find((w) => w.doc_id === id('hygiene:nov_performer')).data;
  assert.ok(conFix.status === 'open' && conFix.reopenedAt === T3 && conFix.reopenCount === 1, 'el fix informado no alcanzó: reaparece');
  // Una lista mal formada no escribe nada a medias.
  assert.ok(consolidarDiscrepancias({ projectId: 'nomina', encontradas: [{ title: 'sin clave' }], ahora: T1 }).errores.length);
});

test('aprendizaje: respuestas a discrepancias pendientes de anotar en la memoria', () => {
  const discs = [
    { id: 'd1', projectId: 'p', title: 'A', kind: 'docs', status: 'open' },
    { id: 'd2', projectId: 'p', title: 'B', kind: 'trigger', status: 'open', learning: { workUpdatedAt: '2026-11-05T00:00:00Z' } },
    { id: 'd3', projectId: 'p', title: 'C', kind: 'queue', status: 'open' },
    { id: 'd4', projectId: 'p', title: 'D', kind: 'code', status: 'open' },
  ];
  const trabajo = [
    { id: 'd1', state: 'responded', response: { decision: 'fix_docs', ticket: 'DOC-1' }, updatedAt: '2026-11-06T00:00:00Z', updatedBy: 'u_1' },
    { id: 'd2', state: 'dismissed', dismissReason: 'expected', updatedAt: '2026-11-04T00:00:00Z' }, // ya procesada
    { id: 'd3', state: 'snoozed', snoozeUntil: '2026-12-01T00:00:00Z', updatedAt: '2026-11-06T00:00:00Z' }, // posponer no enseña nada
    { id: 'd4', state: 'responded', response: { decision: 'expected' }, updatedAt: '2026-11-06T00:00:00Z' },
    { id: 'huerfana', state: 'dismissed', updatedAt: '2026-11-06T00:00:00Z' },
  ];
  const r = pendientesDiscrepancias(discs, trabajo);
  assert.deepEqual(r.map((x) => [x.discrepancyId, x.cierra]), [['d1', false], ['d4', true]]);
  assert.equal(r[0].response.ticket, 'DOC-1');
});

test('esquemas: documentos en Markdown, lado humano de una discrepancia, ajustes y pedido de escaneo', () => {
  const ok = (collection, doc_id, data) => assert.deepEqual(prepararLotes([{ op: 'set', collection, doc_id, data }]).errores, [], `${collection}/${doc_id}`);
  const mal = (collection, doc_id, data, re) => assert.ok(prepararLotes([{ op: 'set', collection, doc_id, data }]).errores.some((e) => re.test(e)), `${collection}/${doc_id} debería fallar`);
  ok('documents', 'p_sdd', { projectId: 'p', kind: 'sdd', markdown: '# SDD\n\n| Cola | Uso |\n| --- | --- |\n| C1 | Entrada |', fileName: 'SDD.docx', source: 'docx', chars: 40, masked: 0, uploadedBy: 'u_1', uploadedAt: AHORA });
  ok('documents', 'p_abc123', { projectId: 'p', kind: 'other', title: 'Acuerdo de servicio', markdown: 'Texto', fileName: 'SLA.pdf', source: 'pdf' });
  mal('documents', 'p_otro', { projectId: 'p', kind: 'manual', markdown: 'x' }, /fuera de/);
  mal('documents', 'p_pdd', { projectId: 'p', kind: 'pdd', markdown: 'Contacto: persona@cliente.com' }, /PII/);
  ok('discrepancyWork', 'd1', { projectId: 'p', state: 'responded', response: { decision: 'fix_orchestrator', notes: 'Se crea la cola', ticket: 'OPS-9' }, updatedAt: AHORA, updatedBy: 'u_1' });
  mal('discrepancyWork', 'd1', { state: 'delegated' }, /fuera de/);
  ok('config', 'settings', { ...JSON.parse(readFileSync(join(RAIZ, 'seed/settings.json'), 'utf8')), autoApproveRules: true, discovery: { rootFolders: ['Produccion'], ignoredFolders: ['Produccion/Pruebas'] } });
  mal('config', 'settings', { triageCriteria: '', retention: {}, autoApproveRules: 'si' }, /boolean/);
  ok('requests', 'r1', { type: 'discover_projects', roots: ['Produccion'], requestedBy: 'u_1', requestedAt: AHORA, status: 'pending' });
  ok('history', 'h1', { projectId: 'p', type: 'discrepancy', at: AHORA, summary: 'Discrepancia respondida: se corrige el SDD.', discrepancyId: 'd1', by: 'u_1' });
});

test('tablero: los patrones que enmascaran un documento subido son los de config/patrones-pii.json', () => {
  const html = readFileSync(join(RAIZ, 'dashboard/index.html'), 'utf8');
  const enTablero = JSON.parse(html.match(/const PII_DOC = (.*?);\n/)[1]);
  const config = JSON.parse(readFileSync(join(RAIZ, 'config/patrones-pii.json'), 'utf8')).patrones;
  assert.deepEqual(enTablero.map((p) => p.nombre), ['documento_etiquetado', 'nit', 'email', 'cuit_cuil', 'ruta_usuario']);
  for (const p of enTablero) assert.deepEqual(p, config.find((x) => x.nombre === p.nombre), `el patrón ${p.nombre} del tablero se desvió de la configuración`);
});

import { aprobarEnPlan } from '../scripts/aprobar-reglas.mjs';
import { buscarAjustes } from '../scripts/build-writes.mjs';

test('aprobación automática inmediata: build-writes activa las reglas que un plan propone', () => {
  const plan = () => [
    { op: 'set', collection: 'rules', doc_id: 'p-a', data: { projectId: 'p', text: 'a', status: 'proposed', origin: 'learned', compiled: { severity: 'P2' } } },
    { op: 'set', collection: 'rules', doc_id: 'p-b', data: { projectId: 'p', text: 'b', status: 'proposed', origin: 'review' } },
    { op: 'update', collection: 'rules', doc_id: 'p-c', data: { suggestion: { kind: 'retire', why: 'x' } } },
    { op: 'set', collection: 'rules', doc_id: 'p-d', data: { projectId: 'p', text: 'd', status: 'pending_compile', origin: 'manual' } },
  ];
  let w = plan();
  assert.deepEqual(aprobarEnPlan(w, { autoApproveRules: false }, AHORA), []);
  assert.equal(w[0].data.status, 'proposed', 'apagado: nada cambia');
  assert.deepEqual(aprobarEnPlan(w, { autoApproveRules: true }, AHORA), ['p-a', 'p-b']);
  assert.deepEqual(w[0].data, { projectId: 'p', text: 'a', status: 'active', origin: 'learned', compiled: { severity: 'P2' }, approvedBy: 'rutina', approvedAt: AHORA, autoApproved: true });
  assert.equal(w[1].data.status, 'pending_compile');
  assert.equal(w[2].data.status, undefined, 'un cambio sugerido no se aplica solo');
  assert.equal(w[3].data.autoApproved, undefined);
  // Por línea de comandos: los ajustes se encuentran solos desde la carpeta del plan.
  const dir = mkdtempSync(join(tmpdir(), 'auto-'));
  mkdirSync(join(dir, 'db/config'), { recursive: true }); mkdirSync(join(dir, 'alta/p'), { recursive: true });
  writeFileSync(join(dir, 'db/config/settings.json'), JSON.stringify({ triageCriteria: '', retention: {}, autoApproveRules: true }));
  writeFileSync(join(dir, 'alta/p/plan.json'), JSON.stringify({ writes: plan() }));
  assert.equal(buscarAjustes(join(dir, 'alta/p/plan.json')), join(dir, 'db/config/settings.json'));
  const out = JSON.parse(execFileSync('node', [join(RAIZ, 'scripts/build-writes.mjs'), '--plan', join(dir, 'alta/p/plan.json'), '--salida', join(dir, 'lotes')], { encoding: 'utf8' }));
  assert.deepEqual(out.reglasAprobadasAutomaticamente, ['p-a', 'p-b']);
  assert.equal(JSON.parse(readFileSync(join(dir, 'lotes/docs/rules__p-a.json'), 'utf8')).status, 'active');
});

test('documentos del paquete: los que un Admin desactivó no se extraen', () => conFixtures(() => {
  const dir = mkdtempSync(join(tmpdir(), 'docs-'));
  const base = JSON.parse(readFileSync(join(FIX, 'db/projects/facturacion.json'), 'utf8'));
  const correrFetch = (disabledDocs) => {
    writeFileSync(join(dir, 'p.json'), JSON.stringify({ ...base, data: { ...base.data, disabledDocs } }));
    return JSON.parse(execFileSync('node', [join(RAIZ, 'scripts/fetch-codigo.mjs'), '--proyecto', join(dir, 'p.json'), '--proceso', 'FIN_Facturacion_Performer', '--destino', join(dir, 'c')], { encoding: 'utf8', env: process.env }));
  };
  const todo = correrFetch([]);
  assert.ok(todo.docs.length >= 1, 'el paquete de ejemplo trae documentación');
  const doc = todo.docs[0];
  const r = correrFetch([`FIN_Facturacion_Performer:${doc}`, 'OtroProceso:' + doc]);
  assert.ok(!r.docs.includes(doc));
  assert.deepEqual(r.docsDesactivados, [doc]);
  assert.ok(!existsSync(join(dir, 'c/proceso', doc)), 'el archivo no queda en disco');
  assert.equal(r.archivos, todo.archivos - 1);
}));
