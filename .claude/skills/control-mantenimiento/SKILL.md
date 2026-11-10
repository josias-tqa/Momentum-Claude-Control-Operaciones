---
name: control-mantenimiento
description: Mantenimiento de la base del tablero de la Torre de Control - retención (borra corridas e incidentes cerrados viejos dejando un resumen mensual), seed de la configuración inicial, y export/import de proyectos, memorias y reglas para la entrega a Momentum. Usar con "retencion" una vez por día desde /control-corrida, con "seed" al publicar un tablero nuevo, o con "export"/"import" al migrar.
---

# Mantenimiento

El argumento elige la tarea: `retencion` | `seed` | `export` | `import`.

## retencion (diaria)

La base admite **25.000 documentos**. Se mantiene lejos de ese límite así:

1. Leé `config/settings.retention`. Valores por defecto: `runsDays: 60`, `closedIncidentsDays: 180`.
2. **Corridas:** `query` de `runs` con `startedAt < hoy - runsDays`, y `delete` en lotes de 50.
3. **Incidentes cerrados:** `query` con `status == closed` y `closedAt < hoy - closedIncidentsDays`.
   1. Por cada mes y proyecto, armá o actualizá `rollups/<projectId>_<AAAA-MM>` con:
      - `counts` por categoría, severidad y decisión;
      - `incidents: [{id, title, severity, decision, outcome}]`. `outcome` es el tipo de `history` con el que se cerró.
   2. Después borrá los incidentes, su `incidentWork` y su `activity` (`query` de `activity` con `incidentId in [...]`).
   3. La memoria de producción (`history`) **no se borra nunca**.
4. **Discrepancias resueltas:** `query` de `discrepancies` con `status == resolved` y `resolvedAt < hoy - closedIncidentsDays`. Borralas junto con su `discrepancyWork/<mismo id>`. Las abiertas no se borran nunca, aunque estén descartadas: así un re-análisis no las vuelve a mostrar como nuevas.
5. Guardá en `config/health.dbDocs` el conteo por colección (`list` con `limit: 1`) y el total.
   - Si el total pasa 15.000, poné un aviso en `config/health.warning` y bajá la retención a la mitad.

## descubrimiento diario (desde `retencion`)

Una vez por día, actualizá los proyectos propuestos que ve el tablero: las carpetas con procesos que todavía no son un proyecto, dentro de la carpeta que el Admin indicó en Ajustes (`config/settings.discovery.rootFolders`):
```bash
node scripts/descubrir.mjs --salida work/$RUN/descubrimiento.json --registrados work/$RUN/db/projects \
  --ajustes work/$RUN/db/config/settings.json --plan-tablero work/$RUN/discovery-plan.json
node scripts/build-writes.mjs --plan work/$RUN/discovery-plan.json --salida work/$RUN/lotes-discovery
```
Publicalo con `ArtifactData`. Si `config/discovery` ya existe, pasá su versión como `if_version`. Si en esta corrida ya se atendió una solicitud `discover_projects`, no hace falta repetirlo. También borrá de `libraries/*` las versiones que ya no usa ningún proyecto.

## seed (tablero nuevo)

1. `set` de `config/settings` con el contenido de `seed/settings.json`, solo si el documento no existe. Trae la aprobación automática de reglas apagada y ninguna carpeta a escanear.
   - Si el documento ya existe pero no tiene criterios (`triageCriteria` vacío: un Admin guardó la carpeta a escanear antes del seed), completá con `update` los campos del seed que falten. No toques `discovery` ni `autoApproveRules`.
2. `set` de `config/health` con `{consecutiveFailures: 0}`.
3. No se crean proyectos ni reglas de ejemplo: los registra el equipo. El primer paso del Admin es indicar en Ajustes la carpeta de Orchestrator a escanear (`docs/cliente-nuevo.md`).

## export (antes de la entrega)

1. `list` con `out_dir: work/export/<fecha>` de `projects`, `memory`, `rules` (las `active` y `proposed`), `history`, `config`, `documents`, `discrepancies` y `discrepancyWork`.
2. **No** se exportan `incidents`, `incidentWork`, `activity`, `runs` ni `requests`: son datos de prueba. Tampoco `config/discovery` ni `config/runlock`.
3. Limpieza:
   - de `projects` se quitan `watermarks` y `health`;
   - en `rules`, `history`, `documents` y `discrepancyWork` se reemplazan los `createdBy`, `approvedBy`, `by`, `uploadedBy` y `updatedBy` que sean IDs de personas por `"migrado"`. Los IDs de un owner no sirven en el artifact de otro owner;
   - de `config/settings` se quita `discovery`: la carpeta a escanear es de cada tenant.

## import (en el tablero nuevo de Momentum)

1. Antes, `seed`.
2. Por cada documento exportado, un `set` validado con `build-writes`. `projects` entra con `status: "review"`, para que el Admin de Momentum lo revise y active.
3. Si `build-writes` marca PII en un `documents` (los subió una persona y solo pasaron por el enmascarado básico del tablero), pasá su `markdown` por `redactarTexto(texto, { largo: Infinity })` de `scripts/lib/redact.mjs` y repetí. No lo publiques sin validar.
