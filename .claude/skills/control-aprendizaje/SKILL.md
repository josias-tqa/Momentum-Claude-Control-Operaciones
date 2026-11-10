---
name: control-aprendizaje
description: Procesa las respuestas humanas a incidentes de la Torre de Control (descartes, respuestas, posposiciones) para actualizar la memoria de producción de cada proyecto, cerrar incidentes, agendar re-controles y proponer reglas nuevas aprendidas. Usar al final de cada /control-corrida o cuando piden "procesar las respuestas".
---

# Aprendizaje de respuestas humanas

Entrada: lo exportado en `work/$RUN/db`, que incluye `incidents`, `incidentWork`, `memory` y `rules`.

## 1. Qué procesar

```bash
node scripts/pendientes-aprendizaje.mjs --db work/$RUN/db --ahora <ISO> > work/$RUN/aprendizaje.json
```

El script devuelve:
- `respuestas`: incidentes cuyo `incidentWork` cambió después de `incidents.learning.processedAt`. Pueden ser un descarte, una respuesta o una posposición.
- `recontroles`: respuestas con `recheckAt` vencido o posposiciones (`snoozeUntil`) vencidas.

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
- El `summary` va en español, 1 a 3 frases: qué pasó, qué se decidió y por qué, según las notas, **sin PII**. Si las notas tienen datos personales, parafraseá sin ellos.
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

- **Nunca** la actives. La aprueba un Admin desde el tablero.
- No propongas una regla por cada respuesta: solo cuando hay un patrón claro, y si no existe una equivalente.
- Si la tarjeta tiene una `activity` de tipo `rule`, una persona ya ajustó, creó, desactivó o eliminó la regla desde el tablero: **no propongas otra** para ese mismo patrón. Anotá en `history` qué se cambió, con el texto de esa actividad.
- Si el patrón es una **salvedad de una regla que ya existe** ("la regla está bien, pero los lunes no"), no crees una regla nueva: decilo en el `summary` de `history` para que un Admin agregue la excepción desde la tarjeta. Las `exceptions` de una regla las escribe solo una persona.
- Las reglas `known` tienen que ser **acotadas**, con proceso o cola y `messageRegex` específico, para no tapar problemas reales.

## 5. Re-controles vencidos

Por cada uno, mirá si el tema volvió a ocurrir después de la respuesta: `recurrences` con `at` posterior a `incidentWork.updatedAt`.
- **Si volvió:** reabrí la tarjeta. Pasá `incidentWork` a `{state: "open"}` y dejá una `activity` de tipo `reopen` que diga "Volvió a ocurrir después del re-control". Esto lo hace la rutina como dueña, con `if_version`.
- **Si no volvió:** agregá `history` `recheck_done` y cerrá el incidente.

## 6. Publicar

Armá el plan en `work/$RUN/aprendizaje-plan.json`, validalo con `build-writes` y publicalo con `ArtifactData batch`.
