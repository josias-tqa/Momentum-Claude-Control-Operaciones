---
name: control-reglas
description: Propone reglas nuevas y cambios sobre reglas existentes de la Torre de Control, sin activar nada. Por similitud entre procesos (una regla aprobada o editada se ofrece a los procesos que comparten un portal, una aplicación o una librería) y con una revisión diaria de los últimos 30 días (reglas ruidosas, severidad que sobra, reglas sin uso, temas recurrentes sin regla). Usar al final de cada /control-corrida, después de /control-aprendizaje, o cuando piden "revisar las reglas" o "proponer reglas".
---

# Propuestas de reglas

Leé primero `CLAUDE.md`. Entrada: lo exportado en `work/$RUN/db` (`projects`, `rules`, `incidents`, `incidentWork`, `config`).

**Este skill solo propone.** Una regla nueva nace `proposed`; un cambio sobre una regla existente queda como `suggestion` en esa regla. Los aprueba o descarta un Admin desde el tablero.

Si un Admin activó en Ajustes la **aprobación automática** (`config/settings.autoApproveRules`), `build-writes` convierte en `active` las reglas que este skill escribe como `proposed`, en el mismo lote (lo informa en `reglasAprobadasAutomaticamente`). Acá no cambia nada: seguí escribiendo `proposed`, nunca `active`. En el resumen decí cuántas quedaron activas. Los cambios sugeridos (`suggestion`) no se aplican solos en ningún caso. Con la aprobación automática activa sé todavía más estricto con las reglas `known`: nadie las va a mirar antes de que empiecen a tapar hallazgos.

## 1. Candidatos (determinista)

```bash
node scripts/sugerir-reglas.mjs --db work/$RUN/db --ahora <ISO> --salida work/$RUN/reglas-candidatos.json
```

El script decide solo qué toca:
- **Similitud, en cada corrida:** mira las reglas activas que se aprobaron o editaron desde la última vez (`config/health.rulesReview.similarityAt`). Casi siempre no hay ninguna y no cuesta nada.
- **Revisión diaria:** solo en la primera corrida del día en UTC (`rulesReview.dailyAt`). Con `--diario` se fuerza, por ejemplo si alguien pide "revisar las reglas".

Devuelve `candidatos` (ya con topes: 3 por proyecto y por vez, y ninguno si el proyecto ya tiene 5 pendientes) y `plan.writes` (marcas de `rulesReview` y `lastTriggeredAt` de las reglas). **Si `candidatos` está vacío, saltá al paso 4.**

## 2. Qué hacer con cada candidato

Para decidir, leé lo necesario de `work/$RUN/db`: la regla, los incidentes citados (`incidentes`), su `incidentWork` (motivo y notas de la respuesta humana) y `memory/<projectId>`.

| `tipo` | Qué significa | Qué escribís |
|---|---|---|
| `similar` | `process` de `projectId` comparte un sistema (`comparten`) con el proceso de la regla `sourceRuleId` | Regla **nueva** `proposed` en `projectId`, adaptada a ese proceso |
| `ruidosa` | La regla disparó 3 veces o más y el 60% o más se descartó como falso positivo o esperado | `suggestion` de `kind: "exception"` (si los descartes comparten una condición) o `"text"` (si el umbral es bajo) |
| `severidad` | Sus incidentes se posponen y ninguno requirió fix | `suggestion` de `kind: "severity"`, con `value` = el del candidato |
| `sin_uso` | Activa hace más de 60 días y sin disparar en 60 días | `suggestion` de `kind: "retire"` |
| `descartado_repetido` | El mismo tema (proyecto, categoría, proceso), sin regla, se descartó 2 veces o más | Regla **nueva** `proposed`, `known` y acotada |
| `recurrente_sin_regla` | Un aviso sin regla se repitió en 5 corridas o más y nadie lo miró | Regla **nueva** `proposed` que lo escale al superar un umbral |

**Criterio (acá está la parte inteligente):**
- `similar`: proponé solo si la regla **trata del sistema compartido**. Una regla de login al portal sirve a otro proceso que usa ese portal; una regla sobre una cola propia o un horario propio, no. `web:<host>` es un portal, `app:<exe>` una aplicación de escritorio, `lib:<nombre>` una librería propia. Adaptá `compiled.filter.process` al `orchestratorProcess` del destino y revisá que el umbral tenga sentido con el `baseline` de ese proyecto.
- `ruidosa`: buscá en las notas qué tienen en común los descartes (un día, una hora, un proceso, un mensaje). Si lo hay, sugerí la excepción con esas palabras. Si no, sugerí el texto con otro umbral, apoyado en lo observado.
- Las reglas `known` tienen que ser **acotadas** (proceso o cola, y `messageRegex` u horario): no pueden tapar problemas reales.
- No propongas nada que ya exista con otro texto: mirá las reglas del proyecto, también las `rejected`.
- Ante la duda, **descartá el candidato**. Menos propuestas y buenas.

**Regla nueva** — `set` de `rules/<projectId>-<slug>`:

```json
{ "projectId": "…", "text": "en lenguaje natural", "status": "proposed", "origin": "similar | review",
  "sourceRuleId": "solo en similar", "sourceIncidentId": "el primero de `incidentes`, si hay",
  "proposalKey": "<candidato.key, tal cual>", "why": "por qué se propone, 1 o 2 frases con los números",
  "compiled": { … }, "compileNote": "cómo se entendió", "createdBy": "rutina", "createdAt": "…" }
```

`origin` es `similar` para ese tipo y `review` para los que salen de la revisión diaria. `compiled` sigue el formato del paso 4 de `/control-corrida`.

**Cambio sugerido** — `update` de `rules/<ruleId>` con su `if_version`:

```json
{ "suggestion": { "kind": "exception | severity | text | retire", "value": "la excepción, la severidad o el texto nuevo (vacío en retire)",
  "why": "1 o 2 frases con los números", "key": "<candidato.key>", "at": "…" } }
```

- `value` de una excepción completa la frase "no aplica cuando…": escribilo así ("es lunes antes de las 9"), sin repetir esas palabras.
- **Nunca** toques `text`, `exceptions`, `compiled.severity` ni `status` de una regla existente: eso lo hace el Admin al aplicar la sugerencia.
- Si `plan.writes` ya trae un `update` de esa misma regla (`lastTriggeredAt`), **fusioná** los datos en esa escritura: un lote no puede tocar dos veces el mismo documento.

`why`, `text` y `value` van en el idioma de `config/settings.language` (por defecto `es`) y **sin PII**: citá cantidades e ids de incidente, nunca datos de un caso.

**Candidato descartado:** agregá su `key` a `rulesReview.descartados` en la escritura de `config/health` del plan, como `{"<key>": "<ISO de ahora>"}`. Así no vuelve por 90 días.

## 3. Memoria

Por cada regla nueva propuesta, una entrada `history` `{projectId, type: "rule_added", at, summary, ruleId, by: "rutina"}`. Los cambios sugeridos no van a `history`: todavía no pasó nada.

## 4. Publicar

Sumá tus escrituras a `plan.writes` de `work/$RUN/reglas-candidatos.json`, guardalo como `work/$RUN/reglas-plan.json` (`{"writes": […]}`) y:

```bash
node scripts/build-writes.mjs --plan work/$RUN/reglas-plan.json --salida work/$RUN/lotes-reglas
```

Publicá los lotes con `ArtifactData batch`. La escritura de `config/health` va **siempre**, aunque no haya candidatos: es la que evita repetir la revisión.

En el resumen de la corrida decí cuántas reglas propusiste, cuántos cambios sugeriste y cuántos candidatos descartaste.
