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

// 1) Admin: bandeja de acción ordenada, "Para revisar", sin duplicados por tema.
{
  const { page, ctx } = await abrir();
  const titulos = await page.$$eval('main .card .c-title', (els) => els.map((e) => e.textContent));
  assert.ok(titulos.length >= 4, 'hay tarjetas');
  const sev = await page.$$eval('main .card .pill', (els) => els.map((e) => e.textContent));
  assert.deepEqual([...sev].sort(), sev.slice().sort(), 'ordenadas por severidad');
  assert.equal(titulos.filter((t) => /login/i.test(t)).length, 1, 'una sola tarjeta de login');
  assert.ok(await page.isVisible('text=Para revisar'), 'admin ve Para revisar');
  assert.ok(await page.isVisible('text=×7'), 'badge de recurrencia');
  paso('admin: bandeja ordenada, una tarjeta por tema, recurrencia visible');
  if (CAPT) await page.screenshot({ path: join(CAPT, 'admin-escritorio.png'), fullPage: true });

  // Detalle con análisis.
  const login = page.locator('.card', { hasText: 'login' }).first();
  await login.locator('[data-act="detalle"]').click();
  assert.ok(await page.isVisible('text=Análisis previo'));
  assert.ok(await page.isVisible('text=Framework/InitAllApplications.xaml:42'));
  paso('detalle: triage, análisis, código y evidencia');
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
  assert.ok(await page.isVisible('text=Todo en orden'));
  await page.click('[data-filter=""]');
  paso('filtro por proyecto con un clic');

  // Corridas y detalle de corrida.
  await page.evaluate(() => { location.hash = '#corridas'; });
  await page.waitForTimeout(100);
  await page.click('a.rowi >> nth=0');
  await page.waitForTimeout(100);
  assert.ok(await page.isVisible('text=Punto de control'));
  assert.ok(await page.isVisible('text=Hallazgos y triage'));
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
  assert.ok(await page.isVisible('text=Registra en SAP las facturas'));
  paso('proyecto: memoria de proceso');
  // Registrar proyecto.
  await page.evaluate(() => { location.hash = '#registrar'; });
  await page.waitForTimeout(100);
  await page.fill('#rg-nombre', 'Cobranzas');
  await page.fill('#rg-carpeta', 'Produccion/Cobranzas');
  await page.fill('#rg-repo', 'https://bitbucket.org/elementblue/cobranzas/src/main/');
  await page.click('[data-act="registrar"]');
  await page.waitForTimeout(150);
  const w2 = await page.evaluate(() => window.__WRITES__);
  assert.ok(w2.some((w) => w.path === 'projects/cobranzas' && w.data.repo.slug === 'cobranzas' && w.data.status === 'pending_analysis'));
  assert.ok(w2.some((w) => w.path.startsWith('requests/') && w.data.type === 'onboard_project'));
  paso('registrar proyecto: crea el proyecto y la solicitud de análisis');
  await ctx.close();
}

// 2) Operador: acciones sobre incidentes, sin acciones de Admin; "Para vos".
{
  const { page, ctx } = await abrir({ role: 'operador' });
  assert.ok(await page.isVisible('text=Para vos'));
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
  assert.ok(await page.isVisible('text=Todo en orden'));
  assert.ok(await page.isVisible('text=Registrá el primero'));
  await ctx.close();
  const r = await abrir({ sinDb: true });
  assert.ok(await r.page.isVisible('text=necesita una sesión'));
  await r.ctx.close();
  paso('estados vacíos: sin datos y sin base');
}

// 5) Teléfono (oscuro): sin scroll horizontal.
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
