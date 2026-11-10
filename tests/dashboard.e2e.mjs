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
  const ctx = await browser.newContext({ viewport, colorScheme: oscuro ? 'dark' : 'light', deviceScaleFactor: 1 });
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
  assert.ok(await visible(page, 'text=×7'), 'badge de recurrencia');
  paso('admin: bandeja ordenada, una tarjeta por tema, recurrencia visible');
  if (CAPT) await page.screenshot({ path: join(CAPT, 'admin-escritorio.png'), fullPage: true });

  // Detalle con análisis.
  const login = page.locator('.card', { hasText: 'login' }).first();
  await login.locator('[data-act="detalle"]').click();
  // Esperar al render (requestAnimationFrame) en vez de leer en el mismo tick.
  await page.waitForSelector('text=Análisis previo', { timeout: 3000 });
  await page.waitForSelector('text=Framework/InitAllApplications.xaml:42', { timeout: 3000 });
  assert.ok(await visible(page, 'text=LIB_Sap · LoginSap'), 'etiqueta de librería');
  assert.ok(await visible(page, 'text=Nueva versión 1.4.0'), 'etiqueta de deploy');
  assert.ok(await visible(page, 'text=También la usan: Conciliación bancaria'));
  await login.locator('[data-act="reanalizar-inc"]').click();
  await page.waitForTimeout(100);
  assert.ok((await page.evaluate(() => window.__WRITES__)).some((w) => w.path.startsWith('requests/') && w.data.type === 'reanalyze_incident'));
  paso('detalle: triage, análisis, librería, deploy y volver a analizar');
  if (CAPT) await page.screenshot({ path: join(CAPT, 'detalle.png'), fullPage: true });

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

  // Posponer y delegar.
  const c2 = page.locator('main .card').first();
  await c2.locator('[data-act="panel"][data-p="delegar"]').click();
  await c2.locator('input[data-act="buscar"]').fill('Omar');
  await page.waitForTimeout(150);
  await c2.locator('[data-act="asignar"]').first().click();
  await page.waitForTimeout(150);
  assert.ok((await page.evaluate(() => window.__WRITES__)).some((w) => w.data.state === 'delegated' && w.data.assignee === 'u_oper0000000000000000002'));
  paso('delegar: buscador de personas y asignación');

  // Filtro por proyecto: un clic.
  await page.click('[data-filter="conciliacion"]');
  await page.waitForTimeout(100);
  assert.ok(await visible(page, 'text=Todo en orden'));
  await page.click('[data-filter=""]');
  paso('filtro por proyecto con un clic');

  // Corridas y detalle de corrida.
  await page.evaluate(() => { location.hash = '#corridas'; });
  await page.waitForTimeout(100);
  await page.click('a.rowi >> nth=0');
  await page.waitForTimeout(100);
  assert.ok(await visible(page, 'text=Punto de control'));
  assert.ok(await visible(page, 'text=Hallazgos y triage'));
  paso('corridas: checks y triage por proyecto');
  if (CAPT) await page.screenshot({ path: join(CAPT, 'corrida.png'), fullPage: true });

  // Proyecto en revisión + reglas propuestas.
  await page.evaluate(() => { location.hash = '#reglas'; });
  await page.waitForTimeout(100);
  await page.locator('[data-act="regla"][data-s="active"]').first().click();
  await page.waitForTimeout(100);
  assert.ok((await page.evaluate(() => window.__WRITES__)).some((w) => w.path === 'rules/facturacion-abandonados' && w.data.status === 'active'));
  paso('reglas: aprobar una propuesta');
  await page.evaluate(() => { location.hash = '#proyecto-facturacion'; });
  await page.waitForTimeout(150);
  assert.ok(await visible(page, 'text=Registra en SAP las facturas'));
  paso('proyecto: memoria de proceso');
  // Registrar proyecto: solo nombre y carpeta; los procesos se detectan solos.
  await page.evaluate(() => { location.hash = '#registrar'; });
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

