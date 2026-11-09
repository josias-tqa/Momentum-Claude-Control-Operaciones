---
name: control-alta-proyecto
description: Alta y análisis automático de un proyecto UiPath en la Torre de Control. Descubre procesos, colas, assets, triggers y máquinas de la carpeta de Orchestrator, calcula un baseline de 30 días, lo cruza con el código (Bitbucket) y la documentación (SDD/PDD), y genera la memoria de proceso (mini-PDD), reglas y criterios iniciales propuestos. Usar cuando hay una solicitud onboard_project o reanalyze_project, o cuando piden registrar/analizar un proyecto.
---

# Alta de un proyecto

Solo lectura en Orchestrator y Bitbucket (ver `CLAUDE.md`). El proyecto ya existe en el tablero (`projects/<id>`), creado por un Admin desde el formulario "Registrar proyecto". Si el pedido llega por chat, el documento lo creás vos con `status: "pending_analysis"`.

**Un proyecto agrupa uno o más procesos** (Dispatcher, Performer, Reporter…). La forma está en `scripts/lib/proyecto.mjs`:
- Comparten la carpeta de Orchestrator del proyecto (`orchestrator.folderPath`), salvo que un proceso declare su propio `folderPath`.
- **Cada proceso tiene su propio repo** (`processes[].repo`) y puede tener documentación propia (`processes[].docs.paths`).
- `projects.docs.paths` es la documentación común del proyecto.
- Un proyecto con el formato anterior (un `repo` único, sin `processes`) se lee como un proyecto de un solo proceso. Al terminar el alta se reescribe con `processes`.

**Re-análisis** (`reanalyze_project`): mismo procedimiento.
- Si el proyecto estaba `active`, queda `active`: solo se actualizan la memoria, el inventario, el baseline y el emparejamiento.
- En cualquier otro estado queda `review`.
- Las reglas `active` existentes no se tocan. Solo se proponen reglas nuevas si no hay una equivalente.

## Pasos

1. `update` de `projects/<id>` con `{status: "analyzing"}`, con su `if_version`. Recordá el estado anterior para el paso 7.
2. **Inventario y baseline:**
   ```bash
   node scripts/inventory.mjs --proyecto work/$RUN/db/projects/<id>.json --salida work/$RUN/alta/<id>/inventario.json --dias 30
   ```
   - Inventaría **todas** las carpetas del proyecto, con todos sus procesos, aunque haya otros que no son del proyecto. El paso 3 los empareja.
   - Si `errores` trae un fallo de login o de permisos, `status: "error"` con un `statusNote` que diga qué acceso falta: la External App no está asignada a la carpeta, falta un scope, etc. Terminá ahí.
3. **Código, un repo por proceso.** Para cada `processes[]`:
   ```bash
   node scripts/fetch-repo.mjs --proyecto work/$RUN/db/projects/<id>.json --proceso <processId> --destino work/$RUN/repos/<id>/<processId>
   ```
   - Guardá cada salida JSON en el array `work/$RUN/alta/<id>/repos.json`.
   - Si un repo no se puede clonar (no existe, o el token no tiene acceso), anotalo y seguí con los demás. El proyecto termina en `error` solo si **ningún** repo se pudo leer.
   - Un proceso puede no tener repo (`repo: null`) porque no está versionado. Se empareja por nombre o rol, se controla igual, y en la memoria queda dicho que no hay código para el análisis. No lo trates como error.
   - **Emparejá** cada proceso con su proceso de Orchestrator:
     ```bash
     node scripts/emparejar-procesos.mjs --proyecto work/$RUN/db/projects/<id>.json --inventario work/$RUN/alta/<id>/inventario.json --repos work/$RUN/alta/<id>/repos.json
     ```
     - Lo que devuelve `processes` reemplaza `projects.processes` en el paso 7, con `orchestratorProcess` completado.
     - `sinEmparejar`: procesos cuyo repo no corresponde a ningún proceso de la carpeta. **Suele ser un repo equivocado**: decilo en `statusNote`.
     - `sinDeclarar`: procesos de la carpeta que el proyecto no declaró. Pueden ser de otro proyecto, o un proceso que falta registrar: mencionalo.
     - Si el código de un repo describe claramente otro proceso (por ejemplo, otro cliente o un SDD de otro proyecto), no lo empareje aunque el nombre se parezca. Explicalo.
   - Con la versión desplegada de cada proceso (del inventario), si el tag `v<versión>` no existe, el clon queda en la rama. Volvé a correr `fetch-repo` con `--version` ya conocida, o anotá que no hay tags.

   Después, por cada repo, identificá:
   - el estilo (XAML/REFramework, coded-first, mixto) y si está `.claude/tqa-project.json`;
   - los entry points y dispatcher/performer;
   - las colas y assets referenciados en el Config (`Data/Config.xlsx` o `Config.json`; para el xlsx alcanza con los nombres de hojas y claves; podés usar `unzip -p` sobre el xml);
   - las excepciones de negocio definidas;
   - los sistemas con los que interactúa (aplicaciones, URLs sin parámetros, APIs).
