# Torre de Control de Operaciones UiPath — Grupo Momentum

Tablero compartido y rutina de Claude para controlar en producción los proyectos UiPath de Grupo Momentum.

La rutina corre periódicamente en Claude cloud. Lee tres fuentes:
- Orchestrator, con el CLI `uip`.
- El código, desde Bitbucket.
- La documentación PDD/SDD de cada proyecto.

Con eso detecta incidentes, los clasifica (triage), los analiza antes de escalarlos y los publica en el
tablero. Ahí el equipo los responde, delega, descarta o pospone, y cada proyecto acumula su memoria de
producción.

**La app solo reporta: nunca cambia código ni configuración en Orchestrator.**

## Estado

| Fase | Estado |
|---|---|
| 0.A — CLI `uip` en Linux cloud, sin credenciales | ✅ Completada ([detalle](docs/validacion-uip-cloud.md)) |
| 0.B — Lecturas reales, Bitbucket y ArtifactData en el entorno de la rutina | ⏳ Pendiente: requiere crear el entorno y las credenciales |
| 1 a 5 — Desarrollo del colector, el tablero, los skills de la rutina, el piloto y la entrega | Bloqueadas hasta el GO de la Fase 0.B |

## Contenido actual

- `docs/validacion-uip-cloud.md`: resultado de la Fase 0, accesos necesarios y comandos de lectura.
- `scripts/setup-entorno.sh`: setup script del entorno cloud.
- `scripts/verificar-entorno.mjs` y el skill `/verificar-entorno`: verificación de la Fase 0.B, reutilizable.
- `config/versiones.json`: versiones fijadas del CLI, el tool de Orchestrator y las skills.
