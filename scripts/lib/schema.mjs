// Validador mínimo (sin dependencias) de un subconjunto de JSON Schema:
// type, required, properties, enum, items, maxLength, maxItems, minimum, maximum.
// Suficiente para asegurar que la rutina no escribe documentos mal formados en el tablero.
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function tipoDe(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (Number.isInteger(v)) return 'integer';
  return typeof v;
}

function coincideTipo(v, t) {
  const real = tipoDe(v);
  if (Array.isArray(t)) return t.some((x) => coincideTipo(v, x));
  if (t === 'number') return real === 'number' || real === 'integer';
  return real === t;
}

export function validar(valor, esquema, ruta = '$') {
  const errores = [];
  if (esquema.type && !coincideTipo(valor, esquema.type)) {
    errores.push(`${ruta}: se esperaba ${JSON.stringify(esquema.type)} y llegó ${tipoDe(valor)}`);
    return errores;
  }
  if (esquema.enum && !esquema.enum.includes(valor)) errores.push(`${ruta}: valor fuera de ${JSON.stringify(esquema.enum)}`);
  if (typeof valor === 'string' && esquema.maxLength && valor.length > esquema.maxLength) errores.push(`${ruta}: supera ${esquema.maxLength} caracteres`);
  if (typeof valor === 'number') {
    if (esquema.minimum !== undefined && valor < esquema.minimum) errores.push(`${ruta}: menor que ${esquema.minimum}`);
    if (esquema.maximum !== undefined && valor > esquema.maximum) errores.push(`${ruta}: mayor que ${esquema.maximum}`);
  }
  if (Array.isArray(valor)) {
    if (esquema.maxItems && valor.length > esquema.maxItems) errores.push(`${ruta}: más de ${esquema.maxItems} elementos`);
    if (esquema.items) valor.forEach((x, i) => errores.push(...validar(x, esquema.items, `${ruta}[${i}]`)));
  }
  if (valor && typeof valor === 'object' && !Array.isArray(valor)) {
    for (const r of esquema.required || []) if (valor[r] === undefined) errores.push(`${ruta}: falta '${r}'`);
    for (const [k, sub] of Object.entries(esquema.properties || {})) {
      if (valor[k] !== undefined && valor[k] !== null) errores.push(...validar(valor[k], sub, `${ruta}.${k}`));
    }
  }
  return errores;
}

let cache = null;
export function esquemas() {
  if (!cache) {
    cache = {};
    for (const f of readdirSync(join(RAIZ, 'schemas')).filter((n) => n.endsWith('.schema.json'))) {
      cache[f.replace('.schema.json', '')] = JSON.parse(readFileSync(join(RAIZ, 'schemas', f), 'utf8'));
    }
  }
  return cache;
}

// Colección de la db -> esquema. "config" se valida por documento.
export function esquemaPara(coleccion, docId) {
  const e = esquemas();
  if (coleccion === 'config') return e[`config-${docId}`] || null;
  return e[coleccion] || null;
}
