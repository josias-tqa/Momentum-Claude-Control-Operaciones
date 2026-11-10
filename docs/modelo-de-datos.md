# Modelo de datos del tablero

La base de datos del artifact es la fuente de verdad. Está formada por colecciones de primer nivel, con documentos JSON. Los esquemas están en `schemas/` y los valida `scripts/build-writes.mjs`.

Límites de la plataforma:
- 25.000 documentos por artifact.
- 256 KiB por documento.
- 64 reglas de acceso.

## Quién escribe qué

Las reglas de acceso están en `dashboard/capabilities.json` y las aplica la plataforma.

| Colección | Escribe | Contenido |
|---|---|---|
| `config/settings` | Admin | Criterios de triage globales, matriz de severidad, retención, intervalo, minutos máximos en Pending, zona horaria |
| `config/health`, `config/runlock` | Rutina | Última corrida, fallas consecutivas, uso de la base; lock entre corridas |
| `projects/{id}` | Admin (alta y configuración) y rutina (salud, watermarks, inventario, emparejamiento) | Carpeta de Orchestrator, **procesos** (cada uno con su repo, su rol, su nombre en Orchestrator y, opcionalmente, su carpeta y su documentación), documentación común, `status`, criterios del proyecto, baseline. Detalle: `scripts/lib/proyecto.mjs` |
| `memory/{projectId}` | Rutina (Admin puede corregir) | `process`: memoria de proceso (mini-PDD). `productionSummary`: resumen rodante de la memoria de producción |
| `history/{id}` | Rutina | **Memoria de producción**, append-only y permanente |
| `rules/{id}` | Admin (crear, aprobar, editar, eliminar) y rutina (compilar, proponer) | Regla en lenguaje natural, sus `exceptions` ("no aplica cuando…", escritas por personas), su `compiled`, `status` y `origin` |
| `runs/{runId}` | Solo rutina | Una corrida. Por proyecto trae la ventana, los conteos, cada check con su valor observado y los hallazgos con su triage |
| `incidents/{id}` | Solo rutina | Una tarjeta por tema. Guarda fingerprints, ocurrencias, recurrencias, evidencia redactada, triage (con su porqué) y análisis previo |
| `incidentWork/{incidentId}` | Operador o Admin | Lado humano: `state` (delegated, snoozed, dismissed, responded), asignado, motivo del descarte, respuesta |
| `activity/{id}` | Operador o Admin | Comentarios y acciones sobre una tarjeta, incluidos los cambios de regla hechos desde ella (`type: "rule"`) |
| `requests/{id}` | Operador o Admin | `onboard_project`, `reanalyze_project`, `recompile_rule` |
| `libraries/{slug}` | Solo rutina | Catálogo de librerías propias: versiones en uso, actividades de cada una, si trae fuentes |
| `config/discovery` | Rutina | Carpetas con procesos que todavía no son un proyecto (se actualiza una vez por día) |
| `rollups/{projectId}_{AAAA-MM}` | Solo rutina | Resumen mensual que queda cuando la retención depura |
| `data/users/{id}/…` | Cada persona, lo suyo | Preferencias (no se usa todavía) |

Las personas se guardan **solo** como IDs opacos (`u_…`). Los nombres los resuelve la plataforma al mostrar, con el permiso que dio el usuario.

## Ciclo de vida de una tarjeta

1. `evaluate.mjs` produce un hallazgo con un fingerprint, que es el tema.
2. `consolidar.mjs`:
   - si el tema ya tiene un incidente abierto, suma la ocurrencia (`occurrences`, `recurrences`);
   - si el tema se cerró hace 30 días o menos, **reabre la misma tarjeta**;
   - si no, crea un incidente nuevo `inc-AAAAMMDD-<fp8>`.
3. Una tarjeta aparece en la bandeja si cumple todo esto:
   - el incidente está `open`;
   - la decisión es `escalate` o `notify`;
   - el `incidentWork` no está `dismissed` ni `responded`;
   - no está pospuesta, salvo que la severidad haya subido después de posponerla.
4. `/control-aprendizaje` convierte la respuesta humana en una entrada de `history`. Según la respuesta, cierra el incidente o lo deja abierto (fix pendiente, re-control) y puede proponer una regla.

## Editar una regla

Un Admin edita una regla desde la tarjeta del incidente que la disparó o desde la lista de reglas. El tablero escribe en `rules/{id}`:

| Cambio | Qué escribe | Cuándo vale |
|---|---|---|
| Severidad | `compiled.severity` | Al guardar: la usa la próxima evaluación |
| Texto | `text` y `status: "pending_compile"` | La próxima corrida vuelve a traducir la regla (conserva la severidad) |
| Excepción | `exceptions[]` (`{text, by, at, incidentId}`) y `status: "pending_compile"` | La próxima corrida la traduce a `compiled.exceptions[].filter`; si no se puede, la aplica el triage |
| Desactivar | `status: "disabled"` | Al guardar |
| Eliminar | Borra el documento | Al guardar. No se puede deshacer |

Guardar una regla `proposed`, `disabled` o `rejected` la aprueba o reactiva. Un incidente que no salió de una regla ofrece **Crear regla**: nace `pending_compile`, con `sourceIncidentId`.

## Presupuesto de documentos (estimado para 10 proyectos)

| Colección | Volumen | Con retención |
|---|---|---|
| `runs` | 24 por día | 60 días: alrededor de 1.440 |
| `incidents` + `incidentWork` + `activity` | Depende de la estabilidad; el dedupe evita repetidos | Cerrados a los 180 días: unos pocos miles |
| `history` | Solo eventos relevantes | Permanente: cientos por año |
| `rollups` | 1 por proyecto y por mes | 120 por año |

Si el total pasa 15.000 documentos, `/control-mantenimiento` avisa en `config/health` y achica la retención.
