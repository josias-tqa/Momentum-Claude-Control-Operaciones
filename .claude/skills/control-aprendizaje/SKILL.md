---
name: control-aprendizaje
description: Procesa las respuestas humanas a incidentes y a discrepancias de proyecto de la Torre de Control (descartes, respuestas, posposiciones) para actualizar la memoria de producción de cada proyecto, cerrar incidentes, agendar re-controles y proponer reglas nuevas aprendidas. Usar al final de cada /control-corrida o cuando piden "procesar las respuestas".
---

# Aprendizaje de respuestas humanas

Entrada: lo exportado en `work/$RUN/db`, que incluye `incidents`, `incidentWork`, `discrepancies`, `discrepancyWork`, `memory` y `rules`.

## 1. Qué procesar

```bash
node scripts/pendientes-aprendizaje.mjs --db work/$RUN/db --ahora <ISO> > work/$RUN/aprendizaje.json
```

El script devuelve:
- `respuestas`: incidentes cuyo `incidentWork` cambió después de `incidents.learning.processedAt`. Pueden ser un descarte, una respuesta o una posposición.
- `recontroles`: respuestas con `recheckAt` vencido o posposiciones (`snoozeUntil`) vencidas.
- `discrepancias`: respuestas y descartes de discrepancias de proyecto (`discrepancyWork`) que todavía no están en la memoria. Ver la sección 5.

## 2. Por cada respuesta

| `incidentWork` | Memoria de producción (`history`) | Incidente |
|---|---|---|
| `dismissed` + `expected` | `expected_behavior` | `status: closed`, `closedReason: "descartado: esperado"` |
| `dismissed` + `false_positive` | `false_positive` | cerrar |
| `dismissed` + `business_data` | `data_issue` | cerrar |
| `dismissed` + `external_system` | `external_system` | cerrar |
| `responded` + `fix_required` | `fix_required` (con `ticket` si lo hay) | sigue `open` hasta que se responda que se resolvió, o se cierra si las notas lo dicen |
| `responded` + `expected_behavior` / `data_issue` / `external_system` / `false_positive` | el tipo equivalente | cerrar |
| `responded` + `recheck` | `recheck_scheduled` con la fecha | queda `open`; el tablero la oculta hasta la fecha |
| `responded` + `escalate_dev` | `note` ("derivado a desarrollo") | queda `open` |
| `snoozed` | nada | nada (solo se revisa al vencer) |

- La entrada `history/<id>` lleva `{projectId, type, at, summary, incidentId, by: <id del humano que respondió>, ticket?}`.
- El `summary` va en el idioma de `config/settings.language` (por defecto `es`), 1 a 3 frases: qué pasó, qué se decidió y por qué, según las notas, **sin PII**. Si las notas tienen datos personales, parafraseá sin ellos.
- En el incidente, actualizá `learning: {processedAt, workUpdatedAt}`, y `closedAt` si se cierra.

## 3. Memoria rodante

Por cada proyecto con respuestas nuevas, reescribí `memory/<id>.productionSummary`:
- Markdown, máximo ~2 páginas.
- Incluye patrones conocidos, fixes pendientes, lo que es normal, los re-controles agendados y las últimas 10 decisiones relevantes, cada una con su `history` id.
- Es lo que lee el triage para no volver a escalar lo ya explicado.

## 4. Reglas aprendidas (propuestas)

Si una respuesta describe un **patrón** que se puede repetir, proponé una regla. Por ejemplo:
- "es normal los lunes por el mantenimiento de SAP" → una regla `known` acotada;
- "si vuelve a pasar más de 3 veces escalá directo" → una regla `escalate`.

La regla nace como `rules/<id>`:

```json
{ "projectId": "…", "text": "en lenguaje natural", "status": "proposed", "origin": "learned", "sourceIncidentId": "…",
  "compiled": { … }, "compileNote": "cómo se entendió", "createdBy": "rutina", "createdAt": "…" }
```

- **Nunca** la actives: nace `proposed` aunque la aprobación automática esté activa en Ajustes (en ese caso `build-writes` la activa al armar los lotes).
- No propongas una regla por cada respuesta: solo cuando hay un patrón claro, y si no existe una equivalente.
- Si la tarjeta tiene una `activity` de tipo `rule`, una persona ya ajustó, creó, desactivó o eliminó la regla desde el tablero: **no propongas otra** para ese mismo patrón. Anotá en `history` qué se cambió, con el texto de esa actividad.
- Si el patrón es una **salvedad de una regla que ya existe** ("la regla está bien, pero los lunes no"), no crees una regla nueva: dejá en esa regla un cambio sugerido, `suggestion: {kind: "exception", value, why, key: "sug:<ruleId>:respuesta", at}` (formato en `/control-reglas`), salvo que ya tenga uno. Las `exceptions` de una regla las escribe solo una persona, al aplicar la sugerencia.
- Las reglas `known` tienen que ser **acotadas**, con proceso o cola y `messageRegex` específico, para no tapar problemas reales.

## 5. Respuestas a discrepancias de proyecto

Las discrepancias son tarjetas a nivel proyecto (las crea `/control-alta-proyecto`). El equipo las responde, las descarta o las pospone desde la pestaña Discrepancias; no pasan por la bandeja. Por cada elemento de `discrepancias`:

| `discrepancyWork` | Memoria de producción (`history`, `type: "discrepancy"`) | Qué más |
|---|---|---|
| `dismissed` (cualquier motivo) | "Discrepancia descartada: <título>. Motivo: …" | nada: no se vuelve a mostrar como nueva |
| `responded` + `expected` | "Es correcto así: <qué y por qué, según las notas>" | es un hecho del proyecto: sumalo a la memoria rodante |
| `responded` + `fix_docs` / `fix_orchestrator` / `fix_code` | "Corrección pendiente (<dónde>): …", con `ticket` si lo hay | queda como corrección pendiente en la memoria rodante |
| `responded` + `escalate_dev` | "Derivada a desarrollo: …" | igual |

- La entrada `history/<id>` lleva `{projectId, type: "discrepancy", at, summary, discrepancyId, by: <id de quien respondió>, ticket?}`. El `summary` va en el idioma de `config/settings.language` (por defecto `es`)l, 1 a 3 frases, **sin PII**.
- En la discrepancia, `update` de `discrepancies/<id>` con `{learning: {processedAt, workUpdatedAt: <at de la respuesta>}}` y su `if_version`. **No cambies `status`** (lo maneja `consolidar-discrepancias.mjs` en cada análisis) y **nunca escribas `discrepancyWork`**: es del lado humano.
- Una posposición no enseña nada: el script ni la lista.
- Las discrepancias no generan reglas. Si la respuesta "es correcto así" cambia lo que el triage debería considerar normal, alcanza con la memoria rodante.
- Si la memoria de proceso contradice una respuesta "es correcto así", no la reescribas acá: el próximo re-análisis la corrige (el paso 6 del alta lee estas respuestas).

## 6. Re-controles vencidos

Por cada uno, mirá si el tema volvió a ocurrir después de la respuesta: `recurrences` con `at` posterior a `incidentWork.updatedAt`.
- **Si volvió:** reabrí la tarjeta. Pasá `incidentWork` a `{state: "open"}` y dejá una `activity` de tipo `reopen` que diga "Volvió a ocurrir después del re-control". Esto lo hace la rutina como dueña, con `if_version`.
- **Si no volvió:** agregá `history` `recheck_done` y cerrá el incidente.

## 7. Publicar

Armá el plan en `work/$RUN/aprendizaje-plan.json`, validalo con `build-writes` y publicalo con `ArtifactData batch`.
