---
name: control-descubrir
description: Descubre automáticamente los proyectos UiPath de Orchestrator (todas las carpetas que ve la External App), los agrupa por carpeta con sus procesos (Dispatcher, Performer, Reporter...), empareja (opcional) cada proceso con un repo de Bitbucket de respaldo y los registra en el tablero con su solicitud de alta. Usar cuando piden "descubrir/importar/crear todos los proyectos" o al sumar carpetas nuevas a la External App.
---

# Descubrimiento de proyectos

Solo lectura en Orchestrator y Bitbucket. La única escritura es en el tablero, y pasa por `build-writes`.

## Requisito

La External App solo ve las carpetas a las que está asignada. Con client credentials, Orchestrator **no acepta consultas a todas las carpetas a la vez**: hay que enumerar las carpetas y consultar cada una. El script toma la lista de carpetas de tres fuentes:

1. `folders list --all`. Necesita que la External App tenga un **rol de tenant con permiso de ver carpetas** (Folders → View).
2. `--carpetas "A/B,C/D"` o la variable `OPS_CARPETAS`, con la lista manual de carpetas de producción.
3. Las carpetas de los proyectos ya registrados.

Si `orchestrator.fuenteCarpetas.listadas` es 0, decilo: falta ese permiso de tenant, o hay que pasar las carpetas a mano.

## Pasos

1. `RUN=desc-<AAAAMMDD>T<HHMM>Z`.
2. Exportá los proyectos ya registrados: `ArtifactData list` de `projects`, con `out_dir: work/$RUN/db`.
3. Descubrí:
   ```bash
   node scripts/descubrir.mjs --salida work/$RUN/candidatos.json --registrados work/$RUN/db/projects [--workspaces <ws1,ws2>]
   ```
   - Los workspaces de Bitbucket salen de los proyectos ya registrados, de `BITBUCKET_WORKSPACES` o de `--workspaces`.
   - Bitbucket es opcional (solo respaldo): el código sale de los paquetes de Orchestrator. Sin `BITBUCKET_TOKEN` se omite.
4. Revisá los candidatos antes de crear nada:
   - Descartá carpetas que claramente **no son producción**: nombres como `Test`, `QA`, `Dev`, `UAT`, `Pruebas`, `Sandbox`, `Personal` o `Shared` sin procesos productivos. Listalas en el resumen como omitidas y explicá por qué.
   - Una carpeta con procesos de **varios proyectos** (por ejemplo, prefijos distintos como `FIN_…` y `RRHH_…`) se parte en un proyecto por prefijo. Editá `candidatos.json` antes del paso 5.
   - Si un proceso tiene `reposAlternativos`, hay más de un repo con ese paquete. Quedó el más reciente: mencionalo en el resumen.
5. Armá y validá el plan:
   ```bash
   node scripts/plan-descubrimiento.mjs --candidatos work/$RUN/candidatos.json --salida work/$RUN/plan.json
   node scripts/build-writes.mjs --plan work/$RUN/plan.json --salida work/$RUN/lotes
   ```
   - Sin `--incluir-inactivos` se omiten las carpetas sin jobs en los últimos 30 días.
6. Publicá los lotes con `ArtifactData batch`.
7. Resumen en español:
   - proyectos creados: carpeta, procesos, cuáles quedaron sin repo;
   - omitidos, con el motivo;
   - cuántos repos se leyeron.

   Las altas las procesa la rutina horaria, **hasta 3 por corrida** para no pasarse del tiempo. Con N proyectos tardan ⌈N/3⌉ horas.

**Ningún proyecto queda activo solo.** Cada uno queda "En revisión" después de su alta, y un Admin lo activa. Así el costo de las corridas horarias crece solo con lo que se activa.
