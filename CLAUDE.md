# Torre de Control de Operaciones UiPath — Grupo Momentum

Este repo es el "motor" de la Torre de Control. Una rutina de Claude programada en Claude cloud
controla los proyectos UiPath en producción. Lee tres fuentes:

- Orchestrator, con el CLI `uip`.
- El código, las librerías y la documentación, desde los **paquetes publicados en Orchestrator**, en la versión desplegada. Bitbucket es solo respaldo opcional.

Con eso clasifica lo que encuentra y lo escribe en el tablero compartido (artifact con base de
datos, `OPS_ARTIFACT_URL`, usada sin parámetros como `?sk=…`). El equipo de Momentum opera desde ese tablero.

## Reglas que nunca se rompen

1. **Solo lectura.** Nunca se modifica nada en Orchestrator: no se inician, detienen ni
   reintentan jobs, no se tocan colas, assets ni procesos.
   - Se permiten solo los verbos de lectura de `scripts/lib/uip.mjs`.
   - El hook `.claude/hooks/guard-solo-lectura.mjs` bloquea el resto.
2. **Cero cambios de código.** Los paquetes y repos se descargan en `work/` solo para leerlos.
   - De un paquete se extrae solo la lista blanca de `scripts/lib/paquetes.mjs`: nunca datos, planillas ni capturas.
   - Nunca se hace commit, push ni PR sobre ellos.
   - Si un incidente requiere un fix, se **reporta** con la evidencia y la sugerencia para que lo tome un humano.
3. **PII.** Nada que venga de Orchestrator se escribe en el tablero sin pasar por `scripts/lib/redact.mjs`.
   - Nunca se leen, copian ni resumen valores de assets.
   - Tampoco el `SpecificContent`/`SpecificData`/`Output` de queue items ni capturas de pantalla.
   - Las personas se guardan solo como IDs opacos de la plataforma.
   - Si un texto generado por Claude (análisis, memoria) necesita citar un dato de un caso, se cita la referencia hasheada o el link a Orchestrator, nunca el dato.
4. **Todo se escribe validado.** Las escrituras al tablero salen de `scripts/build-writes.mjs`, que valida contra `schemas/` y busca PII residual.
   - No se escriben documentos "a mano" con ArtifactData salvo los casos que indica cada skill.
   - Esos casos también respetan los esquemas.
5. **Las respuestas humanas mandan.** Un incidente descartado, pospuesto o respondido por un humano no se vuelve a mostrar como nuevo.
   - Su recurrencia se acumula en la misma tarjeta.
6. **Todo cambio en el tablero actualiza su ayuda.** La ayuda vive en `dashboard/ayuda/*.mdx` y se compila dentro de `dashboard/index.html`.
   - Una pantalla, pestaña, botón o etiqueta nueva o cambiada se explica en su `.mdx`: sección, `Accion` o `Termino`. El `breve` es el tooltip.
   - Después: `npm run build:ayuda` y `npm test`. `tests/ayuda.test.mjs` falla si falta una sección o un tooltip, o si el bloque generado quedó viejo.
   - Una ruta nueva también va en `AYUDA_RUTA`; un control interno sin tooltip, en `SIN_TIP`.
7. **Idioma.** Todo el contenido (memorias, análisis, porqués del triage, títulos) se escribe en español.
   - Los identificadores técnicos y los nombres de campos quedan en inglés.

## Mapa

| Qué | Dónde |
|---|---|
| Corrida programada | skill `/control-corrida` |
| Alta de un proyecto (análisis inicial, memoria de proceso) | skill `/control-alta-proyecto` |
| Descubrir y registrar todos los proyectos de Orchestrator | skill `/control-descubrir` |
| Análisis previo a escalar (código + docs) | skill `/control-analisis` |
| Aprendizaje de respuestas humanas (memoria de producción, reglas propuestas) | skill `/control-aprendizaje` |
| Propuestas de reglas: similitud entre procesos y revisión diaria (nunca activa nada) | skill `/control-reglas` |
| Retención, rollups, seed y export/import para la entrega | skill `/control-mantenimiento` |
| Verificación del entorno (credenciales, red, permisos) | skill `/verificar-entorno` |
| Modelo de datos del tablero | `docs/modelo-de-datos.md` y `schemas/` |
| Scripts deterministas (colecta, evaluación, consolidación, lotes) | `scripts/` (tests: `npm test`) |
| Tablero (fuente del artifact) | `dashboard/index.html` |
| Ayuda del tablero (introducción, glosario, pantallas; MDX) | `dashboard/ayuda/*.mdx` → `npm run build:ayuda` |

## Estado de trabajo

- Todo lo intermedio va en `work/<runId>/`, que está en `.gitignore`.
- **Nunca** se escribe estado bajo `.claude/`: las sesiones headless lo rechazan.