4. **Documentación:** leé el SDD/PDD de cada proceso y la documentación común (rutas en `processes[].docs.paths` y `projects.docs.paths`, o lo que devolvió `fetch-repo`). Extraé:
   - propósito;
   - pasos To-Be;
   - tablas de Handover (Work Queues, Assets, Triggers, Robots);
   - excepciones BE/AE;
   - SLAs, volúmenes y horarios;
   - Known Issues;
   - contactos **por rol**, nunca nombres de personas.
5. **Cruce**, para listar discrepancias:
   - un asset o cola del SDD o del código que no existe en Orchestrator, o al revés;
   - un repo cuyo código no corresponde al proceso declarado;
   - la cola que escribe el Dispatcher y la que lee el Performer: deberían coincidir;
   - una versión desplegada sin tag en git;
   - triggers distintos a lo documentado;
   - docs que no coinciden con el código.
6. **Memoria de proceso.** `set` de `memory/<id>` con `{projectId, process, productionSummary, sources, updatedAt}`:
   - `process` es Markdown en español, 2 a 4 páginas como máximo. Es un mini-PDD que permite analizar ejecuciones sin releer todo. Secciones:
     - Qué hace
     - Procesos del proyecto (tabla: proceso, nombre en Orchestrator, rol, repo, versión desplegada, sha leído)
     - Disparadores y horario
     - Flujo entre procesos (qué cola escribe y lee cada uno)
     - Sistemas e integraciones
     - Colas y volúmenes normales
     - Excepciones de negocio esperadas (BE)
     - Excepciones de sistema conocidas (AE)
     - SLAs
     - Baseline observado (de `inventario.json`)
     - Mapa del código **por proceso** (workflows clave de cada repo)
     - Discrepancias encontradas
     - Fuentes (archivo + sha)
   - Sin PII y sin valores de assets.
   - `productionSummary`: si ya existía (re-análisis) se conserva. Si no, poné `"Sin historial de producción todavía."`.
7. **Proyecto.** `update` de `projects/<id>` con:
   - `processes` (de `emparejar-procesos`), y `repo: null` si venía del formato anterior;
   - `inventory` (de `inventario.json`);
   - `baseline`;
   - `watermarks.lastJobByProcess` = `ultimoJobPorProceso` de `inventario.json`, solo si no existe ya;
   - `status`: `"review"`, o `"active"` si era un re-análisis de un proyecto activo;
   - `statusNote`, con un resumen de 2 o 3 líneas de lo encontrado y las discrepancias.
8. **Reglas iniciales propuestas.** 3 a 6 documentos `rules/<id>-<slug>` con:
   - `{projectId, text, status: "proposed", origin: "onboarding", compiled, compileNote, createdBy: "rutina", createdAt}`;
   - basadas en el SDD (SLAs, excepciones críticas) y el baseline. Por ejemplo, "Si el Dispatcher no corre en más de X h, escalar" o "Más de N items con error de sistema en una hora, escalar";
   - cuando la regla es de un proceso, el `compiled.filter.process` lleva su `orchestratorProcess`.
9. **Criterios de triage del proyecto.** Si `triageCriteria` está vacío, proponelos en `statusNote` como texto sugerido. No los sobrescribas.
10. **Historial.** Agregá una entrada `history` `{projectId, type: "onboarding", at, summary, by: "rutina"}`.

Todo lo escrito pasa por `build-writes`: armá un plan `{writes:[…]}` en `work/$RUN/alta/<id>/plan.json` y ejecutá `node scripts/build-writes.mjs`. Después publicá los lotes con `ArtifactData batch`.

Al terminar, el proyecto queda en **review**. Un Admin lo pasa a `active` desde el tablero, después de revisar la memoria y aprobar las reglas.
