---
name: control-alta-proyecto
description: Alta y análisis automático de un proyecto UiPath en la Torre de Control. Descubre procesos, colas, assets, triggers y máquinas de la carpeta de Orchestrator, calcula un baseline de 30 días, lo cruza con el código (Bitbucket) y la documentación (SDD/PDD), y genera la memoria de proceso (mini-PDD), reglas y criterios iniciales propuestos. Usar cuando hay una solicitud onboard_project o reanalyze_project, o cuando piden registrar/analizar un proyecto.
---

# Alta de un proyecto

Solo lectura en Orchestrator y Bitbucket (ver `CLAUDE.md`). El proyecto ya existe en el tablero (`projects/<id>`), creado por un Admin desde el formulario "Registrar proyecto". Si el pedido llega por chat, el documento lo creás vos con `status: "pending_analysis"`.

## Pasos

1. `update` de `projects/<id>` con `{status: "analyzing"}`, con su `if_version`.
2. **Inventario y baseline:**
   ```bash
   node scripts/inventory.mjs --proyecto work/$RUN/db/projects/<id>.json --salida work/$RUN/alta/<id>/inventario.json --dias 30
   ```
   - Si `errores` trae un fallo de login o de permisos, `status: "error"` con un `statusNote` que diga qué acceso falta: la External App no está asignada a la carpeta, falta un scope, etc. Terminá ahí.
3. **Código:** usá `node scripts/fetch-repo.mjs --proyecto … --destino work/$RUN/repos/<id> --version <versión del performer o del proceso principal>`. Después identificá:
   - el estilo (XAML/REFramework, coded-first, mixto) y si está `.claude/tqa-project.json`;
   - los entry points y dispatcher/performer;
   - las colas y assets referenciados en el Config (`Data/Config.xlsx` o `Config.json`; para el xlsx alcanza con los nombres de hojas y claves; podés usar `unzip -p` sobre el xml);
   - las excepciones de negocio definidas;
   - los sistemas con los que interactúa (aplicaciones, URLs sin parámetros, APIs).
4. **Documentación:** leé el SDD/PDD (rutas en `projects.docs.paths` o lo que devolvió `fetch-repo`) y extraé:
   - propósito;
   - pasos To-Be;
   - tablas de Handover (Work Queues, Assets, Triggers, Robots);
   - excepciones BE/AE;
   - SLAs, volúmenes y horarios;
   - Known Issues;
   - contactos **por rol**, nunca nombres de personas.
5. **Cruce**, para listar discrepancias:
   - un asset o cola del SDD o del código que no existe en Orchestrator, o al revés;
   - una versión desplegada sin tag en git;
   - triggers distintos a lo documentado;
   - docs que no coinciden con el código.
6. **Memoria de proceso.** `set` de `memory/<id>` con `{projectId, process, productionSummary, sources, updatedAt}`:
   - `process` es Markdown en español, 2 a 4 páginas como máximo. Es un mini-PDD que permite analizar ejecuciones sin releer todo. Secciones:
     - Qué hace
     - Disparadores y horario
     - Flujo (dispatcher/performer)
     - Sistemas e integraciones
     - Colas y volúmenes normales
     - Excepciones de negocio esperadas (BE)
     - Excepciones de sistema conocidas (AE)
     - SLAs
     - Baseline observado (de `inventario.json`)
     - Mapa del código (workflows clave)
     - Discrepancias encontradas
     - Fuentes (archivo + sha)
   - Sin PII y sin valores de assets.
   - `productionSummary`: si ya existía (re-análisis) se conserva. Si no, poné `"Sin historial de producción todavía."`.
7. **Proyecto.** `update` de `projects/<id>` con:
   - `inventory` (de `inventario.json`);
   - `baseline`;
   - `status: "review"`;
   - `statusNote`, con un resumen de 2 o 3 líneas de lo encontrado y las discrepancias.
8. **Reglas iniciales propuestas.** 3 a 6 documentos `rules/<id>-<slug>` con:
   - `{projectId, text, status: "proposed", origin: "onboarding", compiled, compileNote, createdBy: "rutina", createdAt}`;
   - basadas en el SDD (SLAs, excepciones críticas) y el baseline. Por ejemplo, "Si el Dispatcher no corre en más de X h, escalar" o "Más de N items con error de sistema en una hora, escalar".
9. **Criterios de triage del proyecto.** Si `triageCriteria` está vacío, proponelos en `statusNote` como texto sugerido. No los sobrescribas.
10. **Historial.** Agregá una entrada `history` `{projectId, type: "onboarding", at, summary, by: "rutina"}`.

Todo lo escrito pasa por `build-writes`: armá un plan `{writes:[…]}` en `work/$RUN/alta/<id>/plan.json` y ejecutá `node scripts/build-writes.mjs`. Después publicá los lotes con `ArtifactData batch`.

Al terminar, el proyecto queda en **review**. Un Admin lo pasa a `active` desde el tablero, después de revisar la memoria y aprobar las reglas.
