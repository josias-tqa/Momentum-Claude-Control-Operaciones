# Torre de Control de Operaciones UiPath — Grupo Momentum

Este repo es el "motor" de la Torre de Control. Una rutina de Claude programada en Claude cloud
controla los proyectos UiPath en producción. Lee tres fuentes:

- Orchestrator, con el CLI `uip`.
- El código, desde Bitbucket.
- La documentación de cada proyecto.

Con eso clasifica lo que encuentra y lo escribe en el tablero compartido (artifact con base de
datos, `OPS_ARTIFACT_URL`, usada sin parámetros como `?sk=…`). El equipo de Momentum opera desde ese tablero.

## Reglas que nunca se rompen

1. **Solo lectura.** Nunca se modifica nada en Orchestrator: no se inician, detienen ni
   reintentan jobs, no se tocan colas, assets ni procesos.
   - Se permiten solo los verbos de lectura de `scripts/lib/uip.mjs`.
   - El hook `.claude/hooks/guard-solo-lectura.mjs` bloquea el resto.
2. **Cero cambios de código.** Los repos de los proyectos se clonan en `work/` solo para leerlos.
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
6. **Idioma.** Todo el contenido (memorias, análisis, porqués del triage, títulos) se escribe en español.
   - Los identificadores técnicos y los nombres de campos quedan en inglés.

## Mapa

| Qué | Dónde |
|---|---|
| Corrida programada | skill `/control-corrida` |
| Alta de un proyecto (análisis inicial, memoria de proceso) | skill `/control-alta-proyecto` |
| Análisis previo a escalar (código + docs) | skill `/control-analisis` |
| Aprendizaje de respuestas humanas (memoria de producción, reglas propuestas) | skill `/control-aprendizaje` |
| Retención, rollups, seed y export/import para la entrega | skill `/control-mantenimiento` |
| Verificación del entorno (credenciales, red, permisos) | skill `/verificar-entorno` |
| Modelo de datos del tablero | `docs/modelo-de-datos.md` y `schemas/` |
| Scripts deterministas (colecta, evaluación, consolidación, lotes) | `scripts/` (tests: `npm test`) |
| Tablero (fuente del artifact) | `dashboard/index.html` |

## Estado de trabajo

- Todo lo intermedio va en `work/<runId>/`, que está en `.gitignore`.
- **Nunca** se escribe estado bajo `.claude/`: las sesiones headless lo rechazan.
