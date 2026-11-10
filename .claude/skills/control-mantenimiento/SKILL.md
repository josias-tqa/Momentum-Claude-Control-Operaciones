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
4. Guardá en `config/health.dbDocs` el conteo por colección (`list` con `limit: 1`) y el total.
   - Si el total pasa 15.000, poné un aviso en `config/health.warning` y bajá la retención a la mitad.

## descubrimiento diario (desde `retencion`)

Una vez por día, actualizá la lista de carpetas sin registrar que ve el tablero:
```bash
node scripts/descubrir.mjs --salida work/$RUN/descubrimiento.json --registrados work/$RUN/db/projects --plan-tablero work/$RUN/discovery-plan.json
node scripts/build-writes.mjs --plan work/$RUN/discovery-plan.json --salida work/$RUN/lotes-discovery
```
Publicalo con `ArtifactData`. Si `config/discovery` ya existe, pasá su versión como `if_version`. También borrá de `libraries/*` las versiones que ya no usa ningún proyecto.

## seed (tablero nuevo)

1. `set` de `config/settings` con el contenido de `seed/settings.json`, solo si el documento no existe.
2. `set` de `config/health` con `{consecutiveFailures: 0}`.
3. No se crean proyectos ni reglas de ejemplo: los registra el equipo.

## export (antes de la entrega)

1. `list` con `out_dir: work/export/<fecha>` de `projects`, `memory`, `rules` (las `active` y `proposed`), `history` y `config`.
2. **No** se exportan `incidents`, `incidentWork`, `activity`, `runs` ni `requests`: son datos de prueba.
3. Limpieza:
   - de `projects` se quitan `watermarks` y `health`;
   - en `rules` y `history` se reemplazan los `createdBy`, `approvedBy` y `by` que sean IDs de personas por `"migrado"`. Los IDs de un owner no sirven en el artifact de otro owner.

## import (en el tablero nuevo de Momentum)

1. Antes, `seed`.
2. Por cada documento exportado, un `set` validado con `build-writes`. `projects` entra con `status: "review"`, para que el Admin de Momentum lo revise y active.
