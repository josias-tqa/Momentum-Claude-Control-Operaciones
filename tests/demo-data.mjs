// Datos de demostración SINTÉTICOS para probar el tablero (no son datos de ningún cliente).
// Se generan corriendo los scripts reales sobre fixtures/tenant-ejemplo, más algunos documentos extra.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { evaluar } from '../scripts/evaluate.mjs';
import { consolidar } from '../scripts/consolidar.mjs';

const RAIZ = new URL('..', import.meta.url).pathname;
const FIX = join(RAIZ, 'fixtures', 'tenant-ejemplo');

export function demoSeed({ vacio = false } = {}) {
  if (vacio) return {};
  const ahora = new Date();
  const iso = (minAtras) => new Date(ahora - minAtras * 60000).toISOString();
  const dir = mkdtempSync(join(tmpdir(), 'demo-'));
  execFileSync('node', [join(RAIZ, 'scripts/collect.mjs'), '--proyecto', join(FIX, 'db/projects/facturacion.json'), '--desde', '2026-11-09T10:00:00Z', '--hasta', '2026-11-09T11:00:00Z', '--salida', join(dir, 's.json')], { env: { ...process.env, OPS_FIXTURES: join(FIX, 'uip') } });
  const senales = JSON.parse(readFileSync(join(dir, 's.json'), 'utf8'));
  const pd = JSON.parse(readFileSync(join(FIX, 'db/projects/facturacion.json'), 'utf8'));
  const proyecto = { id: pd.id, __version: 1, ...pd.data };
  const rd = JSON.parse(readFileSync(join(FIX, 'db/rules/regla-login.json'), 'utf8'));
  const hall = evaluar({ senales, proyecto, reglas: [{ id: rd.id, ...rd.data }] });
  const runId = 'run-demo-1';
  const plan = consolidar({ runId, inicio: iso(14), fin: iso(12), trigger: 'scheduled', proyectos: [proyecto], incidentes: [], trabajo: [], porProyecto: [{ projectId: proyecto.id, hallazgos: hall, senales }] });
  const seed = {};
  for (const w of plan.writes) {
    const p = `${w.collection}/${w.doc_id}`;
    seed[p] = w.op === 'update' ? { ...(seed[p] || proyecto), ...w.data } : w.data;
  }
  delete seed['projects/facturacion'].__version; delete seed['projects/facturacion'].id;
  // Fechas relativas a "ahora" para que la demo se vea viva.
  for (const [k, v] of Object.entries(seed)) if (k.startsWith('incidents/')) { v.lastSeenAt = iso(12); v.firstSeenAt = iso(70); }
  const login = Object.entries(seed).find(([k, v]) => k.startsWith('incidents/') && v.category === 'login');
  login[1].occurrences = 7; login[1].recurrences = [{ runId: 'run-demo-0', at: iso(72), count: 3 }, { runId, at: iso(12), count: 4 }];
  login[1].analysis = { status: 'done', summary: 'Desde hace 70 minutos el Performer falla al iniciar sesión en SAP en todos los jobs. El lote completo queda sin procesar.',
    hypotheses: [{ text: 'La credencial C_180_FIN_FAC_SapCredentials venció o fue bloqueada en SAP', likelihood: 'alta', evidence: '12 errores "invalid credentials" seguidos, en las 3 ejecuciones, desde la misma máquina.' }, { text: 'Cambio en la pantalla de login de SAP', likelihood: 'baja', evidence: 'No hay errores de selector; el mensaje viene de SAP.' }],
    codeRefs: [{ file: 'Framework/InitAllApplications.xaml', line: 42, sha: '9f3c2a1', note: 'Login a SAP con el asset de credenciales' }], docRefs: [{ file: 'docs/SDD.md', section: 'Exception Handling — AE001', note: 'Login fallido: reintentar 1 vez y escalar a soporte SAP' }],
    suggestedActions: ['Verificar en SAP si el usuario del robot está bloqueado o con contraseña vencida', 'Actualizar el asset de credenciales en Orchestrator si corresponde'], repo: { ref: 'main', sha: '9f3c2a1', matchesDeployedVersion: false } };
  const otros = Object.entries(seed).filter(([k, v]) => k.startsWith('incidents/') && v.category === 'selector');
  if (otros[0]) seed[`incidentWork/${otros[0][0].split('/')[1]}`] = { state: 'delegated', assignee: 'u_oper0000000000000000002', delegatedBy: 'u_admin000000000000000001', updatedAt: iso(30), updatedBy: 'u_admin000000000000000001' };
  seed['runs/' + runId] = { ...seed['runs/' + runId], startedAt: iso(14), finishedAt: iso(12) };
  seed['runs/run-demo-0'] = { startedAt: iso(74), finishedAt: iso(72), status: 'ok', trigger: 'scheduled', projects: [{ projectId: 'conciliacion', status: 'ok', checks: [], findings: [], incidentsNew: [], incidentsUpdated: [] }], summary: {} };
  seed['projects/conciliacion'] = { name: 'Conciliación bancaria', status: 'active', orchestrator: { folderPath: 'Produccion/Tesoreria' }, repo: { workspace: 'ejemplo', slug: 'conciliacion' }, health: { level: 'ok' } };
  seed['projects/nomina'] = { name: 'Novedades de nómina', status: 'review', statusNote: 'Alta completa: 2 procesos, 1 cola, 14 assets. Discrepancia: la cola RRHH_NOV_Items del SDD no existe en Orchestrator.', orchestrator: { folderPath: 'Produccion/RRHH' }, repo: { workspace: 'ejemplo', slug: 'nomina' } };
  seed['rules/facturacion-login'] = { projectId: 'facturacion', text: 'Si se ven más de 10 errores de login seguidos, alertar', status: 'active', origin: 'manual', compileNote: 'Cuenta errores Error/Fatal que mencionan login o credenciales; alerta si hay más de 10 seguidos.' };
  seed['rules/facturacion-abandonados'] = { projectId: 'facturacion', text: 'Los items abandonados de los lunes antes de las 9 son normales (mantenimiento de SAP)', status: 'proposed', origin: 'learned', sourceIncidentId: 'inc-x', compileNote: 'Marca como conocido los abandonados de FIN_FAC_Facturas los lunes antes de las 9:00.' };
  seed['memory/facturacion'] = { projectId: 'facturacion', process: '## Qué hace\nRegistra en SAP las facturas de proveedores que llegan por la cola **FIN_FAC_Facturas**.\n\n## Disparadores y horario\n- Dispatcher: cada hora (trigger de tiempo).\n- Performer: trigger de cola.\n\n## Sistemas\n- SAP GUI (login con `C_180_FIN_FAC_SapCredentials`).\n\n## Excepciones de negocio esperadas\n| ID | Descripción |\n|---|---|\n| BE001 | Factura duplicada |\n| BE002 | Proveedor inexistente |', productionSummary: '- Los lunes hay abandonados por el mantenimiento de SAP (ver history/h-2).', updatedAt: iso(600) };
  seed['history/h-1'] = { projectId: 'facturacion', type: 'onboarding', at: iso(9000), summary: 'Alta del proyecto: 2 procesos, 1 cola, 2 assets.', by: 'rutina' };
  seed['history/h-2'] = { projectId: 'facturacion', type: 'expected_behavior', at: iso(4000), summary: 'Items abandonados del lunes: mantenimiento programado de SAP. Es normal.', by: 'u_oper0000000000000000002' };
  seed['config/settings'] = JSON.parse(readFileSync(join(RAIZ, 'seed/settings.json'), 'utf8'));
  return seed;
}
