// Prueba del tablero en un navegador real con window.claude simulado y datos sintéticos.
// Ejecutar: node tests/dashboard.e2e.mjs [--capturas <dir>]
import { createRequire } from 'node:module';
import { readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { deflateRawSync } from 'node:zlib';
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

// Un .docx mínimo (ZIP con el XML de Word) para probar la conversión a Markdown sin depender de Word.
function crc32(buf) { let c = 0xffffffff; for (const b of buf) { c ^= b; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return (c ^ 0xffffffff) >>> 0; }
function zip(files) {
  const partes = []; const central = []; let pos = 0;
  for (const [nombre, texto] of Object.entries(files)) {
    const n = Buffer.from(nombre); const datos = Buffer.from(texto); const comp = deflateRawSync(datos); const crc = crc32(datos);
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(8, 8); local.writeUInt32LE(crc, 14); local.writeUInt32LE(comp.length, 18); local.writeUInt32LE(datos.length, 22); local.writeUInt16LE(n.length, 26);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(8, 10); c.writeUInt32LE(crc, 16); c.writeUInt32LE(comp.length, 20); c.writeUInt32LE(datos.length, 24); c.writeUInt16LE(n.length, 28); c.writeUInt32LE(pos, 42);
    partes.push(local, n, comp); central.push(c, n); pos += 30 + n.length + comp.length;
  }
  const cd = Buffer.concat(central); const fin = Buffer.alloc(22);
  fin.writeUInt32LE(0x06054b50, 0); fin.writeUInt16LE(central.length / 2, 8); fin.writeUInt16LE(central.length / 2, 10); fin.writeUInt32LE(cd.length, 12); fin.writeUInt32LE(pos, 16);
  return Buffer.concat([...partes, cd, fin]);
}
function docxDePrueba() {
  const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
  const r = (txt, negrita) => `<w:r>${negrita ? '<w:rPr><w:b/></w:rPr>' : ''}<w:t xml:space="preserve">${txt}</w:t></w:r>`;
  const par = (cont, estilo, num) => `<w:p><w:pPr>${estilo ? `<w:pStyle w:val="${estilo}"/>` : ''}${num ? `<w:numPr><w:ilvl w:val="0"/><w:numId w:val="${num}"/></w:numPr>` : ''}</w:pPr>${cont}</w:p>`;
  const celda = (txt) => `<w:tc>${par(r(txt))}</w:tc>`;
  const fila = (...cs) => `<w:tr>${cs.map(celda).join('')}</w:tr>`;
  return zip({
    '[Content_Types].xml': '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
    // Los ids de estilo dependen del idioma de Word ("Ttulo1"); el nombre interno ("heading 1") no.
    'word/styles.xml': `<?xml version="1.0"?><w:styles ${W}><w:style w:type="paragraph" w:styleId="Ttulo1"><w:name w:val="heading 1"/></w:style><w:style w:type="paragraph" w:styleId="Ttulo2"><w:name w:val="heading 2"/></w:style><w:style w:type="paragraph" w:styleId="TDC1"><w:name w:val="toc 1"/></w:style></w:styles>`,
    'word/numbering.xml': `<?xml version="1.0"?><w:numbering ${W}><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/></w:lvl></w:abstractNum><w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num><w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num></w:numbering>`,
    'word/document.xml': `<?xml version="1.0"?><w:document ${W}><w:body>
      ${par(r('1. Propósito 3'), 'TDC1')}
      ${par(r('Process Definition Document'), 'Ttulo1')}
      ${par(r('Propósito'), 'Ttulo2')}
      ${par(r('Registra las ') + r('facturas de proveedores', true) + r(' en el sistema contable.'))}
      ${par(r('Dueño del proceso: escribir a dueno.proceso@cliente.com ante dudas.'))}
      ${par(r('Lee la cola'), null, 1)}${par(r('Registra la factura'), null, 1)}
      ${par(r('Verificar el login'), null, 2)}${par(r('Escalar a soporte'), null, 2)}
      <w:tbl>${fila('Excepción', 'Descripción')}${fila('BE001', 'Factura duplicada | repetida')}</w:tbl>
      <w:sectPr/></w:body></w:document>`,
  });
}
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
  await page.waitForTimeout(100); // la vista se vuelve a dibujar al quitar el filtro: esperar antes de escribir en el buscador
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

// 1c) Admin: Ajustes (carpeta a escanear y aprobación automática) y proyectos propuestos.
{
  const { page, ctx } = await abrir();
  const writes = () => page.evaluate(() => window.__WRITES__);
  assert.ok(await visible(page, 'text=3 proyectos propuestos para agregar'), 'los proyectos propuestos llegan a Para revisar');
  await page.click('#nav a[href="#ajustes"]');
  await page.waitForSelector('#aj-raices', { timeout: 3000 });
  assert.ok(await visible(page, 'text=Último escaneo'));
  // Interruptor de aprobación automática: desactivado por defecto, se guarda al cambiarlo.
  assert.equal(await page.getAttribute('#aj-auto', 'aria-checked'), 'false');
  await page.click('#aj-auto');
  await page.waitForTimeout(150);
  let w = (await writes()).filter((x) => x.path === 'config/settings').pop();
  assert.deepEqual(w.data, { autoApproveRules: true }, 'solo cambia ese ajuste');
  assert.equal(await page.getAttribute('#aj-auto', 'aria-checked'), 'true');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'aj-auto', 'el foco queda en el interruptor');
  if (CAPT) await page.screenshot({ path: join(CAPT, 'ajustes.png'), fullPage: true });
  await page.click('#nav a[href="#reglas"]');
  assert.ok(await visible(page, 'text=Se aprueba sola en la próxima corrida'), 'las propuestas avisan que se aprueban solas');
  assert.ok(await visible(page, 'text=Aprobación automática activa'));
  await page.click('#nav a[href="#inicio"]');
  assert.ok(await visible(page, 'text=reglas propuestas por aprobarse'));
  // Carpeta a escanear: "Guardar ajustes" también la guarda; "Guardar y escanear" además pide el escaneo.
  await page.click('#nav a[href="#ajustes"]');
  await page.fill('#aj-raices', 'Produccion, Clientes/Produccion');
  await page.click('[data-act="guardar-ajustes"]');
  await page.waitForTimeout(150);
  w = (await writes()).filter((x) => x.path === 'config/settings').pop();
  assert.deepEqual(w.data.discovery.rootFolders, ['Produccion', 'Clientes/Produccion']);
  assert.equal(w.data.autoApproveRules, true, 'guardar el formulario no pisa el interruptor');
  assert.ok(!(await writes()).some((x) => x.path.startsWith('requests/')), 'guardar no pide el escaneo');
  await page.click('[data-act="escanear"]');
  await page.waitForTimeout(150);
  assert.ok((await writes()).some((x) => x.path.startsWith('requests/') && x.data.type === 'discover_projects'));
  assert.ok(await visible(page, 'text=Escaneo pedido'));
  await page.click('[data-act="escanear"]');
  await page.waitForTimeout(150);
  assert.equal((await writes()).filter((x) => x.path.startsWith('requests/')).length, 1, 'no se pide dos veces el mismo escaneo');
  paso('ajustes: interruptor de aprobación automática, carpeta a escanear y pedido de escaneo');

  // Proyectos propuestos: ignorar los que no van, restaurarlos y registrar el resto de una vez.
  await page.evaluate(() => { location.hash = '#registrar'; });
  await page.waitForSelector('text=Proyectos propuestos', { timeout: 3000 });
  assert.equal(await page.locator('[data-act="registrar-detectada"]').count(), 3);
  await page.click('[data-act="ignorar-detectada"][data-folder="Produccion/Pruebas"]');
  await page.waitForTimeout(150);
  w = (await writes()).filter((x) => x.path === 'config/settings').pop();
  assert.deepEqual(w.data.discovery.ignoredFolders, ['Produccion/Pruebas']);
  assert.deepEqual(w.data.discovery.rootFolders, ['Produccion', 'Clientes/Produccion'], 'ignorar no pierde la carpeta a escanear');
  assert.equal(await page.locator('[data-act="registrar-detectada"]').count(), 2, 'la ignorada sale de la lista');
  assert.ok(await visible(page, 'text=1 carpeta ignorada'));
  if (CAPT) await page.screenshot({ path: join(CAPT, 'proyectos-propuestos.png'), fullPage: true });
  await page.click('[data-act="restaurar-ignoradas"]');
  await page.waitForTimeout(150);
  assert.equal(await page.locator('[data-act="registrar-detectada"]').count(), 3, 'vuelve a proponerse');
  await page.click('[data-act="ignorar-detectada"][data-folder="Produccion/Pruebas"]');
  await page.waitForTimeout(150);
  await page.click('[data-act="registrar-todos"]');
  assert.ok(await visible(page, 'text=¿Registrar los 2 proyectos propuestos?'));
  assert.equal(await page.evaluate(() => document.activeElement.id), 'reg-todos-ok');
  await page.click('[data-act="registrar-todos-ok"]');
  await page.waitForTimeout(300);
  const nuevos = (await writes()).filter((x) => x.path.startsWith('projects/') && x.op === 'set');
  assert.deepEqual(nuevos.map((x) => x.data.orchestrator.folderPath).sort(), ['Produccion/Compras/Ordenes', 'Produccion/Tesoreria/Pagos']);
  assert.ok(nuevos.every((x) => x.data.status === 'pending_analysis'), 'nada queda activo solo');
  assert.equal((await writes()).filter((x) => x.path.startsWith('requests/') && x.data.type === 'onboard_project').length, 2);
  assert.equal(await page.locator('[data-act="registrar-detectada"]').count(), 0, 'no quedan propuestas');
  assert.ok(await visible(page, 'text=Escaneo pedido: la próxima corrida propone acá'), 'sin propuestas, la pantalla dice qué falta');
  paso('proyectos propuestos: ignorar, restaurar y registrar todos con confirmación');
  await ctx.close();
}

// 1d) Admin: discrepancias de un proyecto (fuera de la bandeja) y documentación en Markdown.
{
  const { page, ctx } = await abrir();
  const writes = () => page.evaluate(() => window.__WRITES__);
  assert.equal(await page.locator('main .card', { hasText: 'SDD dice cada 30 minutos' }).count(), 0, 'las discrepancias no van a la bandeja');
  await page.click('#nav a[href="#proyectos"]');
  assert.ok(await visible(page, 'main a.rowi[href="#proyecto-facturacion"] >> text=2 discrepancias'), 'la lista de proyectos las cuenta');
  await page.click('main a.rowi[href="#proyecto-facturacion"]');
  await page.waitForSelector('#tab-discrepancias', { timeout: 3000 });
  assert.equal((await page.textContent('#tab-discrepancias')).trim(), 'Discrepancias (2)');
  assert.ok(await visible(page, 'text=2 discrepancias pendientes'));
  await page.click('#tab-discrepancias');
  await page.waitForSelector('.disc', { timeout: 3000 });
  assert.equal(await page.locator('.disc').count(), 2, 'pendientes: sin las respondidas ni las resueltas');
  if (CAPT) await page.screenshot({ path: join(CAPT, 'discrepancias.png'), fullPage: true });
  // Responder: pide una decisión y, si hay algo para corregir, ofrece cargar el ticket.
  const d1 = page.locator('.disc', { hasText: 'SDD dice cada 30 minutos' });
  await d1.locator('[data-act="disc-panel"][data-p="responder"]').click();
  assert.ok(await d1.locator('[data-act="disc-responder"]').isDisabled(), 'sin decisión no se envía');
  await d1.locator('[data-act="disc-sel"][data-v="fix_docs"]').click();
  await d1.locator('textarea').fill('El trigger está bien: se corrige el SDD');
  await d1.locator('input[id$="-dticket"]').fill('DOC-12');
  await d1.locator('[data-act="disc-responder"]').click();
  await page.waitForTimeout(200);
  let w = (await writes()).filter((x) => x.path === 'discrepancyWork/disc-facturacion-trigger').pop();
  assert.equal(w.data.state, 'responded');
  assert.deepEqual(w.data.response, { decision: 'fix_docs', notes: 'El trigger está bien: se corrige el SDD', ticket: 'DOC-12' });
  assert.equal(w.data.projectId, 'facturacion');
  assert.ok(w.data.updatedBy.startsWith('u_'), 'la persona se guarda como id');
  assert.equal(await page.locator('.disc').count(), 1, 'la respondida sale de pendientes');
  assert.equal((await page.textContent('#tab-discrepancias')).trim(), 'Discrepancias (1)');
  // Descartar con motivo.
  const d2 = page.locator('.disc', { hasText: 'asset de tolerancia' });
  await d2.locator('[data-act="disc-panel"][data-p="descartar"]').click();
  await d2.locator('[data-act="disc-sel"][data-v="already_fixed"]').click();
  await d2.locator('[data-act="disc-descartar"]').click();
  await page.waitForTimeout(200);
  w = (await writes()).filter((x) => x.path === 'discrepancyWork/disc-facturacion-asset').pop();
  assert.ok(w.data.state === 'dismissed' && w.data.dismissReason === 'already_fixed');
  assert.ok(await visible(page, 'text=Ninguna pendiente'));
  // Atendidas: respondidas, descartadas y resueltas, con quién y por qué; se pueden volver a abrir.
  await page.click('[data-act="seg"][data-k="disc"][data-v="atendidas"]');
  await page.waitForTimeout(150);
  assert.equal(await page.locator('.disc').count(), 4);
  assert.ok(await visible(page, 'text=Corregir la documentación — El trigger está bien'));
  assert.ok(await visible(page, 'text=Resuelta:'));
  if (CAPT) await page.screenshot({ path: join(CAPT, 'discrepancias-atendidas.png'), fullPage: true });
  assert.equal(await page.locator('.disc', { hasText: 'PDD no menciona' }).locator('[data-act="disc-reabrir"]').count(), 0, 'una resuelta por la rutina no se reabre a mano');
  await page.locator('.disc', { hasText: 'asset de tolerancia' }).locator('[data-act="disc-reabrir"]').click();
  await page.waitForTimeout(200);
  w = (await writes()).filter((x) => x.path === 'discrepancyWork/disc-facturacion-asset').pop();
  assert.equal(w.data.state, 'open'); assert.equal(w.data.dismissReason, undefined, 'se limpia el motivo');
  // Posponer.
  await page.click('[data-act="seg"][data-k="disc"][data-v="pendientes"]');
  await page.waitForTimeout(150);
  const d3 = page.locator('.disc', { hasText: 'asset de tolerancia' });
  await d3.locator('[data-act="disc-panel"][data-p="posponer"]').click();
  await d3.locator('[data-act="disc-posponer"][data-d="30"]').click();
  await page.waitForTimeout(200);
  w = (await writes()).filter((x) => x.path === 'discrepancyWork/disc-facturacion-asset').pop();
  assert.ok(w.data.state === 'snoozed' && w.data.snoozeUntil > new Date().toISOString());
  assert.ok(!(await writes()).some((x) => x.path.startsWith('incidentWork/') || x.path.startsWith('activity/')), 'no toca los incidentes');
  paso('discrepancias: tarjetas del proyecto fuera de la bandeja; responder, descartar, posponer y volver a abrir');

  // Documentación: subir un .docx, revisarlo convertido a Markdown y guardarlo.
  await page.click('#tab-documentacion');
  await page.waitForSelector('.doc', { timeout: 3000 });
  assert.equal(await page.locator('.doc').count(), 3, 'PDD, SDD y Runbook');
  assert.ok(await visible(page, '.doc >> text=Runbook Facturación.docx'), 'el documento ya cargado');
  await page.setInputFiles('#doc-f-facturacion-pdd', { name: 'PDD Facturación.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: docxDePrueba() });
  await page.waitForSelector('#doc-md-facturacion', { timeout: 5000 });
  const mdConv = await page.inputValue('#doc-md-facturacion');
  assert.equal(mdConv, [
    '# Process Definition Document', '', '## Propósito', '',
    'Registra las **facturas de proveedores** en el sistema contable.', '',
    'Dueño del proceso: escribir a [EMAIL] ante dudas.', '',
    '- Lee la cola', '- Registra la factura', '1. Verificar el login', '2. Escalar a soporte', '',
    '| Excepción | Descripción |', '| --- | --- |', '| BE001 | Factura duplicada \\| repetida |'].join('\n'), 'títulos por estilo, negrita, listas, tabla, sin índice y con el email enmascarado');
  assert.ok(await visible(page, 'text=Se enmascaró 1 dato'));
  assert.ok(!(await writes()).some((x) => x.path.startsWith('documents/')), 'no se guarda hasta confirmar');
  if (CAPT) await page.screenshot({ path: join(CAPT, 'documento-revision.png'), fullPage: true });
  // Lo que se edita antes de guardar también pasa por el enmascarado.
  await page.fill('#doc-md-facturacion', mdConv + '\n\nContacto: otra.persona@cliente.com');
  await page.click('[data-act="doc-guardar"]');
  await page.waitForTimeout(200);
  w = (await writes()).find((x) => x.path === 'documents/facturacion_pdd');
  assert.ok(w && w.op === 'set' && w.data.kind === 'pdd' && w.data.projectId === 'facturacion' && w.data.source === 'docx');
  assert.equal(w.data.fileName, 'PDD Facturación.docx');
  assert.ok(w.data.markdown.startsWith('# Process Definition Document') && w.data.markdown.endsWith('Contacto: [EMAIL]'));
  assert.ok(!/@cliente\.com/.test(w.data.markdown), 'sin emails en lo guardado');
  assert.equal(w.data.masked, 2);
  // Ver con formato y descargar como .md.
  await page.click('#doc-ver-facturacion-pdd');
  assert.ok(await visible(page, '.doc-view h2 >> text=Process Definition Document'));
  assert.equal(await page.locator('.doc-view table td').count(), 4, 'la tabla se dibuja');
  assert.equal(await page.locator('.doc-view ol li').count(), 2, 'lista numerada');
  assert.equal(await page.locator('.doc-view td', { hasText: 'Factura duplicada | repetida' }).count(), 1, 'la barra escapada queda dentro de la celda');
  if (CAPT) await page.screenshot({ path: join(CAPT, 'documentacion.png'), fullPage: true });
  await page.click('[data-act="doc-descargar"][data-kind="pdd"]');
  await page.waitForTimeout(150);
  const bajado = (await page.evaluate(() => window.__DOWNLOADS__)).pop();
  assert.equal(bajado.filename, 'facturacion-ejemplo-pdd.md', 'nombre del proyecto y tipo de documento, en .md');
  assert.equal(bajado.data, w.data.markdown);
  // Pegar texto en otro tipo de documento; un formato que no se puede convertir se rechaza con un aviso.
  await page.setInputFiles('#doc-f-facturacion-sdd', { name: 'SDD.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.7') });
  assert.ok(await visible(page, '#toast >> text=no se puede convertir'));
  await page.click('[data-act="doc-pegar"][data-kind="sdd"]');
  await page.fill('#doc-md-facturacion', '## Triggers\n\n- Cada 30 minutos');
  await page.click('[data-act="doc-guardar"]');
  await page.waitForTimeout(200);
  w = (await writes()).find((x) => x.path === 'documents/facturacion_sdd');
  assert.ok(w.data.source === 'paste' && w.data.markdown === '## Triggers\n\n- Cada 30 minutos');
  // Quitar pide confirmación.
  await page.click('#doc-q-facturacion-sdd');
  assert.ok(await visible(page, 'text=¿Quitar el SDD de este proyecto?'));
  await page.click('[data-act="doc-quitar-ok"]');
  await page.waitForTimeout(200);
  assert.ok((await writes()).some((x) => x.op === 'delete' && x.path === 'documents/facturacion_sdd'));
  assert.ok(await visible(page, '[data-act="reanalizar"] >> text=Pedir re-análisis'), 'ofrece re-analizar con los documentos nuevos');
  paso('documentación: subir .docx convertido a Markdown, revisar, enmascarar, guardar, ver, descargar .md, pegar y quitar');
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
  // Discrepancias: un Operador las responde; la documentación la ve y la descarga, pero no la cambia.
  await page.evaluate(() => { location.hash = '#proyecto-facturacion'; });
  await page.waitForSelector('#tab-discrepancias', { timeout: 3000 });
  await page.click('#tab-discrepancias');
  await page.waitForSelector('.disc', { timeout: 3000 });
  const d = page.locator('.disc', { hasText: 'SDD dice cada 30 minutos' });
  await d.locator('[data-act="disc-panel"][data-p="responder"]').click();
  await d.locator('[data-act="disc-sel"][data-v="expected"]').click();
  await d.locator('[data-act="disc-responder"]').click();
  await page.waitForTimeout(200);
  assert.ok((await page.evaluate(() => window.__WRITES__)).some((w) => w.path === 'discrepancyWork/disc-facturacion-trigger' && w.data.response.decision === 'expected'));
  await page.click('#tab-documentacion');
  await page.waitForSelector('.doc', { timeout: 3000 });
  assert.equal(await page.locator('.doc input[type=file], [data-act="doc-pegar"], [data-act="doc-quitar"]').count(), 0);
  assert.equal(await page.locator('[data-act="doc-ver"], [data-act="doc-descargar"]').count(), 2, 'ver y descargar');
  await page.evaluate(() => { location.hash = '#ajustes'; });
  assert.ok(await visible(page, 'text=Solo los Admin pueden ver los ajustes'));
  paso('operador: responde discrepancias; la documentación y los ajustes son del Admin');
  await ctx.close();
}

// 3) Lector: sin botones de acción.
{
  const { page, ctx } = await abrir({ role: 'lector' });
  assert.equal(await page.locator('[data-act="panel"]').count(), 0);
  await page.evaluate(() => { location.hash = '#proyecto-facturacion'; });
  await page.waitForSelector('#tab-discrepancias', { timeout: 3000 });
  await page.click('#tab-discrepancias');
  await page.waitForSelector('.disc', { timeout: 3000 });
  assert.equal(await page.locator('.disc').count(), 2);
  assert.equal(await page.locator('[data-act="disc-panel"], [data-act="disc-reabrir"]').count(), 0, 've las discrepancias sin acciones');
  paso('lector: solo lectura');
  await ctx.close();
}

// 4) Base vacía y sin db.
{
  const { page, ctx } = await abrir({ vacio: true });
  assert.ok(await visible(page, 'text=Todavía no hay proyectos'));
  assert.ok(await visible(page, 'text=Primeros pasos'), 'un tablero nuevo guía al Admin');
  // El primer paso lleva a Ajustes: indicar la carpeta y pedir el escaneo, aunque config/settings no exista todavía.
  await page.click('.pasos a[href="#ajustes"]');
  await page.waitForSelector('#aj-raices', { timeout: 3000 });
  await page.fill('#aj-raices', '/Produccion/, Clientes\\Produccion');
  await page.click('[data-act="escanear"]');
  await page.waitForTimeout(200);
  const wv = await page.evaluate(() => window.__WRITES__);
  const aj = wv.find((w) => w.path === 'config/settings');
  assert.equal(aj.op, 'set', 'crea los ajustes si no existían');
  assert.deepEqual(aj.data.discovery.rootFolders, ['Produccion', 'Clientes/Produccion'], 'rutas limpias');
  const req = wv.find((w) => w.path.startsWith('requests/'));
  assert.ok(req && req.data.type === 'discover_projects' && req.data.status === 'pending');
  assert.deepEqual(req.data.roots, ['Produccion', 'Clientes/Produccion']);
  assert.ok(await visible(page, 'text=Escaneo pedido'));
  if (CAPT) await page.screenshot({ path: join(CAPT, 'ajustes-tablero-nuevo.png'), fullPage: true });
  await page.click('#nav a[href="#inicio"]');
  assert.ok(await visible(page, '.pasos li.ok >> text=Ajustes'), 'el primer paso queda hecho');
  assert.ok(await visible(page, 'text=La próxima corrida escanea la carpeta'));
  await ctx.close();
  const o = await abrir({ vacio: true, role: 'operador' });
  assert.ok(await visible(o.page, 'text=Un Admin tiene que registrarlos'));
  assert.equal(await o.page.locator('.pasos').count(), 0, 'los primeros pasos son del Admin');
  await o.ctx.close();
  const r = await abrir({ sinDb: true });
  assert.ok(await visible(r.page, 'text=necesita una sesión'));
  await r.ctx.close();
  paso('tablero nuevo: primeros pasos, carpeta a escanear y pedido de escaneo; sin base');
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
  // Las pantallas nuevas: discrepancias y documentación de un proyecto, proyectos propuestos y Ajustes.
  await page.keyboard.press('Escape');
  const sinScroll = async (hash, sel, clic) => {
    await page.evaluate((h) => { location.hash = h; }, hash);
    await page.waitForSelector(clic || sel, { timeout: 3000 });
    if (clic) { await page.click(clic); await page.waitForSelector(sel, { timeout: 3000 }); }
    const w = await page.evaluate(() => document.documentElement.scrollWidth);
    assert.ok(w <= 390, `sin scroll horizontal en ${hash} ${clic || ''} (ancho ${w})`);
  };
  await sinScroll('#proyecto-facturacion', '.disc', '#tab-discrepancias');
  await page.click('.disc [data-act="disc-panel"][data-p="responder"]');
  await page.waitForSelector('.disc .panel', { timeout: 3000 });
  assert.ok((await page.evaluate(() => document.documentElement.scrollWidth)) <= 390, 'sin scroll horizontal con el panel de una discrepancia');
  if (CAPT) await page.screenshot({ path: join(CAPT, 'telefono-discrepancias.png'), fullPage: true });
  await sinScroll('#proyecto-facturacion', '.doc', '#tab-documentacion');
  if (CAPT) await page.screenshot({ path: join(CAPT, 'telefono-documentacion.png'), fullPage: true });
  await sinScroll('#registrar', '[data-act="registrar-detectada"]');
  await sinScroll('#ajustes', '#aj-auto');
  if (CAPT) await page.screenshot({ path: join(CAPT, 'telefono-ajustes.png'), fullPage: true });
  paso('teléfono: barra inferior, detalle a pantalla completa, sin scroll horizontal, tema oscuro');
  await ctx.close();
}

// 9) Idioma: un Admin cambia el tablero a inglés desde Ajustes; menús, pantallas y ayuda salen en inglés y vuelve a español.
{
  const { page, ctx } = await abrir();
  const writes = () => page.evaluate(() => window.__WRITES__);
  const texto = (sel) => page.evaluate((s) => document.querySelector(s).innerText, sel);
  // Lo que viene de la base (títulos, análisis) o del propio selector ("Español") no cuenta: solo la interfaz.
  const sinEspanol = async (sel, que) => {
    const t = (await texto(sel)).replace(/Español/g, '');
    assert.ok(!/[áéíóúñ¿¡]/i.test(t), `${que}: quedó texto en español: ${(t.match(/.{0,30}[áéíóúñ¿¡].{0,30}/i) || [''])[0]}`);
  };
  assert.equal(await page.evaluate(() => document.documentElement.lang), 'es');
  await page.click('#nav a[href="#ajustes"]');
  await page.waitForSelector('#aj-idioma-en', { timeout: 3000 });
  assert.equal(await page.getAttribute('#aj-idioma-es', 'aria-pressed'), 'true', 'por defecto está en español');
  await page.click('#aj-idioma-en');
  await page.waitForTimeout(250);
  const w = (await writes()).filter((x) => x.path === 'config/settings').pop();
  assert.deepEqual(w.data, { language: 'en' }, 'solo cambia el idioma');
  assert.equal(await page.getAttribute('#aj-idioma-en', 'aria-pressed'), 'true');
  assert.equal(await page.evaluate(() => document.documentElement.lang), 'en');
  assert.ok(await visible(page, 'h1 >> text=Settings'));
  assert.ok(await visible(page, '#nav >> text=Inbox'), 'el menú pasa a inglés');
  await sinEspanol('#nav', 'menú');
  await sinEspanol('#view', 'Ajustes');
  if (CAPT) await page.screenshot({ path: join(CAPT, 'ajustes-en.png'), fullPage: true });
  for (const h of ['#inicio', '#proyectos', '#reglas', '#corridas', '#no-reportados']) {
    await page.evaluate((x) => { location.hash = x; }, h);
    await page.waitForTimeout(150);
    await sinEspanol('#nav', h);
    assert.ok((await texto('#view h1')).trim().length > 0, `${h} tiene título`);
  }
  assert.ok(await visible(page, '#nav >> text=Inbox'));
  // La ayuda sale en el idioma activo, con sus vistas de ejemplo.
  await page.evaluate(() => { location.hash = '#ayuda'; });
  await page.waitForSelector('.ayuda', { timeout: 3000 });
  await sinEspanol('.ayuda', 'ayuda');
  assert.ok(await visible(page, '.ayuda >> text=Example with sample data'));
  // Tooltips en inglés.
  await page.evaluate(() => { location.hash = '#inicio'; });
  await page.waitForTimeout(150);
  // Volver a español.
  await page.evaluate(() => { location.hash = '#ajustes'; });
  await page.click('#aj-idioma-es');
  await page.waitForTimeout(250);
  assert.equal(await page.evaluate(() => document.documentElement.lang), 'es');
  assert.ok(await visible(page, 'h1 >> text=Ajustes'));
  assert.ok(await visible(page, '#nav >> text=Bandeja'));
  paso('idioma: el Admin cambia a inglés y vuelve a español; menú, pantallas y ayuda siguen el idioma');
  await ctx.close();
}

await browser.close();
for (const p of ok) console.log('ok -', p);
if (errores.length) { console.error('Errores de página:\n' + errores.join('\n')); process.exit(1); }
console.log(`\n${ok.length} pasos OK, sin errores de página`);
