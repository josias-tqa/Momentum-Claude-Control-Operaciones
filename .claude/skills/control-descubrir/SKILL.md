---
name: control-descubrir
description: Descubre automáticamente los proyectos UiPath de Orchestrator. Escanea la carpeta que un Admin indicó en Ajustes (o todas las que ve la External App), agrupa los procesos por carpeta (Dispatcher, Performer, Reporter...) y propone cada carpeta como proyecto en el tablero; si se pide, también los registra con su solicitud de alta. Usar con una solicitud discover_projects, cuando piden "escanear/descubrir/importar/crear los proyectos", al sumar carpetas a la External App, y como primer paso con un cliente nuevo.
---

# Descubrimiento de proyectos

Solo lectura en Orchestrator y Bitbucket. La única escritura es en el tablero, y pasa por `build-writes`.

## Dos modos

| Modo | Cuándo | Qué escribe |
|---|---|---|
| **Proponer** (por defecto) | Solicitud `discover_projects` (botón **Guardar y escanear** de Ajustes), descubrimiento diario, o "escaneá la carpeta" | Solo `config/discovery`: los proyectos propuestos. Un Admin elige cuáles registrar desde el tablero. |
| **Registrar** | Solo si piden explícitamente "crear/importar/registrar todos los proyectos" | Además crea cada proyecto con su solicitud de alta (pasos 4 a 6). |

**Con un cliente nuevo este es el primer paso:** el Admin escribe en Ajustes la carpeta de Orchestrator donde están los proyectos de producción (`config/settings.discovery.rootFolders`), la rutina la escanea y propone los proyectos. Ver `docs/cliente-nuevo.md`.

## Carpeta a escanear

- `config/settings.discovery.rootFolders`: una o más carpetas raíz. Solo se propone lo que está **adentro** (la raíz incluida). Vacío: se propone todo lo que ve la External App.
- `config/settings.discovery.ignoredFolders`: carpetas que un Admin ignoró desde el tablero. Nunca se registran solas. Siguen en `config/discovery`: el tablero las oculta con su propia lista.
- El script las lee de `--ajustes work/$RUN/db/config/settings.json`. `--raices "A,B"` las reemplaza para una prueba.

## Requisito

La External App solo ve las carpetas a las que está asignada. Con client credentials, Orchestrator **no acepta consultas a todas las carpetas a la vez**: hay que enumerar las carpetas y consultar cada una. El script toma la lista de carpetas de tres fuentes:

1. `folders list --all` y, por cada carpeta raíz, `folders list --path <raíz>`. Necesita que la External App tenga un **rol de tenant con permiso de ver carpetas** (Folders → View).
2. `--carpetas "A/B,C/D"` o la variable `OPS_CARPETAS`, con la lista manual de carpetas de producción.
3. Las carpetas de los proyectos ya registrados.

Si `orchestrator.fuenteCarpetas.listadas` es 0, decilo: falta ese permiso de tenant, o hay que pasar las carpetas a mano. En ese caso solo se revisa la raíz misma, y el script deja el aviso en `config/discovery.note` para que el Admin lo vea en Ajustes.

## Pasos

1. `RUN=desc-<AAAAMMDD>T<HHMM>Z`.
2. Exportá los proyectos ya registrados y los ajustes: `ArtifactData list` de `projects` y de `config`, con `out_dir: work/$RUN/db`. Dentro de una corrida ya están exportados.
3. Descubrí:
   ```bash
   node scripts/descubrir.mjs --salida work/$RUN/candidatos.json --registrados work/$RUN/db/projects \
     --ajustes work/$RUN/db/config/settings.json --plan-tablero work/$RUN/discovery-plan.json [--workspaces <ws1,ws2>]
   node scripts/build-writes.mjs --plan work/$RUN/discovery-plan.json --salida work/$RUN/lotes-discovery
   ```
   - Publicá `lotes-discovery` con `ArtifactData batch` (si `config/discovery` ya existe, con su versión como `if_version`). **En modo proponer, terminá acá**: decí cuántos proyectos quedaron propuestos (`resumen.nuevos`), cuántos están ignorados o fuera de la raíz, y el aviso de `note` si lo hay.
   - Si falla el login, el script no escribe `discovery-plan.json` (`planTablero: false` en su salida): `config/discovery` queda como estaba. Reportá el error; en una solicitud `discover_projects`, marcala `error` con el motivo.
   - Los workspaces de Bitbucket salen de los proyectos ya registrados, de `BITBUCKET_WORKSPACES` o de `--workspaces`.
   - Bitbucket es opcional (solo respaldo): el código sale de los paquetes de Orchestrator. Sin `BITBUCKET_TOKEN` se omite.
4. (Modo registrar) Revisá los candidatos antes de crear nada:
   - Descartá carpetas que claramente **no son producción**: nombres como `Test`, `QA`, `Dev`, `UAT`, `Pruebas`, `Sandbox`, `Personal` o `Shared` sin procesos productivos. Listalas en el resumen como omitidas y explicá por qué.
   - Una carpeta con procesos de **varios proyectos** (por ejemplo, prefijos distintos como `FIN_…` y `RRHH_…`) se parte en un proyecto por prefijo. Editá `candidatos.json` antes del paso 5.
   - Si un proceso tiene `reposAlternativos`, hay más de un repo con ese paquete. Quedó el más reciente: mencionalo en el resumen.
5. Armá y validá el plan:
   ```bash
   node scripts/plan-descubrimiento.mjs --candidatos work/$RUN/candidatos.json --salida work/$RUN/plan.json
   node scripts/build-writes.mjs --plan work/$RUN/plan.json --salida work/$RUN/lotes
   ```
   - Sin `--incluir-inactivos` se omiten las carpetas sin jobs en los últimos 30 días. Las que están fuera de la carpeta raíz y las ignoradas se omiten siempre.
6. Publicá los lotes con `ArtifactData batch`.
7. Resumen en español:
   - proyectos creados: carpeta, procesos, cuáles quedaron sin repo;
   - omitidos, con el motivo;
   - cuántos repos se leyeron.

   Las altas las procesa la rutina horaria, **hasta 3 por corrida** para no pasarse del tiempo. Con N proyectos tardan ⌈N/3⌉ horas.

**Ningún proyecto queda activo solo.** Cada uno queda "En revisión" después de su alta, y un Admin lo activa. Así el costo de las corridas horarias crece solo con lo que se activa.
