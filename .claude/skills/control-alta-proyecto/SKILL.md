---
name: control-alta-proyecto
description: Alta y análisis automático de un proyecto UiPath en la Torre de Control. Descubre procesos, colas, assets, triggers y máquinas de la carpeta de Orchestrator, calcula un baseline de 30 días, lo cruza con el código y la documentación del paquete publicado en Orchestrator (Bitbucket solo de respaldo) y con el PDD, SDD o Runbook subidos al tablero, y genera la memoria de proceso (mini-PDD), las discrepancias del proyecto, reglas y criterios iniciales propuestos. Usar cuando hay una solicitud onboard_project o reanalyze_project, o cuando piden registrar/analizar un proyecto.
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
- Las discrepancias se **actualizan**, no se rehacen: ver el paso 5.

## Pasos

1. `update` de `projects/<id>` con `{status: "analyzing"}`, con su `if_version`. Recordá el estado anterior para el paso 7.
2. **Inventario y baseline:**
   ```bash
   node scripts/inventory.mjs --proyecto work/$RUN/db/projects/<id>.json --salida work/$RUN/alta/<id>/inventario.json --dias 30
   ```
   - Inventaría **todas** las carpetas del proyecto, con todos sus procesos, aunque haya otros que no son del proyecto. El paso 3 los empareja.
   - Si `errores` trae un fallo de login o de permisos, `status: "error"` con un `statusNote` que diga qué acceso falta: la External App no está asignada a la carpeta, falta un scope, etc. Terminá ahí.
3. **Procesos y código, desde Orchestrator.**
   - Los procesos son todos los de la carpeta, salvo `includeAllProcesses: false`. Completá `processes[]` con los que falten: `id`, `label` legible, `orchestratorProcess`, `role` y `repo: null`.
   - Índice de librerías del proyecto:
     ```bash
     node scripts/collect.mjs --proyecto work/$RUN/db/projects/<id>.json --desde <hace 2 h> --salida work/$RUN/alta/<id>/senales.json
     node scripts/indexar-codigo.mjs --senales work/$RUN/alta/<id>/senales.json --proyecto work/$RUN/db/projects/<id>.json --salida work/$RUN/<id>/indice.json --todo
     ```
   - Por cada proceso: `node scripts/fetch-codigo.mjs --proyecto … --proceso <id> --destino work/$RUN/codigo/<id>/<processId>`. El código, las librerías y la documentación salen del paquete de la versión desplegada. El repo (si hay) es solo respaldo.
   - `hygiene` del índice: si el paquete publica capturas, datos o carpetas internas, es una discrepancia de tipo `hygiene` (paso 5), como recomendación para desarrollo (ver `docs/recomendaciones-publicacion.md`).
   Después, por cada proceso, identificá:
   - el estilo (XAML/REFramework, coded-first, mixto) y si está `.claude/tqa-project.json`;
   - los entry points y dispatcher/performer;
   - las colas y assets referenciados en el Config (`Data/Config.xlsx` o `Config.json`; para el xlsx alcanza con los nombres de hojas y claves; podés usar `unzip -p` sobre el xml);
   - las excepciones de negocio definidas;
   - los sistemas con los que interactúa (aplicaciones, URLs sin parámetros, APIs).
4. **Documentación:** leé el SDD/PDD de cada proceso y la documentación común (rutas en `processes[].docs.paths` y `projects.docs.paths`, o lo que devolvió `fetch-repo`).
   - **Documentos subidos al tablero.** Un Admin puede subir a mano documentos del proyecto (pestaña Documentación): PDD, SDD, Runbook u otros, tantos como quiera, también varios de la misma categoría. Están en `documents`, ya en Markdown: `ArtifactData query` de `documents` con `where: [["projectId","==","<id>"]]` y `out_dir: work/$RUN/alta/<id>/documentos`. Cada uno trae `kind` (`pdd`, `sdd`, `runbook` u `other`), `title` (opcional: dice de qué es, por ejemplo de qué proceso), `markdown`, `fileName`, `source` y `uploadedAt`. Los que vienen de un PDF (`source: "pdf"`) son texto corrido: las tablas no conservan sus columnas.
   - **Documentos desactivados.** Un Admin puede desactivar documentos del paquete (`projects/<id>.disabledDocs`, como `"<proceso>:<ruta>"`). `fetch-codigo` ya no los extrae y los informa en `docsDesactivados`: no los busques por otro lado (tampoco en el repo de respaldo) ni los cites en "Fuentes".
   - Si un documento está subido **y** viene en el paquete, vale el subido: alguien lo cargó a propósito. Si se contradicen, es una discrepancia de tipo `docs`.
   - En "Fuentes" de la memoria citá el subido como `<título o categoría> subido al tablero (<fecha>)`.
   - Esos documentos pasaron por un enmascarado básico al subirse, pero pueden traer nombres de personas: **nunca** los copies a la memoria ni a una discrepancia.

   Extraé:
   - propósito;
   - pasos To-Be;
   - tablas de Handover (Work Queues, Assets, Triggers, Robots);
   - excepciones BE/AE;
   - SLAs, volúmenes y horarios;
   - Known Issues;
   - contactos **por rol**, nunca nombres de personas.
