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
| 0 — Validación de `uip` en Claude cloud y de los accesos | ✅ GO ([detalle](docs/validacion-uip-cloud.md)) |
| 1 — Colector, evaluación, consolidación, lotes de escritura (con tests) | ✅ |
| 2 — Tablero publicado (prueba TQA) | ✅ https://claude.ai/artifact/L6VEZqxytm8QYnFJovx93u |
| 3 — Skills de la rutina | ✅ |
| 4 — Rutina programada y piloto con un proyecto real | ⏳ |
| 5 — Entrega a Momentum | Pendiente ([pasos](docs/entrega-momentum.md)) |

## Mapa

| Qué | Dónde |
|---|---|
| Reglas de operación de la rutina | `CLAUDE.md` |
| Skills | `.claude/skills/` (`control-corrida`, `control-alta-proyecto`, `control-analisis`, `control-aprendizaje`, `control-mantenimiento`, `verificar-entorno`) |
| Scripts deterministas | `scripts/` |
| Bloqueo de solo lectura | `.claude/hooks/guard-solo-lectura.mjs` |
| Tablero | `dashboard/index.html` + `dashboard/capabilities.json` |
| Modelo de datos | `docs/modelo-de-datos.md`, `schemas/` |
| Entorno y rutina | `docs/configuracion-cloud.md` |
| Guía para el equipo de Momentum | `docs/guia-operador.md` |

## Tests

```bash
npm test          # scripts: redacción de PII, checks, reglas, dedupe, lotes, hook de solo lectura
npm run test:ui   # tablero en Chromium con datos sintéticos (roles, acciones, filtros, teléfono)
```
