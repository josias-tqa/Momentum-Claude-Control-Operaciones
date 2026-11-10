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
| `config/settings` | Admin | Criterios de triage globales, matriz de severidad, retención, intervalo, minutos máximos en Pending, zona horaria. `autoApproveRules`: aprobación automática de reglas (apagada por defecto). `discovery`: carpetas de Orchestrator a escanear (`rootFolders`) y carpetas propuestas que un Admin ignoró (`ignoredFolders`) |
| `config/health`, `config/runlock` | Rutina | Última corrida, fallas consecutivas, uso de la base, marcas de la revisión de reglas (`rulesReview`); lock entre corridas |
| `projects/{id}` | Admin (alta y configuración) y rutina (salud, watermarks, inventario, emparejamiento) | Carpeta de Orchestrator, **procesos** (cada uno con su repo, su rol, su nombre en Orchestrator y, opcionalmente, su carpeta y su documentación), documentación común, `status`, criterios del proyecto, baseline. Detalle: `scripts/lib/proyecto.mjs` |
| `memory/{projectId}` | Rutina (Admin puede corregir) | `process`: memoria de proceso (mini-PDD). `productionSummary`: resumen rodante de la memoria de producción |
| `history/{id}` | Rutina | **Memoria de producción**, append-only y permanente |
| `rules/{id}` | Admin (crear, aprobar, editar, eliminar) y rutina (compilar, proponer y, con la aprobación automática activa, aprobar) | Regla en lenguaje natural, sus `exceptions` ("no aplica cuando…", escritas por personas), su `compiled`, `status` y `origin`. `autoApproved` marca las que aprobó la rutina |
| `runs/{runId}` | Solo rutina | Una corrida. Por proyecto trae la ventana, los conteos, cada check con su valor observado y los hallazgos con su triage |
| `incidents/{id}` | Solo rutina | Una tarjeta por tema. Guarda fingerprints, ocurrencias, recurrencias, evidencia redactada, triage (con su porqué) y análisis previo |
| `incidentWork/{incidentId}` | Operador o Admin | Lado humano: `state` (delegated, snoozed, dismissed, responded), asignado, motivo del descarte, respuesta |
| `activity/{id}` | Operador o Admin | Comentarios y acciones sobre una tarjeta, incluidos los cambios de regla hechos desde ella (`type: "rule"`) |
| `requests/{id}` | Operador o Admin | `onboard_project`, `reanalyze_project`, `reanalyze_incident`, `recompile_rule`, `discover_projects` (escanear la carpeta de Ajustes) |
| `libraries/{slug}` | Solo rutina | Catálogo de librerías propias: versiones en uso, actividades de cada una, si trae fuentes |
| `config/discovery` | Rutina | **Proyectos propuestos**: carpetas con procesos, dentro de las carpetas a escanear, que todavía no son un proyecto. Trae las raíces usadas (`roots`) y, si hubo un problema de acceso, un aviso (`note`). Se actualiza cuando un Admin pide el escaneo y una vez por día |
| `discrepancies/{id}` | Solo rutina | Una tarjeta por **discrepancia** de un proyecto: lo que no coincide entre código, documentación y Orchestrator. `status` dice si la rutina la sigue detectando (`open`) o no (`resolved`) |
| `discrepancyWork/{discrepancyId}` | Operador o Admin | Lado humano de una discrepancia: `state` (snoozed, dismissed, responded, open), motivo del descarte, respuesta |
| `documents/{id}` | Admin | Un documento de un proyecto subido a mano, **en Markdown** (`markdown`): su categoría (`kind`: `pdd`, `sdd`, `runbook` u `other`), un título opcional, el archivo de origen y cuántos datos se enmascararon. Tantos como haga falta por proyecto, de hasta 230 KB cada uno |
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

## Discrepancias de un proyecto

Son otro tipo de tarjeta: viven en la página del proyecto (pestaña **Discrepancias**) y **no pasan por la bandeja** ni cambian la salud del proyecto.

1. `/control-alta-proyecto` (alta o re-análisis) lista lo que no coincide, con una `key` estable por discrepancia.
2. `scripts/consolidar-discrepancias.mjs` lo une con lo que ya hay. El id es `disc-<proyecto>-<hash de la key>`:
   - nueva: se crea `open`;
   - ya conocida: suma una detección (`seenCount`, `lastSeenAt`);
   - `open` que el análisis ya no encuentra: pasa a `resolved` ("ya no se detecta");
   - `resolved` que vuelve a detectarse: vuelve a `open`. Si nadie la había dado por cerrada, además lleva `reopenedAt`.
3. El equipo la responde, la descarta o la pospone: el tablero escribe `discrepancyWork/{id}`. La rutina nunca escribe ese documento.
4. Una discrepancia está **pendiente** en el tablero si está `open` y no tiene una respuesta, un descarte o una posposición vigente, o si reapareció (`reopenedAt`) después de esa respuesta. Una discrepancia descartada, o respondida "es correcto así", no vuelve a mostrarse como nueva.
5. `/control-aprendizaje` anota cada respuesta en `history` (`type: "discrepancy"`) y marca `learning` en la discrepancia. El siguiente re-análisis la tiene en cuenta en la memoria de proceso.

| Respuesta (`response.decision`) | Descarte (`dismissReason`) |
|---|---|
| `fix_docs`, `fix_orchestrator`, `fix_code`, `expected`, `escalate_dev` | `expected`, `false_positive`, `already_fixed`, `not_relevant` |

