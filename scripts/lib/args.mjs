// Utilidades mínimas de línea de comandos y archivos.
import { readFileSync } from 'node:fs';

export function arg(nombre, argv = process.argv.slice(2)) {
  const i = argv.indexOf(nombre);
  return i >= 0 && argv[i + 1] !== undefined && !argv[i + 1].startsWith('--') ? argv[i + 1] : undefined;
}

export function bandera(nombre, argv = process.argv.slice(2)) {
  return argv.includes(nombre);
}

export function leerJson(ruta, porDefecto) {
  try {
    return JSON.parse(readFileSync(ruta, 'utf8'));
  } catch (e) {
    if (porDefecto !== undefined) return porDefecto;
    throw new Error(`No se pudo leer ${ruta}: ${e.message}`);
  }
}

// Documentos exportados con ArtifactData (out_dir) traen el cuerpo directo o envuelto
// en { id, version, data }. Esto devuelve siempre { id, version, ...data }.
export function desenvolver(doc, idPorDefecto) {
  if (doc && typeof doc === 'object' && doc.data && typeof doc.data === 'object' && (doc.version !== undefined || doc.id !== undefined)) {
    return { ...doc.data, id: doc.id ?? idPorDefecto, __version: doc.version ?? null };
  }
  return { ...doc, id: (doc && doc.id) || idPorDefecto, __version: (doc && doc.__version) ?? null };
}