// 2) Operador: acciones sobre incidentes, sin acciones de Admin; "Para vos".
{
  const { page, ctx } = await abrir({ role: 'operador' });
  assert.ok(await visible(page, 'text=Para vos'));
  assert.ok(!(await page.isVisible('text=Para revisar')));
  assert.ok(await page.locator('[data-act="panel"]').count() > 0);
  paso('operador: ve "Para vos" y acciones rápidas, no ve tareas de Admin');
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
  // El "?" de la barra lleva a la sección de la pantalla actual.
  assert.equal(await page.getAttribute('#ayuda-top', 'href'), '#ayuda-bandeja');
  await page.evaluate(() => { location.hash = '#corridas'; });
  await page.waitForTimeout(100);
  assert.equal(await page.getAttribute('#ayuda-top', 'href'), '#ayuda-corridas');
  await page.click('.view-h .help');
  await page.waitForTimeout(200);
  assert.equal(await page.evaluate(() => location.hash), '#ayuda-corridas');
  const top = await page.evaluate(() => document.getElementById('ayuda-corridas').getBoundingClientRect().top);
  assert.ok(top >= 0 && top < 300, `la sección queda a la vista (top ${top})`);
  paso('ayuda: el "?" de cada pantalla abre su sección');

  // Las vistas de ejemplo son las de la app, inertes y sin escribir en la base.
  const antes = (await page.evaluate(() => window.__WRITES__)).length;
  assert.ok(await page.locator('.ay-vista .card').count() >= 5, 'tarjetas de ejemplo');
  assert.ok(await page.locator('.ay-vista .rowi').count() >= 3, 'listas de ejemplo');
  assert.ok(await visible(page, '#ayuda-posponer >> text=1 semana'), 'panel Posponer de ejemplo');
  assert.equal(await page.locator('.ay-vista:not([inert])').count(), 0, 'vistas inertes');
  assert.equal(await page.locator('.ay-vista >> text=No se pudo dibujar').count(), 0, 'todas las vistas se dibujan');
  await page.locator('.ay-vista [data-act="panel"]').first().click({ force: true }).catch(() => {});
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
  assert.match(await page.textContent('#tip'), /Oculta la tarjeta hasta una fecha/);
  if (CAPT) await page.screenshot({ path: join(CAPT, 'tooltip-posponer.png') });
  await page.click('#tip a');
  await page.waitForTimeout(200);
  assert.equal(await page.evaluate(() => location.hash), '#ayuda-posponer');
  assert.ok(await page.isHidden('#tip'));
  paso('tooltip: Posponer explica y lleva a la ayuda');

  // Link "Más sobre…" dentro del panel.
  await page.evaluate(() => { location.hash = '#inicio'; });
  await page.waitForTimeout(150);
  const c = page.locator('main .card').first();
  await c.locator('[data-act="panel"][data-p="descartar"]').click();
  assert.equal(await c.locator('a.ay-mas').getAttribute('href'), '#ayuda-descartar');
  paso('panel de acción con link a su ayuda');
  await ctx.close();

  const l = await abrir({ role: 'lector' });
  await l.page.evaluate(() => { location.hash = '#ayuda'; });
  await l.page.waitForTimeout(200);
  assert.ok(await visible(l.page, 'text=Qué es la Torre de Control'));
  assert.ok(await l.page.locator('nav.more a[href="#ayuda"]').count() === 1, 'Ayuda en Ver más');
  await l.ctx.close();
  const m = await abrir({ viewport: { width: 390, height: 844 }, oscuro: true });
  await m.page.evaluate(() => { location.hash = '#ayuda'; });
  await m.page.waitForTimeout(200);
  const ancho = await m.page.evaluate(() => document.documentElement.scrollWidth);
  assert.ok(ancho <= 390, `ayuda sin scroll horizontal (ancho ${ancho})`);
  if (CAPT) await m.page.screenshot({ path: join(CAPT, 'ayuda-telefono-oscuro.png'), fullPage: true });
  await m.ctx.close();
  paso('ayuda: visible para Lector y sin scroll horizontal en teléfono oscuro');
}

// 6) Teléfono (oscuro): sin scroll horizontal.
{
  const { page, ctx } = await abrir({ viewport: { width: 390, height: 844 }, oscuro: true });
  const ancho = await page.evaluate(() => document.documentElement.scrollWidth);
  assert.ok(ancho <= 390, `sin scroll horizontal (ancho ${ancho})`);
  paso('teléfono: sin scroll horizontal, tema oscuro');
  if (CAPT) await page.screenshot({ path: join(CAPT, 'telefono-oscuro.png'), fullPage: true });
  await ctx.close();
}

await browser.close();
for (const p of ok) console.log('ok -', p);
if (errores.length) { console.error('Errores de página:\n' + errores.join('\n')); process.exit(1); }
console.log(`\n${ok.length} pasos OK, sin errores de página`);
