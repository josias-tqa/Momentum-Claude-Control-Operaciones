// Identidad de un "tema" de incidente. Dos hallazgos con el mismo fingerprint son el mismo
// problema y se acumulan en una sola tarjeta (no se muestran dos veces).
import { createHash } from 'node:crypto';

// Normaliza un mensaje de error para que varíen solo las partes que importan:
// sin GUIDs, fechas, horas, números, rutas de capturas ni comillas con valores.
export function normalizarFirma(mensaje) {
  if (!mensaje) return '';
  return String(mensaje)
    .toLowerCase()
    .replace(/\[[a-z-]+\]/g, '#')                          // marcadores de redacción
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '<guid>')
    .replace(/\d{4}-\d{2}-\d{2}[t ]?\d{0,2}:?\d{0,2}:?\d{0,2}(\.\d+)?z?/g, '<fecha>')
    .replace(/\d{1,2}[/:]\d{2}([/:]\d{2,4})?/g, '<hora>')
    .replace(/["'`][^"'`]{1,80}["'`]/g, '"…"')
    .replace(/screenshot:\s*\S+/g, 'screenshot:<ruta>')
    .replace(/\d+/g, '#')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);
}

export function fingerprint({ projectId, categoria, proceso, cola, firma }) {
  const base = [projectId || '', categoria || '', proceso || '', cola || '', normalizarFirma(firma)].join('|');
  return createHash('sha1').update(base).digest('hex').slice(0, 16);
}
