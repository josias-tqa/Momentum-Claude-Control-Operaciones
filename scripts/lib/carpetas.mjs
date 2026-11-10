// Carpetas de Orchestrator a escanear (Ajustes → Proyectos a controlar).
// Un Admin indica una o más carpetas raíz; el descubrimiento propone como proyecto cada carpeta con
// procesos que esté adentro. Las rutas se comparan sin distinguir mayúsculas ni barras sobrantes.

export const limpiarCarpeta = (fp) => String(fp ?? '').trim().replace(/\\/g, '/').replace(/\/{2,}/g, '/').replace(/^\/+|\/+$/g, '');
const clave = (fp) => limpiarCarpeta(fp).toLowerCase();

// Acepta un array o un texto separado por comas o saltos de línea. Devuelve rutas limpias, sin repetidos.
export function listaDeCarpetas(v) {
  const xs = Array.isArray(v) ? v : String(v ?? '').split(/[,\n]/);
  const vistas = new Map(); // se conserva la primera forma en que se escribió cada carpeta
  for (const x of xs.map(limpiarCarpeta).filter(Boolean)) if (!vistas.has(x.toLowerCase())) vistas.set(x.toLowerCase(), x);
  return [...vistas.values()];
}

// Raíz que contiene a la carpeta (la más específica), o null si está fuera de todas.
export function raizDe(fp, raices) {
  const c = clave(fp);
  return raices.filter((r) => c === clave(r) || c.startsWith(clave(r) + '/')).sort((a, b) => b.length - a.length)[0] || null;
}

// Sin raíces configuradas no hay filtro: todo lo que ve la External App está "adentro".
export const dentroDe = (fp, raices) => !raices.length || raizDe(fp, raices) !== null;

export const mismaCarpeta = (a, b) => clave(a) === clave(b);