## Documentos subidos a mano

Un Admin sube documentos desde la pestaña **Documentación** del proyecto: tantos como quiera, cada uno con una categoría (PDD, SDD, Runbook u Otro) y un título opcional. El tablero los convierte a Markdown en el navegador y los guarda en `documents/{id}` (`<proyecto>_<sufijo>`):

- `.docx`: títulos, párrafos, negritas, listas y tablas; sin imágenes. Sin librerías.
- `.pdf`: solo el texto, con pdf.js (se baja de cdnjs recién al subir un PDF). Los títulos se deducen del tamaño de letra y las tablas quedan como texto corrido.
- `.md`, `.txt` o texto pegado: como están.

- **PII:** antes de guardar se enmascaran emails, números de documento, CUIT/NIT y usuarios de Windows, con los mismos patrones de `config/patrones-pii.json` (los verifica `tests/scripts.test.mjs`). Los nombres de personas no se pueden detectar: el Admin revisa el Markdown antes de confirmar.
- La rutina los lee en `/control-alta-proyecto` y `/control-analisis`, solo del proyecto que está mirando, y **no copia** a la memoria ni a los análisis nada que identifique a una persona.
- En un `import`, pasan por `build-writes` como cualquier otro documento.

### Documentos del paquete

Los documentos que vienen dentro de cada paquete publicado quedan listados en `projects/{id}.inventory.processes[].docs` (los registra `indexar-codigo.mjs`) y el tablero los muestra en la misma pestaña. Un Admin puede desactivar cualquiera: el tablero guarda `"<proceso de Orchestrator>:<ruta>"` en `projects/{id}.disabledDocs`, y `scripts/fetch-codigo.mjs` borra esos archivos de lo que extrae, así que ni el alta ni el análisis previo los leen.

## Proyectos propuestos (escaneo de carpetas)

1. Un Admin escribe en Ajustes la carpeta de Orchestrator a escanear (`config/settings.discovery.rootFolders`) y toca **Guardar y escanear**: el tablero crea una solicitud `discover_projects`.
2. La próxima corrida ejecuta `/control-descubrir` en modo proponer (`scripts/descubrir.mjs --ajustes … --plan-tablero …`) y escribe `config/discovery`. El descubrimiento diario lo repite.
3. El tablero muestra como **proyecto propuesto** cada carpeta de `config/discovery.folders` que no esté registrada ni en `discovery.ignoredFolders`. El Admin registra (una o todas) o ignora. Nada se registra solo.

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

## Propuestas de la rutina sobre reglas

`/control-reglas` propone, y un Admin decide. Por defecto nada se activa solo.

**Aprobación automática.** Si `config/settings.autoApproveRules` es `true` (interruptor de Ajustes), las reglas se activan en el momento. `scripts/build-writes.mjs` convierte en `active` toda regla que un plan crea como `proposed` (con `approvedBy: "rutina"` y `autoApproved: true`), así que vale para cualquier skill. Al encender el interruptor, el tablero aprueba las que estaban esperando, y `scripts/aprobar-reglas.mjs` barre al empezar cada corrida las que hayan quedado. Los cambios sugeridos (`suggestion`) nunca se aplican solos.

| Cuándo | Qué busca | Qué deja |
|---|---|---|
| Cuando una regla se aprueba o se edita (se mira en cada corrida) | Otros procesos que comparten un sistema con el de la regla: portal (`web:`), aplicación (`app:`) o librería propia (`lib:`) | Regla `proposed` con `origin: "similar"`, `sourceRuleId` y `why` |
| Una vez por día, con los últimos 30 días | Regla que dispara y se descarta casi siempre | `suggestion` en la regla: una excepción o un texto nuevo |
| | Regla cuyos incidentes se posponen y nunca requieren fix | `suggestion` de severidad |
| | Regla activa que no dispara hace 60 días | `suggestion` de desactivarla |
| | Tema sin regla descartado 2 veces o más, o aviso que se repite en 5 corridas sin que nadie lo mire | Regla `proposed` con `origin: "review"` y `why` |

- Los **sistemas** de cada proceso salen del código del paquete desplegado (hosts de las URLs y ejecutables de los selectores) y quedan en `projects/{id}.inventory.processes[].systems`. Lo que usan todos los procesos no cuenta como similitud.
- **Topes:** 3 propuestas por proyecto por vez, y ninguna si el proyecto ya tiene 5 sin resolver.
- **No se repite:** `proposalKey` identifica cada propuesta. Una rechazada no vuelve; una sugerencia descartada (`dismissedSuggestions`) no vuelve por 90 días.
- El cálculo de candidatos es determinista (`scripts/sugerir-reglas.mjs`); Claude decide cuáles valen la pena y los redacta.

## Presupuesto de documentos (estimado para 10 proyectos)

| Colección | Volumen | Con retención |
|---|---|---|
| `runs` | 24 por día | 60 días: alrededor de 1.440 |
| `incidents` + `incidentWork` + `activity` | Depende de la estabilidad; el dedupe evita repetidos | Cerrados a los 180 días: unos pocos miles |
| `history` | Solo eventos relevantes | Permanente: cientos por año |
| `discrepancies` + `discrepancyWork` | Unas pocas por proyecto | Las resueltas se borran a los 180 días |
| `documents` | Unos pocos por proyecto | Permanente: decenas |
| `rollups` | 1 por proyecto y por mes | 120 por año |

Si el total pasa 15.000 documentos, `/control-mantenimiento` avisa en `config/health` y achica la retención.
