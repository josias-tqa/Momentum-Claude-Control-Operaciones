// Prueba del tablero en un navegador real con window.claude simulado y datos sintéticos.
// Ejecutar: node tests/dashboard.e2e.mjs [--capturas <dir>]
import { createRequire } from 'node:module';
import { readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { demoSeed } from './demo-data.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const RAIZ = new URL('..', import.meta.url).pathname;
const i = process.argv.indexOf('--capturas');
const CAPT = i > 0 ? process.argv[i + 1] : null;
if (CAPT) mkdirSync(CAPT, { recursive: true });

// Mismo esqueleto que agrega la publicación del artifact.
const html = `<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover"><style>:root{color-scheme:light}body{margin:0}img{max-width:100%}[hidden]{display:none!important}</style></head><body>${readFileSync(join(RAIZ, 'dashboard/index.html'), 'utf8')}</body></html>`;
const mock = readFileSync(join(RAIZ, 'tests/dashboard-mock.js'), 'utf8');

const browser = await chromium.launch();
const errores = [];
async function abrir({ role = 'admin', vacio = false, sinDb = false, viewport = { width: 1100, height: 900 }, oscuro = false } = {}) {
  const ctx = await browser.newContext({ viewport, colorScheme: oscuro ? 'dark' : 'light', deviceScaleFactor: CAPT ? 2 : 1 });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errores.push(`${role}: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/fonts\.g/.test(m.text())) errores.push(`${role} console: ${m.text()}`); });
  await page.addInitScript(({ seed, role, sinDb, mock }) => { window.__SEED__ = seed; window.__ROLE__ = role; window.__NODB__ = sinDb; eval(mock); }, { seed: demoSeed({ vacio }), role, sinDb, mock });
  // Se sirve desde una URL (no setContent) para que el script de inicio corra en el documento real.
  await page.route('https://tablero.test/**', (r) => r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html }));
  await page.goto('https://tablero.test/', { waitUntil: 'load' });
  await page.waitForTimeout(300);
  return { page, ctx };
}
const ok = [];
const paso = (n) => ok.push(n);
const visible = (page, sel) => page.waitForSelector(sel, { timeout: 3000 }).then(() => true, () => false);

// 1) Admin: bandeja de acción ordenada, "Para revisar", sin duplicados por tema.
{
  const { page, ctx } = await abrir();
  const titulos = await page.$$eval('main .card .c-title', (els) => els.map((e) => e.textContent));
  assert.ok(titulos.length >= 4, 'hay tarjetas');
  const sev = await page.$$eval('main .card .pill', (els) => els.map((e) => e.textContent));
  assert.deepEqual([...sev].sort(), sev.slice().sort(), 'ordenadas por severidad');
  assert.equal(titulos.filter((t) => /login/i.test(t)).length, 1, 'una sola tarjeta de login');
  assert.ok(await visible(page, 'text=Para revisar'), 'admin ve Para revisar');
  assert.ok(await visible(page, 'text=1 cambio sugerido en reglas'), 'cambios sugeridos por la rutina');
  assert.ok(await visible(page, 'text=×7'), 'badge de recurrencia');
  assert.equal(await page.getAttribute('#nav a[aria-current="page"]', 'href'), '#inicio', 'la navegación marca la vista actual');
  assert.ok(await page.isVisible('#nav a[href="#proyectos"]') && await page.isVisible('#nav a[href="#no-reportados"]'), 'navegación siempre visible');
  paso('admin: bandeja ordenada, una tarjeta por tema, recurrencia visible, navegación lateral');
  if (CAPT) await page.screenshot({ path: join(CAPT, 'admin-escritorio.png'), fullPage: true });

  // Detalle con análisis.
  const login = page.locator('.card', { hasText: 'login' }).first();
  const scrollAntes = await page.evaluate(() => window.scrollY);
  await login.locator('.c-title a').click();
  // El detalle se abre en un panel sobre la lista (diálogo modal), sin perder el lugar.
  await page.waitForSelector('#dw[role="dialog"] >> text=Análisis previo', { timeout: 3000 });
  assert.equal(await page.evaluate(() => document.getElementById('app').inert), true, 'el fondo queda inerte');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'dw', 'el foco entra al panel');
  await page.waitForSelector('text=Framework/InitAllApplications.xaml:42', { timeout: 3000 });
  assert.ok(await visible(page, 'text=LIB_Sap · LoginSap'), 'etiqueta de librería');
  assert.ok(await visible(page, 'text=Nueva versión 1.4.0'), 'etiqueta de deploy');
  assert.ok(await visible(page, 'text=También la usan: Conciliación bancaria'));
  await page.locator('#dw [data-act="reanalizar-inc"]').click();
  await page.waitForTimeout(100);
  assert.ok((await page.evaluate(() => window.__WRITES__)).some((w) => w.path.startsWith('requests/') && w.data.type === 'reanalyze_incident'));
  if (CAPT) await page.screenshot({ path: join(CAPT, 'detalle.png') });
  // Comentar desde la actividad del detalle.
  await page.fill('#dw textarea[id$="-coment"]', 'Avisé a soporte SAP');
  await page.click('#dw [data-act="comentar"]');
  await page.waitForTimeout(150);
  assert.ok((await page.evaluate(() => window.__WRITES__)).some((w) => w.path.startsWith('activity/') && w.data.type === 'comment'));
  // Esc cierra, devuelve el foco a la tarjeta y la lista sigue donde estaba.
  await page.keyboard.press('Escape');
  await page.waitForSelector('#dw', { state: 'detached', timeout: 3000 });
  assert.ok((await page.evaluate(() => document.activeElement.id)).startsWith('t-'), 'el foco vuelve a la tarjeta');
  assert.equal(await page.evaluate(() => document.getElementById('app').inert), false);
  assert.equal(await page.evaluate(() => window.scrollY), scrollAntes, 'la bandeja no pierde el scroll');
  paso('detalle en panel lateral: análisis, librería, deploy, comentar, re-analizar; Esc cierra y devuelve el foco');

  // Descartar: la tarjeta sale de la bandeja y se escribe incidentWork + activity.
  const antes = await page.locator('main .card').count();
  const card = page.locator('.card', { hasText: 'abandonado' }).first();
  await card.locator('[data-act="panel"][data-p="descartar"]').click();
  await card.locator('[data-act="sel"][data-v="expected"]').click();
  await card.locator('input[id$="-nota"]').fill('Mantenimiento de SAP del lunes');
  await card.locator('[data-act="descartar"]').click();
  await page.waitForTimeout(200);
  assert.equal(await page.locator('main .card').count(), antes - 1, 'la tarjeta descartada desaparece');
  const writes = await page.evaluate(() => window.__WRITES__);
  assert.ok(writes.some((w) => w.path.startsWith('incidentWork/') && w.data.state === 'dismissed' && w.data.dismissReason === 'expected'));
  assert.ok(writes.some((w) => w.path.startsWith('activity/') && w.data.type === 'dismiss'));
  paso('descartar: escribe incidentWork y activity, la tarjeta sale de la bandeja');

  // Deshacer desde el aviso: la tarjeta vuelve.
  await page.click('#toast [data-act="deshacer"]');
  await page.waitForTimeout(200);
  assert.equal(await page.locator('main .card').count(), antes, 'deshacer devuelve la tarjeta');
  assert.ok((await page.evaluate(() => window.__WRITES__)).some((w) => w.path.startsWith('activity/') && w.data.type === 'reopen'));
  // Posponer, y recuperarla desde "Fuera de bandeja".
  const c3 = page.locator('.card', { hasText: 'abandonado' }).first();
  await c3.locator('[data-act="panel"][data-p="posponer"]').click();
  await c3.locator('[data-act="posponer"][data-d="3"]').click();
  await page.waitForTimeout(200);
  assert.equal(await page.locator('main .card').count(), antes - 1, 'la tarjeta pospuesta sale de la bandeja');
  await page.click('#nav a[href="#no-reportados"]');
  await page.waitForSelector('h1 >> text=Fuera de bandeja', { timeout: 3000 });
  await page.click('[data-act="seg"][data-v="pospuestos"]');
  await page.click('main a.rowi >> nth=0');
  await page.waitForSelector('#dw >> text=Pospuesto hasta', { timeout: 3000 });
  await page.click('#dw [data-act="reabrir"]');
  await page.waitForTimeout(200);
  const wr = (await page.evaluate(() => window.__WRITES__)).filter((w) => w.path.startsWith('incidentWork/')).pop();
  assert.equal(wr.data.state, 'open'); assert.equal(wr.data.snoozeUntil, undefined, 'se limpia la fecha');
  await page.keyboard.press('Escape');
  await page.click('#nav a[href="#inicio"]');
  await page.waitForTimeout(150);
  assert.equal(await page.locator('main .card').count(), antes, 'vuelve a la bandeja');
  paso('deshacer, posponer y devolver a la bandeja desde "Fuera de bandeja"');

  // Posponer y delegar.
  const c2 = page.locator('main .card').first();
  await c2.locator('[data-act="panel"][data-p="delegar"]').click();
  await c2.locator('input[data-act="buscar"]').fill('Omar');
  await page.waitForTimeout(150);
  await c2.locator('[data-act="asignar"]').first().click();
  await page.waitForTimeout(150);
  assert.ok((await page.evaluate(() => window.__WRITES__)).some((w) => w.data.state === 'delegated' && w.data.assignee === 'u_oper0000000000000000002'));
  paso('delegar: buscador de personas y asignación');

  // Filtro por proyecto: selector con búsqueda, operable solo con teclado.
  await page.click('#scope-btn');
  await page.waitForSelector('#scope-q:focus', { timeout: 3000 });
  assert.equal(await page.locator('#scope-list [role="option"]').count(), 4, 'Todos + 3 proyectos');
  await page.keyboard.type('concil');
  await page.waitForTimeout(100);
  assert.equal(await page.locator('#scope-list [role="option"]').count(), 1, 'la búsqueda acota la lista');
  await page.keyboard.press('Enter');
  assert.ok(await visible(page, 'text=Todo en orden'));
  assert.equal(await page.getAttribute('#scope-btn', 'aria-expanded'), 'false');
  assert.ok((await page.textContent('#scope-btn')).includes('Conciliación bancaria'), 'el filtro activo se ve en el selector');
  await page.click('#scope-x');
  await page.waitForTimeout(100);
  // Con mouse y Esc.
  await page.click('#scope-btn');
  await page.click('[data-act="scope-pick"][data-id="facturacion"]');
  await page.waitForTimeout(100);
  assert.ok(await page.locator('main .card').count() > 0);
  await page.click('#scope-btn');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(100);
  assert.equal(await page.locator('#scope-pop').count(), 0, 'Esc cierra el selector');
  await page.click('#scope-x');
  // Búsqueda dentro de la bandeja.
  await page.fill('#q-inbox', 'login');
  await page.waitForTimeout(100);
  assert.equal(await page.locator('main .card').count(), 1, 'la búsqueda filtra la bandeja');
  await page.fill('#q-inbox', '');
  paso('filtro por proyecto con búsqueda y teclado; búsqueda en la bandeja');

  // Corridas y detalle de corrida.
  await page.evaluate(() => { location.hash = '#corridas'; });
  await page.waitForTimeout(100);
  await page.click('a.rowi >> nth=0');
  await page.waitForTimeout(100);
  assert.ok(await visible(page, 'text=Punto de control'));
  assert.ok(await visible(page, 'text=Hallazgos y triage'));
  if (CAPT) await page.screenshot({ path: join(CAPT, 'corrida.png'), fullPage: true });
  await page.click('main .list a.rowi >> nth=0');
  await page.waitForSelector('#dw[role="dialog"]', { timeout: 3000 });
  await page.click('#dw-x');
  await page.waitForSelector('#dw', { state: 'detached', timeout: 3000 });
  assert.ok(await visible(page, 'text=Punto de control'), 'al cerrar se vuelve a la corrida');
  paso('corridas: checks y triage por proyecto; el hallazgo abre el detalle');

  // Proyecto en revisión + reglas propuestas.
  await page.click('#nav a[href="#reglas"]');
  await page.waitForTimeout(100);
  assert.ok(await visible(page, 'text=Propuestas para aprobar'));
  await page.locator('[data-act="regla"][data-s="active"]').first().click();
  await page.waitForTimeout(100);
  assert.ok((await page.evaluate(() => window.__WRITES__)).some((w) => w.path === 'rules/facturacion-abandonados' && w.data.status === 'active'));
  paso('reglas: aprobar una propuesta');
  await page.click('#nav a[href="#proyectos"]');
  await page.click('main a.rowi[href="#proyecto-facturacion"]');
  await page.waitForTimeout(150);
  assert.ok(await visible(page, 'text=Registra en SAP las facturas'));
  assert.equal(await page.getAttribute('#nav a[aria-current="page"]', 'href'), '#proyectos');
  // Pestañas con teclado.
  await page.focus('#tab-memoria');
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(100);
  assert.equal(await page.getAttribute('#tab-produccion', 'aria-selected'), 'true');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'tab-produccion');
  await page.keyboard.press('ArrowLeft');
  // Del proyecto a sus temas en la bandeja.
  await page.click('[data-act="ver-bandeja"]');
  await page.waitForSelector('h1 >> text=Bandeja', { timeout: 3000 });
  assert.ok((await page.textContent('#scope-btn')).includes('Facturación'));
  await page.click('#scope-x');
  paso('proyectos: lista, memoria de proceso, pestañas con teclado y salto a la bandeja');
  // Registrar proyecto: solo nombre y carpeta; los procesos se detectan solos.
  await page.click('#nav a[href="#proyectos"]');
  await page.click('main a[href="#registrar"] >> nth=0');
  await page.waitForTimeout(100);
  await page.fill('#f-nuevo-p-nombre', 'Cobranzas');
  await page.fill('#f-nuevo-p-carpeta', 'Produccion/Cobranzas');
  assert.equal(await page.isVisible('#f-nuevo-p-crit'), false, 'opciones avanzadas cerradas por defecto');
  await page.click('[data-act="registrar"]');
  await page.waitForTimeout(150);
  const w2 = await page.evaluate(() => window.__WRITES__);
  const nuevo = w2.find((w) => w.path === 'projects/cobranzas');
  assert.ok(nuevo && nuevo.data.status === 'pending_analysis' && nuevo.data.includeAllProcesses === true);
  assert.deepEqual(nuevo.data.processes, []);
  assert.ok(w2.some((w) => w.path.startsWith('requests/') && w.data.type === 'onboard_project' && w.data.projectId === 'cobranzas'));
  // Registrar desde la lista de carpetas detectadas.
  await page.evaluate(() => { location.hash = '#registrar'; });
  await page.waitForTimeout(150);
  await page.click('[data-act="registrar-detectada"][data-folder="Produccion/Tesoreria/Pagos"]');
  await page.waitForTimeout(150);
  assert.ok((await page.evaluate(() => window.__WRITES__)).some((w) => w.path.startsWith('projects/') && w.data.orchestrator && w.data.orchestrator.folderPath === 'Produccion/Tesoreria/Pagos'));
  if (CAPT) await page.screenshot({ path: join(CAPT, 'registrar.png'), fullPage: true });
  paso('registrar proyecto: nombre y carpeta, o desde una carpeta detectada');

  // Editar la configuración de un proyecto con el formato anterior (un solo repo) y re-analizar.
  await page.evaluate(() => { location.hash = '#proyecto-nomina'; });
  await page.waitForTimeout(150);
  await page.click('text=Editar configuración');
  await page.waitForTimeout(100);
  await page.click('details[data-adv="cfg-nomina"] summary');
  await page.waitForTimeout(100);
  assert.equal(await page.inputValue('#f-cfg-nomina-0-repo'), 'ejemplo/nomina');
  await page.fill('#f-cfg-nomina-0-repo', 'https://bitbucket.org/ejemplo/nomina-performer');
  await page.fill('#f-cfg-nomina-0-label', 'Performer');
  assert.equal(await page.inputValue('#f-cfg-nomina-0-role'), 'performer', 'el rol se deduce del nombre');
  await page.click('[data-act="agregar-proceso"]');
  await page.fill('#f-cfg-nomina-1-label', 'Dispatcher');
  await page.selectOption('#f-cfg-nomina-1-role', 'dispatcher');
  await page.fill('#f-cfg-nomina-1-repo', 'ejemplo/nomina-dispatcher');
  await page.check('#f-cfg-nomina-p-solo');
  await page.click('[data-act="guardar-proyecto"][data-reanalizar="1"]');
  await page.waitForTimeout(150);
  const w3 = await page.evaluate(() => window.__WRITES__);
  const upd = w3.filter((w) => w.path === 'projects/nomina').pop();
  assert.equal(upd.data.repo, null, 'se reemplaza el formato anterior');
  assert.equal(upd.data.includeAllProcesses, false, 'controlar solo la lista');
  assert.deepEqual(upd.data.processes.map((x) => x.repo.slug), ['nomina-performer', 'nomina-dispatcher']);
  assert.ok(w3.some((w) => w.path.startsWith('requests/') && w.data.type === 'reanalyze_project' && w.data.projectId === 'nomina'));
  assert.ok(await visible(page, 'text=nomina-dispatcher'), 'el resumen de procesos se actualiza');
  assert.equal(await page.inputValue('#f-cfg-nomina-1-repo'), 'ejemplo/nomina-dispatcher', 'el formulario queda con lo guardado');
  assert.equal(upd.data.processes[0].role, 'performer');
  paso('editar configuración: cambiar repo, agregar proceso, guardar y re-analizar');
  if (CAPT) await page.screenshot({ path: join(CAPT, 'proyecto-config.png'), fullPage: true });
  await ctx.close();
}

// 1b) Admin: ajustar, crear y eliminar reglas sin salir de la tarjeta.
{
  const { page, ctx } = await abrir();
  const writes = () => page.evaluate(() => window.__WRITES__);
  const login = page.locator('.card', { hasText: 'login' }).first();
  await login.locator('[data-act="panel"][data-p="regla"]', { hasText: 'Ajustar regla' }).click();
  await page.waitForSelector('.card .redit textarea');
  assert.equal(await login.locator('.redit textarea').inputValue(), 'Si se ven más de 10 errores de login seguidos, alertar');
  assert.equal(await login.locator('[data-act="re-sev"][aria-pressed="true"]').textContent(), 'P2', 'severidad actual marcada');
  if (CAPT) await login.screenshot({ path: join(CAPT, 'regla-editor.png') });
  // Sin cambios no escribe nada.
  await login.locator('[data-act="re-guardar"]').click();
  await page.waitForTimeout(100);
  assert.ok(!(await writes()).some((w) => w.path === 'rules/regla-login'), 'sin cambios no se guarda');
  // Solo severidad: vale al guardar, no hace falta volver a traducir.
  await login.locator('[data-act="re-sev"][data-v="P3"]').click();
  await login.locator('[data-act="re-guardar"]').click();
  await page.waitForTimeout(150);
  let w = (await writes()).filter((x) => x.path === 'rules/regla-login').pop();
  assert.equal(w.data.compiled.severity, 'P3');
  assert.equal(w.data.compiled.threshold, 10, 'el resto de la regla compilada se conserva');
  assert.equal(w.data.status, undefined, 'sigue activa');
  assert.ok((await writes()).some((x) => x.path.startsWith('activity/') && x.data.type === 'rule' && /severidad P2 → P3/.test(x.data.text)));
  assert.equal(await login.locator('.redit').count(), 0, 'el editor se cierra al guardar');
  paso('regla desde la tarjeta: cambiar la severidad (inmediato) y rastro en la actividad');

  // Excepción: se guarda en lenguaje natural y la regla queda por traducir.
  await login.locator('[data-act="panel"][data-p="regla"]').click();
  await login.locator('.redit input[type=text]').fill('cuando es lunes antes de las 9 (mantenimiento de SAP)');
  await login.locator('[data-act="re-guardar"]').click();
  await page.waitForTimeout(150);
  w = (await writes()).filter((x) => x.path === 'rules/regla-login').pop();
  assert.equal(w.data.status, 'pending_compile');
  assert.equal(w.data.exceptions.length, 1);
  assert.equal(w.data.exceptions[0].text, 'es lunes antes de las 9 (mantenimiento de SAP)');
  assert.ok(w.data.exceptions[0].incidentId.startsWith('inc-'), 'la excepción recuerda de qué tarjeta salió');
  await login.locator('[data-act="panel"][data-p="regla"]').click();
  assert.ok(await visible(page, 'text=No aplica cuando es lunes antes de las 9'));
  assert.ok(await visible(page, 'text=Tiene cambios sin traducir'));
  if (CAPT) await login.screenshot({ path: join(CAPT, 'regla-excepcion.png') });
  paso('regla desde la tarjeta: agregar una excepción');

  // Eliminar: pide confirmación en el mismo lugar y puede descartar la tarjeta en el mismo paso.
  const antes = await page.locator('main .card').count();
  await login.locator('[data-act="re-eliminar"]').click();
  assert.ok(await visible(page, 'text=¿Eliminar esta regla?'));
  await login.locator('[data-act="re-cancelar"]').click();
  await login.locator('.redit input[type=checkbox]').check();
  await login.locator('[data-act="re-eliminar"]').click();
  await login.locator('[data-act="re-eliminar-ok"]').click();
  await page.waitForTimeout(200);
  assert.ok((await writes()).some((x) => x.op === 'delete' && x.path === 'rules/regla-login'));
  assert.ok((await writes()).some((x) => x.path.startsWith('incidentWork/') && x.data.state === 'dismissed' && x.data.dismissReason === 'false_positive'));
  assert.equal(await page.locator('main .card').count(), antes - 1, 'la tarjeta sale de la bandeja');
  paso('regla desde la tarjeta: eliminar con confirmación y descartar la tarjeta');

  // Incidente que no salió de una regla: crear una para ese caso.
  const otra = page.locator('.card', { hasText: 'abandonado' }).first();
  await otra.locator('[data-act="panel"][data-p="regla"]', { hasText: 'Crear regla' }).click();
  await otra.locator('textarea[id$="-rnueva"]').fill('Los abandonados de los lunes antes de las 9 son normales; no avisar');
  if (CAPT) await otra.screenshot({ path: join(CAPT, 'regla-nueva.png') });
  await otra.locator('[data-act="re-crear"]').click();
  await page.waitForTimeout(150);
  const nueva = (await writes()).find((x) => x.op === 'set' && x.path.startsWith('rules/facturacion-'));
  assert.ok(nueva && nueva.data.status === 'pending_compile' && nueva.data.origin === 'manual' && nueva.data.sourceIncidentId.startsWith('inc-'));
  paso('regla desde la tarjeta: crear una regla para un incidente sin regla');

  // El mismo editor en la lista de reglas: editar una propuesta la aprueba.
  await page.evaluate(() => { location.hash = '#reglas'; });
  await page.waitForTimeout(100);
  const fila = page.locator('.rowi', { hasText: 'mantenimiento de SAP' }).first();
  await fila.locator('[data-act="re-abrir"]').click();
  await page.waitForSelector('.rule-ed textarea');
  await page.locator('.rule-ed textarea').fill('Los items abandonados de los lunes antes de las 10 son normales (mantenimiento de SAP)');
  assert.equal((await page.locator('.rule-ed [data-act="re-guardar"]').textContent()).trim(), 'Guardar y aprobar');
  if (CAPT) await page.screenshot({ path: join(CAPT, 'reglas-lista.png'), fullPage: true });
  await page.locator('.rule-ed [data-act="re-guardar"]').click();
  await page.waitForTimeout(150);
  w = (await writes()).filter((x) => x.path === 'rules/facturacion-abandonados').pop();
  assert.ok(w.data.status === 'pending_compile' && /antes de las 10/.test(w.data.text) && w.data.approvedBy);
  assert.equal(await page.locator('.rule-ed').count(), 0);
  paso('lista de reglas: el mismo editor; editar una propuesta la aprueba');

  // Propuestas de la rutina: por similitud (con su porqué) y cambio sugerido sobre una regla activa.
  assert.ok(await visible(page, 'text=por similitud con otro proceso'));
  assert.ok(await visible(page, 'text=usa la misma librería LIB_Sap'));
  const sugerida = page.locator('.rowi', { hasText: 'excepciones de negocio' }).first();
  assert.ok(await sugerida.locator('text=Cambio sugerido').count());
  await sugerida.locator('[data-act="re-abrir"]', { hasText: 'Revisar' }).click();
  await page.waitForSelector('.rule-ed [data-act="re-sug-aplicar"]');
  if (CAPT) await page.screenshot({ path: join(CAPT, 'reglas-sugerencias.png'), fullPage: true });
  await page.locator('.rule-ed [data-act="re-sug-aplicar"]').click();
  await page.waitForTimeout(100);
  assert.equal(await page.locator('.rule-ed [data-act="re-sev"][aria-pressed="true"]').textContent(), 'P4', 'la sugerencia se carga en el formulario');
  assert.ok(!(await writes()).some((x) => x.path === 'rules/facturacion-negocio'), 'aplicar no escribe: confirma una persona');
  await page.locator('.rule-ed [data-act="re-guardar"]').click();
  await page.waitForTimeout(150);
  w = (await writes()).filter((x) => x.path === 'rules/facturacion-negocio').pop();
  assert.ok(w.data.compiled.severity === 'P4' && w.data.suggestion === null);
  paso('propuestas de la rutina: regla por similitud con su porqué; cambio sugerido que se aplica y se confirma');
  await ctx.close();
}

// 2) Operador: acciones sobre incidentes, sin acciones de Admin; "Para vos".
{
  const { page, ctx } = await abrir({ role: 'operador' });
  assert.ok(await visible(page, 'text=Para vos'));
  assert.ok(!(await page.isVisible('text=Para revisar')));
  assert.ok(await page.locator('[data-act="panel"]').count() > 0);
  // La regla se ve, pero no se puede cambiar ni crear.
  const login = page.locator('.card', { hasText: 'login' }).first();
  await login.locator('[data-act="panel"][data-p="regla"]', { hasText: 'Ver regla' }).click();
  assert.ok(await visible(page, 'text=Solo un Admin puede cambiar o eliminar reglas'));
  assert.equal(await page.locator('[data-act="re-guardar"], [data-act="re-eliminar"], [data-act="re-crear"]').count(), 0);
  assert.equal(await page.locator('[data-act="panel"][data-p="regla"]', { hasText: 'Crear regla' }).count(), 0);
  paso('operador: ve "Para vos" y acciones rápidas, no ve tareas de Admin; la regla es de solo lectura');
  await ctx.close();
}

// 3) Lector: sin botones de acción.
{
  const { page, ctx } = await abrir({ role: 'lector' });
  assert.equal(await page.locator('[data-act="panel"]').count(), 0);
  paso('lector: solo lectura');
  await ctx.close();
}

// 4) Base vacía y sin db.
{
  const { page, ctx } = await abrir({ vacio: true });
  assert.ok(await visible(page, 'text=Todo en orden'));
  assert.ok(await visible(page, 'text=Registrá el primero'));
  await ctx.close();
  const r = await abrir({ sinDb: true });
  assert.ok(await visible(r.page, 'text=necesita una sesión'));
  await r.ctx.close();
  paso('estados vacíos: sin datos y sin base');
}

// 5) Ayuda: "?" contextual, vistas de ejemplo sin escrituras, tooltip con link y lectura para Lector.
{
  const { page, ctx } = await abrir();
  // El link Ayuda del menú y el "?" del título llevan a la sección de la pantalla actual.
  assert.equal(await page.getAttribute('#nav a:has-text("Ayuda")', 'href'), '#ayuda-bandeja');
  await page.evaluate(() => { location.hash = '#corridas'; });
  await page.waitForTimeout(150);
  assert.equal(await page.getAttribute('#nav a:has-text("Ayuda")', 'href'), '#ayuda-corridas');
  await page.click('.vh .help');
  await page.waitForTimeout(250);
  assert.equal(await page.evaluate(() => location.hash), '#ayuda-corridas');
  const top = await page.evaluate(() => document.getElementById('ayuda-corridas').getBoundingClientRect().top);
  assert.ok(top >= 0 && top < 300, `la sección queda a la vista (top ${top})`);
  assert.equal(await page.getAttribute('#nav a[aria-current="page"]', 'href'), '#ayuda', 'Ayuda activa en el menú');
  paso('ayuda: el "?" de cada pantalla abre su sección');

  // Las vistas de ejemplo son las de la app, inertes y sin escribir en la base.
  const antes = (await page.evaluate(() => window.__WRITES__)).length;
  assert.ok(await page.locator('.ay-vista .card').count() >= 5, 'tarjetas de ejemplo');
  assert.ok(await page.locator('.ay-vista .rowi').count() >= 3, 'listas de ejemplo');
  assert.ok(await visible(page, '#ayuda-posponer >> text=1 semana'), 'panel Posponer de ejemplo');
  assert.ok(await visible(page, '#ayuda-editor-regla >> text=Excepción'), 'editor de reglas de ejemplo');
  assert.equal(await page.locator('.ay-vista:not([inert])').count(), 0, 'vistas inertes');
  assert.equal(await page.locator('.ay-vista >> text=No se pudo dibujar').count(), 0, 'todas las vistas se dibujan');
  await page.locator('.ay-vista [data-act="panel"]').first().click({ force: true, timeout: 1000 }).catch(() => {});
  await page.waitForTimeout(100);
  assert.equal((await page.evaluate(() => window.__WRITES__)).length, antes, 'la ayuda no escribe');
  assert.ok(await visible(page, '#ayuda-glosario >> text=Recurrencia'), 'glosario');
  paso('ayuda: introducción, glosario y vistas reales con datos de ejemplo, sin escrituras');
  if (CAPT) await page.screenshot({ path: join(CAPT, 'ayuda.png'), fullPage: true });

  // Tooltip de Posponer en una tarjeta real, con link a la ayuda.
  await page.evaluate(() => { location.hash = '#inicio'; });
  await page.waitForTimeout(150);
  await page.locator('main .card [data-act="panel"][data-p="posponer"]').first().hover();
  await page.waitForSelector('#tip:not([hidden])', { timeout: 2000 });
  assert.match(await page.textContent('#tip'), /Oculta el tema hasta una fecha/);
  if (CAPT) await page.screenshot({ path: join(CAPT, 'tooltip-posponer.png') });
  await page.click('#tip a');
  await page.waitForTimeout(250);
  assert.equal(await page.evaluate(() => location.hash), '#ayuda-posponer');
  assert.ok(await page.isHidden('#tip'));
  paso('tooltip: Posponer explica y lleva a la ayuda');

  // "Más sobre…" en el panel y "?" en el detalle de un tema.
  await page.evaluate(() => { location.hash = '#inicio'; });
  await page.waitForTimeout(150);
  const c = page.locator('main .card').first();
  await c.locator('[data-act="panel"][data-p="descartar"]').click();
  await page.waitForTimeout(100);
  assert.equal(await page.locator('main .card').first().locator('a.ay-mas').getAttribute('href'), '#ayuda-descartar');
  await page.locator('main .card .c-title a').first().click();
  await page.waitForSelector('#dw', { timeout: 2000 });
  assert.equal(await page.getAttribute('#dw .dw-top .help', 'href'), '#ayuda-tarjeta');
  if (CAPT) await page.screenshot({ path: join(CAPT, 'detalle-ayuda.png') });
  paso('panel con link a su ayuda y "?" en el detalle del tema');
  await ctx.close();

  const l = await abrir({ role: 'lector' });
  await l.page.evaluate(() => { location.hash = '#ayuda'; });
  await l.page.waitForTimeout(200);
  assert.ok(await visible(l.page, 'text=Qué es la Torre de Control'));
  await l.ctx.close();
  const m = await abrir({ viewport: { width: 390, height: 844 }, oscuro: true });
  await m.page.evaluate(() => { location.hash = '#mas'; });
  await m.page.waitForTimeout(150);
  await m.page.click('main a.rowi[href="#ayuda"]');
  await m.page.waitForTimeout(250);
  assert.ok(await visible(m.page, 'text=Qué es la Torre de Control'), 'ayuda desde Más');
  const ancho = await m.page.evaluate(() => document.documentElement.scrollWidth);
  assert.ok(ancho <= 390, `ayuda sin scroll horizontal (ancho ${ancho})`);
  if (CAPT) await m.page.screenshot({ path: join(CAPT, 'ayuda-telefono-oscuro.png'), fullPage: true });
  await m.ctx.close();
  paso('ayuda: visible para Lector, desde Más en el teléfono y sin scroll horizontal');
}

// 6) Teléfono (oscuro): sin scroll horizontal.
{
  const { page, ctx } = await abrir({ viewport: { width: 390, height: 844 }, oscuro: true });
  const ancho = await page.evaluate(() => document.documentElement.scrollWidth);
  assert.ok(ancho <= 390, `sin scroll horizontal (ancho ${ancho})`);
  if (CAPT) await page.screenshot({ path: join(CAPT, 'telefono-oscuro.png') });
  assert.ok(await page.isVisible('#tabbar') && !(await page.isVisible('#nav')), 'barra inferior en vez del riel');
  await page.click('#tabbar a[href="#mas"]');
  await page.click('main a[href="#no-reportados"]');
  await page.waitForSelector('h1 >> text=Fuera de bandeja', { timeout: 3000 });
  await page.click('#tabbar a[href="#inicio"]');
  await page.click('main .card .c-title a >> nth=0');
  await page.waitForSelector('#dw[role="dialog"]', { timeout: 3000 });
  assert.ok(await page.evaluate(() => document.getElementById('dw').getBoundingClientRect().width >= document.documentElement.clientWidth), 'detalle a pantalla completa');
  assert.ok((await page.evaluate(() => document.documentElement.scrollWidth)) <= 390, 'sin scroll horizontal con el detalle abierto');
  if (CAPT) await page.screenshot({ path: join(CAPT, 'telefono-detalle.png') });
  await page.keyboard.press('Escape');
  await page.click('#scope-btn');
  await page.waitForSelector('#scope-q', { timeout: 3000 });
  assert.ok((await page.evaluate(() => document.documentElement.scrollWidth)) <= 390, 'sin scroll horizontal con el selector abierto');
  if (CAPT) await page.screenshot({ path: join(CAPT, 'telefono-selector.png') });
  paso('teléfono: barra inferior, detalle a pantalla completa, sin scroll horizontal, tema oscuro');
  await ctx.close();
}

await browser.close();
for (const p of ok) console.log('ok -', p);
if (errores.length) { console.error('Errores de página:\n' + errores.join('\n')); process.exit(1); }
console.log(`\n${ok.length} pasos OK, sin errores de página`);
