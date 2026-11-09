---
name: control-corrida
description: Corrida de control de la Torre de Control. Revisa cada proyecto UiPath activo en Orchestrator, detecta y clasifica incidentes (triage) con los criterios y la memoria de cada proyecto, analiza los que requieren intervención y publica todo en el tablero. Usar cuando lo dispara la rutina programada, cuando alguien pide "correr el control" o "revisar los proyectos ahora", o con --dry-run para probar con fixtures.
---

# Corrida de control

Leé primero `CLAUDE.md`: solo lectura, cero cambios de código y PII redactada.
La URL del tablero está en `OPS_ARTIFACT_URL`. Usala **sin parámetros**: si trae `?sk=…`, quitáselo antes de pasarla a `ArtifactData`. `RUN` es `run-<AAAAMMDD>T<HHMM>Z`, en UTC, al inicio.
Todo lo intermedio va en `work/$RUN/`.

**Modo `--dry-run`:**
- No se lee ni se escribe el tablero.
- Se copia `fixtures/tenant-ejemplo/db` a `work/$RUN/db` y se exporta `OPS_FIXTURES=fixtures/tenant-ejemplo/uip`.
- Se usa `--desde 2026-11-09T10:00:00Z --hasta 2026-11-09T11:00:00Z`.
- Los pasos 7 a 9 terminan en `build-writes` y en mostrar el resumen.

## 1. Lock y estado

1. `ArtifactData get` de `config/runlock`. Si existe y `expiresAt` es futuro, otra corrida está en curso: terminá sin hacer nada.
2. Si no, `set` de `config/runlock` con `{holder: RUN, startedAt, expiresAt: ahora+50min}`.
   - Usá `if_version` si el documento ya existía.
   - Si el `set` falla por conflicto, otra corrida ganó: terminá.

## 2. Exportar la base a `work/$RUN/db`

Usá `ArtifactData` con `out_dir: work/$RUN/db`:
- `list` de `projects`, `rules`, `incidentWork`, `config` y `memory`.
- `query` de `incidents` con `where: [["status","==","open"]]`.
- `query` de `incidents` con `where: [["status","==","closed"],["closedAt",">=",<hace 30 días>]]`.
- `query` de `requests` con `where: [["status","==","pending"]]`.

Pasá `query.limit: 1000` en todos y paginá con `cursor` si hace falta.

Cada resultado lista la `version` de cada documento. **Registralas** en `work/$RUN/db/_versiones.json` como `{"incidents/inc-…": 3, "projects/facturacion": 7, …}`. Sin esto no se puede escribir.

## 3. Solicitudes pendientes

Por cada `requests` pendiente:
- `onboard_project` o `reanalyze_project`: ejecutá `/control-alta-proyecto` para ese proyecto.
- `recompile_rule`: compilá esa regla (paso 4).

Al terminar, `update` de la solicitud con `{status: "done"|"error", resultNote, processedAt}` y su `if_version`.

## 4. Compilar reglas

Por cada regla con `status: "pending_compile"`, traducí `text` (lenguaje natural) a `compiled`:

```json
{ "signal": "logs|jobs|queueItems", "filter": { "process": "", "queue": "", "level": ["Error","Fatal"], "state": [], "status": [],
  "exceptionType": "Business|Application", "messageRegex": "" },
  "aggregate": "count|consecutive|rate|absence", "windowMinutes": 60, "threshold": 10, "comparator": ">|>=|<|<=|==",
  "severity": "P1|P2|P3|P4", "action": "alert|escalate|known|ignore", "category": "login|selector|…", "title": "texto corto" }
```

- `category` tiene que ser una de: `business`, `application`, `login`, `selector`, `app_down`, `data`, `infrastructure`, `configuration`, `scheduling`, `sla`, `regression`, `silent_failure`, `monitoring`, `deploy`, `other`. "No corrió" es `scheduling`.
- `absence` ("no corrió en N horas"): `windowMinutes` es la brecha máxima tolerada. Se evalúa contra el último job conocido del proceso (`watermarks.lastJobByProcess`), no solo contra la ventana colectada.
- `rate`: el denominador son los registros del mismo alcance (`process`/`queue`), y la condición (`state`, `level`, `messageRegex`) define el numerador. Con menos de `minSample` registros (3 por defecto) no alerta.
- Si la regla no se puede expresar así, usá `{"mode":"llm", "severity", "action"}`. La evaluás vos en el paso 6.
- Escribí `compileNote` con una frase en español que diga cómo se entendió la regla. El tablero la muestra.
- Pasá la regla a `status: "active"`. Las reglas `proposed` no se tocan: las aprueba un Admin.

## 5. Colecta y evaluación por proyecto

Para cada proyecto con `status: "active"`:

