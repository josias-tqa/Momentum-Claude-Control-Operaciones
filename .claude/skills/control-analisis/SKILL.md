---
name: control-analisis
description: Análisis previo a la validación humana de un incidente escalado por la Torre de Control. Cruza la evidencia redactada con el código del proyecto (Bitbucket, en la versión desplegada) y su documentación (SDD/PDD) para orientar la respuesta humana. Usar desde /control-corrida para cada incidente en plan.analizar, o cuando alguien pide re-analizar un incidente.
---

# Análisis previo de un incidente escalado

**Solo diagnóstico.** Nunca se edita, commitea ni pushea código, y nunca se cambia nada en Orchestrator.
Si la causa requiere un fix, se dice **qué** y **dónde**, para que lo tome un humano.

## Entrada

- Incidente: el documento en `work/$RUN/plan.json`, dentro de `writes` con `collection: "incidents"`. Si es un re-análisis, se lee del tablero.
- Proyecto: `work/$RUN/db/projects/<projectId>.json`.
- Memoria: `work/$RUN/db/memory/<projectId>.json`.

## Pasos

1. **Código del proceso afectado, en la versión desplegada.** Un proyecto tiene un repo por proceso.
   - El incidente trae `processId` (Dispatcher, Performer…) y `process` (nombre en Orchestrator).
   ```bash
   node scripts/fetch-repo.mjs --proyecto work/$RUN/db/projects/<id>.json --proceso <processId o process> --destino work/$RUN/repos/<id>/<processId>
   ```
   - La versión sale sola del inventario del proyecto. El resultado dice si el ref coincide con la versión (`coincideVersion`) y el `sha`.
   - **Si el incidente es de una cola**, sin proceso, mirá los dos lados:
     - el proceso que la escribe (Dispatcher), para saber si cargó datos inválidos;
     - el que la consume (Performer), para saber si falla al procesarlos.
     La memoria de proceso dice qué proceso usa cada cola.
   - Si el incidente no tiene proceso asociado, elegilo por la evidencia (el `proceso` de los jobs o logs) o por la memoria.
   - Si no hay tag `v<versión>`, se usa la rama configurada. Decilo en el análisis: el código puede no ser exactamente el desplegado.
   - Reutilizá el clon si ya existe en esta corrida.
2. **Ubicar el paso que falla:**
   - Con los mensajes de la evidencia (`evidence.ultima.logs`, `queueItems[].motivo`) y los marcadores del framework TQA (`Started/Finished SubProcess|Component`, `"<Handler>: Process started."`), encontrá el workflow (`.xaml`) o la clase (`.cs`) donde se lanza la excepción.
   - Para leer XAML/C# apoyate en el skill `uipath-rpa`. Para el razonamiento causal, en el método de `uipath-troubleshoot`:
     - anclar la entidad;
     - extraer señales;
     - buscar el playbook;
     - verificar con evidencia del runtime.
   - **No ejecutes** comandos de esos skills que no sean de lectura. El hook los bloquea igual.
3. **Documentación:** leé del SDD/PDD del proceso (`processes[].docs.paths`), de la documentación común (`projects.docs.paths`) o de lo que encontró `fetch-repo`, solo las secciones relevantes:
   - tabla de excepciones (BE/AE);
   - Work Queues;
   - Assets/Configuración;
   - Known Issues and Resolutions;
   - pasos To-Be del proceso.
   Un `.docx` se convierte con `pandoc <archivo> -t gfm`.
4. **Contrastar:**
   - ¿Es una regresión? Mirá si la versión es nueva respecto de `history` (`deploy_detected`).
   - ¿Es un dato de negocio o un sistema externo?
   - ¿Coincide la etiqueta Business/Application del queue item con lo que hace el código? No confíes en la etiqueta.
   - ¿Hay una entrada parecida en la memoria de producción?
5. **Escribir el resultado** en `work/$RUN/analisis/<incidentId>.json` y aplicarlo al plan:
   ```bash
   node scripts/set-analisis.mjs --plan work/$RUN/plan.json --incidente <id> --analisis work/$RUN/analisis/<id>.json
   ```

## Forma del análisis (en español, sin PII ni valores de casos)

```json
{
  "summary": "2-4 frases: qué pasa, desde cuándo, a qué afecta",
  "hypotheses": [ { "text": "causa probable", "likelihood": "alta|media|baja", "evidence": "dato concreto que la sostiene (log, item, línea de código)" } ],
  "codeRefs": [ { "file": "Framework/InitAllApplications.xaml", "line": 120, "sha": "<sha>", "note": "qué hace ese punto" } ],
  "docRefs": [ { "file": "docs/SDD.md", "section": "Exception Handling — AE001", "note": "qué dice" } ],
  "scope": "alcance: jobs/items afectados, desde cuándo",
  "regression": true,
  "requiresFix": false,
  "suggestedActions": [ "acción concreta para el humano (verificar credencial X en Orchestrator, coordinar con el dueño de SAP, …)" ],
  "responseOptions": [ "Requiere fix", "Comportamiento esperado", "Volver a controlar en 1 semana" ],
  "repo": { "ref": "v1.4.0", "sha": "<sha>", "matchesDeployedVersion": true, "process": "<processId>" }
}
```

- Ordená las hipótesis por probabilidad. Cada una necesita **evidencia concreta**; si no la hay, decilo y bajá la probabilidad.
- Las acciones sugeridas son para humanos. Nunca "voy a corregir" ni "apliqué".
