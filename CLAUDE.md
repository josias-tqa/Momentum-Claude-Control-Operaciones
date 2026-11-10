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
   - Los documentos que sube un Admin (`documents`: PDD, SDD, Runbook) pasan por un enmascarado básico en el tablero, pero pueden traer nombres de personas: se leen, y nunca se copia a la memoria, a un análisis ni a una discrepancia nada que identifique a alguien.
4. **Todo se escribe validado.** Las escrituras al tablero salen de `scripts/build-writes.mjs`, que valida contra `schemas/` y busca PII residual.
   - No se escriben documentos "a mano" con ArtifactData salvo los casos que indica cada skill.
   - Esos casos también respetan los esquemas.
5. **Las respuestas humanas mandan.** Un incidente descartado, pospuesto o respondido por un humano no se vuelve a mostrar como nuevo.
   - Su recurrencia se acumula en la misma tarjeta.
   - Vale igual para las discrepancias de un proyecto: la rutina nunca escribe `discrepancyWork`.
   - Las reglas las aprueba un Admin. La rutina solo las activa por su cuenta con `scripts/aprobar-reglas.mjs`, y solo si un Admin encendió la aprobación automática en Ajustes (`config/settings.autoApproveRules`).
6. **Todo cambio en el tablero actualiza su ayuda, en los dos idiomas.** La ayuda vive en `dashboard/ayuda/<idioma>/*.mdx` (`es/` y `en/`, mismos `id`) y se compila dentro de `dashboard/index.html`.
   - Una pantalla, pestaña, botón o etiqueta nueva o cambiada se explica en el `.mdx` de **cada** idioma: sección, `Accion` o `Termino`. El `breve` es el tooltip. El `nombre` de una `Accion` es el texto del botón en ese idioma.
   - Después: `npm run build:ayuda` y `npm test`. `tests/ayuda.test.mjs` falla si falta una sección o un tooltip en algún idioma, si los idiomas no tienen los mismos `id`, o si el bloque generado quedó viejo.
   - Una ruta nueva también va en `AYUDA_RUTA`; un control interno sin tooltip, en `SIN_TIP`.
7. **Idioma.** El tablero y la rutina funcionan en español (`es`) o inglés (`en`); lo fija un Admin en Ajustes (`config/settings.language`, por defecto `es`).
   - **Tablero:** ningún texto visible se escribe a mano en `dashboard/index.html`. Todo sale de `tx('espacio.clave', {param})` (y `txp(n, 'clave')` para plurales, con `clave.one` y `clave.other`), con su clave en `dashboard/i18n/es/<espacio>.json` **y** en `dashboard/i18n/en/<espacio>.json`. Después `npm run build:i18n`. Sirve para texto, `placeholder`, `aria-label`, `title`, toasts y errores; las etiquetas de valores guardados (categorías, estados...) también van por catálogo. Fechas y horas por `fecha()`/`rel()`.
   - **Rutina:** cada texto se escribe **una sola vez**, en el idioma de `config/settings.language` (nunca en los dos). Los scripts usan `m(lang, 'clave')` con `scripts/lib/mensajes/{es,en}.json`; Claude (triage, análisis, memorias, reglas) escribe directo en ese idioma. Las `firma` de los hallazgos no se traducen: alimentan el fingerprint y deben ser iguales en cualquier idioma.
   - **Lo que no se traduce:** los identificadores técnicos y los nombres de campos (siempre en inglés), los valores guardados (`decision`, `category`, `type`...) y los textos que escribió una persona (notas, comentarios, texto de una regla, documentos). Lo ya guardado queda en el idioma en que se escribió, salvo el título y el porqué de un incidente que se repite: `scripts/consolidar.mjs` los reescribe en el idioma vigente (campo `language` del incidente).
   - `tests/i18n.test.mjs` y `tests/mensajes.test.mjs` fallan si falta una clave en un idioma, si los `{parámetros}` no coinciden, si queda una clave sin usar o un texto escrito a mano (un literal que no es texto de interfaz se marca con `// i18n-ok: motivo`). **Un idioma nuevo** se suma a `IDIOMAS` (`scripts/lib/i18n.mjs`, `scripts/lib/ayuda.mjs`, `scripts/lib/idioma.mjs`) con su carpeta de catálogo y de ayuda; los tests dicen qué falta.

## Mapa

| Qué | Dónde |
|---|---|
| Corrida programada | skill `/control-corrida` |
| Alta de un proyecto (análisis inicial, memoria de proceso) | skill `/control-alta-proyecto` |
| Escanear la carpeta de Ajustes y proponer proyectos (primer paso con un cliente nuevo), o registrar todos | skill `/control-descubrir` · `docs/cliente-nuevo.md` |
| Discrepancias de un proyecto (tarjetas a nivel proyecto, fuera de la bandeja) | `scripts/consolidar-discrepancias.mjs`, desde `/control-alta-proyecto` |
| Aprobación automática de reglas (interruptor de Ajustes) | `scripts/aprobar-reglas.mjs`, desde `/control-corrida` |
| Análisis previo a escalar (código + docs) | skill `/control-analisis` |
| Aprendizaje de respuestas humanas (memoria de producción, reglas propuestas) | skill `/control-aprendizaje` |
| Propuestas de reglas: similitud entre procesos y revisión diaria (nunca activa nada) | skill `/control-reglas` |
| Retención, rollups, seed y export/import para la entrega | skill `/control-mantenimiento` |
| Verificación del entorno (credenciales, red, permisos) | skill `/verificar-entorno` |
| Modelo de datos del tablero | `docs/modelo-de-datos.md` y `schemas/` |
| Scripts deterministas (colecta, evaluación, consolidación, lotes) | `scripts/` (tests: `npm test`) |
| Tablero (fuente del artifact) | `dashboard/index.html` |
| Ayuda del tablero (introducción, configuración inicial, pantallas, glosario; MDX, un juego por idioma) | `dashboard/ayuda/<idioma>/*.mdx` → `npm run build:ayuda` |
| Textos del tablero por idioma (catálogos) | `dashboard/i18n/<idioma>/*.json` → `npm run build:i18n` |
| Textos de los scripts de la rutina por idioma | `scripts/lib/mensajes/<idioma>.json` · `scripts/lib/idioma.mjs` |

## Estado de trabajo

- Todo lo intermedio va en `work/<runId>/`, que está en `.gitignore`.
- **Nunca** se escribe estado bajo `.claude/`: las sesiones headless lo rechazan.