```bash
node scripts/collect.mjs --proyecto work/$RUN/db/projects/<id>.json --desde <watermarks.since o hace 2 h> --salida work/$RUN/<id>/senales.json
node scripts/evaluate.mjs --senales work/$RUN/<id>/senales.json --proyecto work/$RUN/db/projects/<id>.json \
  --reglas work/$RUN/reglas.json --ajustes work/$RUN/db/config/settings.json --salida work/$RUN/<id>/hallazgos.json
```

- `reglas.json` es un array con las reglas activas: `{id, ...cuerpo}` leídas de `work/$RUN/db/rules`.
- La colecta cubre todas las carpetas del proyecto: la del proyecto más las propias de algún proceso.
  - Si todos los procesos tienen `orchestratorProcess`, se limita a ellos: la carpeta puede compartirse con otros proyectos.
  - Si a alguno le falta, consulta la carpeta completa y lo dice en `senales.filtradoPorProceso`.
  - Cada hallazgo trae `processId`: el proceso del proyecto al que pertenece, que define qué repo mira el análisis.
- Restale 5 minutos a `--desde` como solapamiento. El dedupe evita los duplicados.
- Con más de 3 proyectos, procesalos en paralelo con subagentes, uno por proyecto, que solo ejecuten estos dos comandos.

## 6. Triage

Por cada hallazgo de `hallazgos.json` decidí la clasificación y escribila en `work/$RUN/triage.json` como `{ "<hallazgo.id>": {...} }`. Considerá:
- los criterios globales (`config/settings.triageCriteria`, `severityMatrix`);
- los criterios del proyecto (`projects/<id>.triageCriteria`);
- la memoria de proceso y la de producción (`memory/<id>`);
- los incidentes abiertos y su trabajo humano (`incidentWork`);
- las reglas `mode: "llm"`;
- `referencias/taxonomia-triage.md`.

```json
{ "decision": "escalate|notify|monitor|known", "severity": "P1..P4", "category": "…", "title": "opcional, más claro",
  "rationale": "por qué, en 1-3 frases, citando criterio/regla/memoria", "confidence": "alta|media|baja",
  "matchedRules": ["id"], "memoryRefs": ["history/…"], "mergeInto": "inc-… (opcional)" }
```

**Decisiones:**
- `escalate`: requiere intervención humana. Pasa por el análisis previo del paso 8.
- `notify`: se muestra como aviso de baja prioridad.
- `monitor` / `known`: no se reportan; quedan en "No reportados" del tablero con su porqué.

**Reglas:**
- Si la memoria de producción dice que algo es esperado (por ejemplo, "abandonados los lunes por mantenimiento de SAP"), `known`, y citá la entrada.
- **Una tarjeta por tema.** Si un hallazgo es claramente la misma causa que un incidente abierto con otro fingerprint (por ejemplo, el mismo credential vencido en dos procesos), poné `mergeInto` con ese id.
- Si `hallazgo.conocidoPor` viene seteado, una regla `known` ya lo marcó: respetalo salvo evidencia fuerte en contra, y explicala.

## 7. Consolidar y armar escrituras

```bash
node scripts/consolidar.mjs --run-id $RUN --run-dir work/$RUN --inicio <inicio ISO> --trigger scheduled --session-url <URL de esta sesión si la conocés>
node scripts/build-writes.mjs --plan work/$RUN/plan.json --salida work/$RUN/lotes
```

- Si `build-writes` falla por PII o esquema, corregí el origen y repetí. Normalmente el origen es un `title` o un `rationale` tuyo en `triage.json`.
- **Nunca** saltees la validación.

## 8. Análisis previo de escalados

Para cada id de `plan.analizar`, ejecutá `/control-analisis`.

- Ese skill completa `analysis` dentro del documento del incidente en `work/$RUN/plan.json`.
- Al terminar, repetí `build-writes`.

## 9. Publicar

Por cada `work/$RUN/lotes/lote-N.json`, llamá `ArtifactData` `batch` con `writes` igual al contenido del archivo.

Si un lote falla por versión (otro escribió el documento):
1. Volvé a leer ese documento con `get` y actualizá `_versiones.json`.
2. Repetí desde el paso 7.

## 10. Aprendizaje y re-controles

Ejecutá `/control-aprendizaje`. Procesa las respuestas humanas nuevas y los re-controles vencidos.

## 11. Salud y cierre

1. `set` de `config/health` con `{lastRunId, lastRunAt, lastOkAt (si la corrida fue ok), consecutiveFailures, dbDocs}`.
2. Si es la primera corrida del día en UTC, ejecutá `/control-mantenimiento retencion`.
3. `delete` de `config/runlock` con su `if_version`.

Al final respondé con un resumen breve en español:
- proyectos revisados;
- incidentes nuevos y recurrentes;
- escalados;
- errores de colecta.

Si algo falló, decilo con el comando y el motivo. No ocultes fallas parciales.
