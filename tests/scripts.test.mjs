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
import { evaluar, evaluarRegla, categorizar } from '../scripts/evaluate.mjs';
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
