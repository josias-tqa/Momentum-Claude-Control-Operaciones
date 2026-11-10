// Inserta los catálogos de dashboard/i18n/*.json en dashboard/index.html (bloque I18N).
// Uso: npm run build:i18n · npm run check:i18n (falla si el bloque está viejo).
import { readFileSync, writeFileSync } from 'node:fs';
import { TABLERO, MARCA_INICIO } from './lib/ayuda.mjs';
import { IDIOMAS, leerCatalogo, hashI18n, MARCA_I18N_INICIO, MARCA_I18N_FIN } from './lib/i18n.mjs';

export function construirI18n() {
  const scripts = IDIOMAS.map((l) => {
    const cat = leerCatalogo(l);
    const ordenado = Object.fromEntries(Object.keys(cat).sort().map((k) => [k, cat[k]]));
    return `<script type="application/json" id="i18n-${l}">${JSON.stringify(ordenado).replace(/<\//g, '<\\/')}</script>`;
  });
  return `${MARCA_I18N_INICIO} sha256=${hashI18n()} · generado por scripts/build-i18n.mjs desde dashboard/i18n/*.json: no editar a mano -->\n${scripts.join('\n')}\n${MARCA_I18N_FIN}`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const tablero = readFileSync(TABLERO, 'utf8');
  const bloque = construirI18n();
  let nuevo;
  const i = tablero.indexOf(MARCA_I18N_INICIO); const j = tablero.indexOf(MARCA_I18N_FIN);
  if (i >= 0 && j > i) nuevo = tablero.slice(0, i) + bloque + tablero.slice(j + MARCA_I18N_FIN.length);
  else { // primera vez: se inserta justo antes del bloque de la ayuda
    const k = tablero.indexOf(MARCA_INICIO);
    if (k < 0) throw new Error('No está el marcador AYUDA:INICIO en dashboard/index.html');
    nuevo = tablero.slice(0, k) + bloque + '\n\n' + tablero.slice(k);
  }
  if (process.argv.includes('--check')) {
    if (nuevo !== tablero) { console.error('Los textos de dashboard/index.html no están al día: corré npm run build:i18n'); process.exit(1); }
    console.log('Textos (i18n) al día');
  } else {
    writeFileSync(TABLERO, nuevo);
    console.log(`i18n generado: ${IDIOMAS.map((l) => `${l}=${Object.keys(leerCatalogo(l)).length}`).join(' ')} claves`);
  }
}
