// Redacción de PII: todo dato que venga de Orchestrator pasa por aquí ANTES de escribirse
// en el tablero (política de la organización: no se publica PII de clientes ni de empleados
// externos). Reglas:
//  - Textos libres (mensajes de log, motivos de excepción): se enmascaran con config/patrones-pii.json.
//  - Queue items: NUNCA se guarda SpecificContent/SpecificData/Output; solo los NOMBRES de sus claves.
//    La Reference se reemplaza por un hash corto (permite agrupar sin exponer el valor).
//  - Assets: solo nombre y tipo; el campo Value se descarta siempre.

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { normalizarFirma } from './fingerprint.mjs';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
let patrones = null;

function cargarPatrones() {
  if (!patrones) {
    const cfg = JSON.parse(readFileSync(join(RAIZ, 'config', 'patrones-pii.json'), 'utf8'));
    patrones = cfg.patrones.map((p) => ({ ...p, re: new RegExp(p.regex, p.flags || 'g') }));
  }
  return patrones;
}

export const LARGO_MAXIMO_TEXTO = 600;

// Los errores de UI de UiPath traen un bloque fijo "Possible solutions: • … • …" que ocupa casi todo el
// espacio y deja afuera el final ("at source: <actividad>"), que es lo que dice dónde falló. Se quita.
export function compactarMensajeUiPath(texto) {
  if (texto === null || texto === undefined) return texto;
  return String(texto)
    .replace(/\s*Possible solutions:[\s\S]*?(?=\s*\bat\s+[Ss]ource:|$)/g, ' ')
    .replace(/[ \t]*\r?\n[ \t]*/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export function redactarTexto(texto, { largo = LARGO_MAXIMO_TEXTO } = {}) {
  if (texto === null || texto === undefined) return texto;
  let s = String(texto);
  for (const p of cargarPatrones()) s = s.replace(p.re, p.reemplazo);
  if (s.length > largo) s = s.slice(0, largo) + '…';
  return s;
}

export function hashCorto(valor) {
  if (valor === null || valor === undefined || valor === '') return null;
  return createHash('sha256').update(String(valor)).digest('hex').slice(0, 10);
}

function textoExcepcion(pe) {
  if (!pe) return null;
  if (typeof pe === 'string') return pe;
  return pe.Reason || pe.reason || pe.Message || pe.message || null;
}

function tipoExcepcion(item) {
  const t = item.ProcessingExceptionType || (item.ProcessingException && (item.ProcessingException.Type || item.ProcessingException.type));
  if (!t) return null;
  const s = String(t);
  if (/business/i.test(s)) return 'Business';
  if (/application|system/i.test(s)) return 'Application';
  return s;
}

export function sanitizarQueueItem(item, cola) {
  const pe = item.ProcessingException;
  return {
    id: item.Id ?? null,
    key: item.Key ?? null,
    cola: cola || (item.QueueDefinition && item.QueueDefinition.Name) || null,
    estado: item.Status ?? null,
    tipoExcepcion: tipoExcepcion(item),
    motivo: redactarTexto(compactarMensajeUiPath(textoExcepcion(pe))),
    firmaV1: normalizarFirma(redactarTexto(textoExcepcion(pe))),
    detalle: pe && typeof pe === 'object' && pe.Details ? redactarTexto(pe.Details, { largo: 300 }) : null,
    referenciaHash: hashCorto(item.Reference),
    reintento: item.RetryNumber ?? null,
    creado: item.CreationTime ?? null,
    inicio: item.StartProcessing ?? null,
    fin: item.EndProcessing ?? null,
    jobKey: item.ExecutorJobKey ?? null,
    camposContenido: item.SpecificContent && typeof item.SpecificContent === 'object' ? Object.keys(item.SpecificContent).sort() : [],
  };
}

export function sanitizarAsset(asset) {
  // Hay nombres de assets que incluyen números de documento (p. ej. credenciales por usuario): se enmascaran.
  const nombre = asset.Name == null ? null : redactarTexto(String(asset.Name)).replace(/\d{6,}/g, '<id>');
  return { nombre, tipo: asset.ValueType ?? null, alcance: asset.ValueScope ?? null };
}

export function sanitizarJob(job) {
  return {
    key: job.Key ?? null,
    proceso: job.ProcessName ?? null,
    estado: job.State ?? null,
    origen: job.Source ?? null,
    creado: job.CreationTime ?? null,
    inicio: job.StartTime ?? null,
    fin: job.EndTime ?? null,
    maquina: job.HostMachineName ?? null,
    releaseKey: job.ReleaseKey ?? null,
    info: job.Info ? redactarTexto(job.Info) : null,
  };
}

export function sanitizarLog(linea, jobKey) {
  return {
    jobKey: jobKey ?? null,
    nivel: linea.Level ?? null,
    mensaje: redactarTexto(compactarMensajeUiPath(linea.Message)),
    // Firma con el formato anterior (sin compactar): solo para no duplicar tarjetas abiertas antes del cambio.
    firmaV1: normalizarFirma(redactarTexto(linea.Message)),
    fecha: linea.TimeStamp ?? null,
  };
}

// Verificación defensiva: falla si en un objeto a escribir aparece algo que parece PII.
// Se usa en build-writes antes de mandar nada al tablero.
export function detectarPii(obj) {
  const hallazgos = [];
  const texto = JSON.stringify(obj);
  for (const p of cargarPatrones()) {
    if (['numero_largo', 'ip', 'dni_documento', 'telefono', 'tarjeta'].includes(p.nombre)) continue; // demasiados falsos positivos con ids/fechas
    const re = new RegExp(p.regex, p.flags || 'g');
    const m = texto.match(re);
    if (m) hallazgos.push({ patron: p.nombre, ejemplo: m[0].slice(0, 6) + '…' });
  }
  return hallazgos;
}