5. **Cruce y discrepancias.** Compará código, documentación y Orchestrator. Cada cosa que no coincide es una **discrepancia**: una tarjeta del proyecto que el equipo responde, pospone o descarta desde la pestaña Discrepancias. No van a la bandeja ni cambian la salud del proyecto.

   | `kind` | Qué es |
   |---|---|
   | `orchestrator` | un asset o una cola del SDD o del código que no existe en Orchestrator, o al revés |
   | `code` | un repo o un paquete cuyo código no corresponde al proceso declarado |
   | `queue` | la cola que escribe el Dispatcher no es la que lee el Performer |
   | `version` | una versión desplegada sin tag en git |
   | `trigger` | triggers distintos a lo documentado |
   | `docs` | documentación que no coincide con el código, o dos documentos que se contradicen |
   | `hygiene` | el paquete publica capturas, datos o carpetas internas |
   | `other` | cualquier otra |

   1. Leé las que el proyecto ya tiene: `work/$RUN/db/discrepancies` (las de `projectId == <id>`) y su lado humano en `work/$RUN/db/discrepancyWork`.
   2. Escribí lo que encontraste en `work/$RUN/alta/<id>/discrepancias.json`, como una lista:
      ```json
      [ { "key": "orchestrator:cola:rrhh_nov_items", "kind": "orchestrator", "processId": "performer",
          "title": "La cola RRHH_NOV_Items del SDD no existe en Orchestrator",
          "detail": "Qué se esperaba y qué se encontró, en 1 a 3 frases.",
          "suggestion": "Qué conviene hacer, en una frase.",
          "refs": [ { "source": "SDD.docx · Handover", "note": "Work Queues" }, { "source": "Orchestrator · colas de la carpeta", "note": "no figura" } ] } ]
      ```
      - `key` identifica la discrepancia de un análisis al siguiente: `<kind>:<objeto>`, corta y estable (nombres de colas, assets, triggers o procesos; nunca fechas ni conteos). **Si la discrepancia ya existe, reusá su `key` tal cual**: así conserva su respuesta.
      - Una discrepancia por cosa concreta: tres assets faltantes son tres tarjetas, no una.
      - Todo en el idioma de `config/settings.language` (lo lee `/control-corrida` de `work/$RUN/db/config/settings.json`; por defecto `es`), **sin PII y sin valores de assets**. `refs[].source` es un archivo, una sección o un lugar de Orchestrator.
      - Si una persona respondió "es correcto así" o la descartó, no hace falta que la quites de la lista: el script respeta la respuesta. Tenelo en cuenta en la memoria (paso 6).
   3. Consolidá (determinista):
      ```bash
      node scripts/consolidar-discrepancias.mjs --proyecto <id> --encontradas work/$RUN/alta/<id>/discrepancias.json --db work/$RUN/db --ahora <ISO> --salida work/$RUN/alta/<id>/discrepancias-plan.json
      ```
      Crea las nuevas, suma una detección a las conocidas, cierra (`resolved`) las abiertas que ya no encontraste y vuelve a abrir las que reaparecen. Nunca toca `discrepancyWork`. Sumá sus `writes` al plan del alta.
   4. **Solo si el cruce se completó.** Si no pudiste leer el código o Orchestrator, no corras el script: una lista vacía cerraría discrepancias que siguen ahí.
6. **Memoria de proceso.** `set` de `memory/<id>` con `{projectId, process, productionSummary, sources, updatedAt}`:
   - `process` es Markdown en el idioma de `config/settings.language` (lo lee `/control-corrida` de `work/$RUN/db/config/settings.json`; por defecto `es`), 2 a 4 páginas como máximo. Es un mini-PDD que permite analizar ejecuciones sin releer todo. Secciones:
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
     - Discrepancias encontradas (solo el título de cada una: el detalle y su estado viven en `discrepancies`). Las que el equipo respondió "es correcto así" o descartó van como hecho conocido, con lo que dijo la respuesta, no como problema.
     - Fuentes (archivo + sha; los documentos subidos al tablero, con su fecha)
   - Sin PII y sin valores de assets.
   - `productionSummary`: si ya existía (re-análisis) se conserva. Si no, poné `"Sin historial de producción todavía."`.
7. **Proyecto.** `update` de `projects/<id>` con:
   - `processes` (de `emparejar-procesos`), y `repo: null` si venía del formato anterior;
   - `inventory` (de `inventario.json`);
   - `baseline`;
   - `watermarks.lastJobByProcess` = `ultimoJobPorProceso` de `inventario.json`, solo si no existe ya;
   - `status`: `"review"`, o `"active"` si era un re-análisis de un proyecto activo;
   - `statusNote`: frases cortas, una idea por frase (el tablero muestra cada frase como un punto, plegado en la pestaña Memoria de proceso). No repitas la lista de procesos ni el detalle de las discrepancias: ya se ven en la página.
8. **Reglas iniciales propuestas.** 3 a 6 documentos `rules/<id>-<slug>` con:
   - `{projectId, text, status: "proposed", origin: "onboarding", compiled, compileNote, createdBy: "rutina", createdAt}`;
   - basadas en el SDD (SLAs, excepciones críticas) y el baseline. Por ejemplo, "Si el Dispatcher no corre en más de X h, escalar" o "Más de N items con error de sistema en una hora, escalar";
   - cuando la regla es de un proceso, el `compiled.filter.process` lleva su `orchestratorProcess`.
9. **Criterios de triage del proyecto.** Si `triageCriteria` está vacío, proponelos en `statusNote` como texto sugerido. No los sobrescribas.
10. **Historial.** Agregá una entrada `history` `{projectId, type: "onboarding", at, summary, by: "rutina"}`.

Todo lo escrito pasa por `build-writes`: armá un plan `{writes:[…]}` en `work/$RUN/alta/<id>/plan.json` (con las escrituras de `discrepancias-plan.json`) y ejecutá `node scripts/build-writes.mjs`. Después publicá los lotes con `ArtifactData batch`.

Al terminar, el proyecto queda en **review**. Un Admin lo pasa a `active` desde el tablero, después de revisar la memoria, las discrepancias y las reglas propuestas. Escribí las reglas siempre como `proposed`: si la aprobación automática está activa, `build-writes` las convierte en `active` al armar los lotes.
