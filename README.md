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
| Skills | `.claude/skills/` (`control-corrida`, `control-alta-proyecto`, `control-descubrir`, `control-analisis`, `control-aprendizaje`, `control-reglas`, `control-mantenimiento`, `verificar-entorno`) |
| Scripts deterministas | `scripts/` |
| Bloqueo de solo lectura | `.claude/hooks/guard-solo-lectura.mjs` |
| Tablero | `dashboard/index.html` + `dashboard/capabilities.json` |
| Ayuda del tablero (español e inglés) | `dashboard/ayuda/<idioma>/*.mdx`, compilada dentro de `dashboard/index.html` con `npm run build:ayuda` |
| Textos del tablero (español e inglés) | `dashboard/i18n/<idioma>/*.json`, compilados dentro de `dashboard/index.html` con `npm run build:i18n` |
| Modelo de datos | `docs/modelo-de-datos.md`, `schemas/` |
| Entorno y rutina | `docs/configuracion-cloud.md` |
| Guía para el equipo de Momentum | `docs/guia-operador.md` |
| Puesta en marcha con un cliente nuevo | `docs/cliente-nuevo.md` |

## Tests

```bash
npm test          # scripts: redacción de PII, checks, reglas, dedupe, lotes, discrepancias, escaneo, hook de solo lectura
npm run test:ui   # tablero en Chromium con datos sintéticos (roles, acciones, filtros, ajustes, discrepancias, documentos, ayuda, teléfono)
npm install && npm run build:ayuda   # regenera la ayuda después de editar dashboard/ayuda/<idioma>/*.mdx
npm run build:i18n                    # regenera los textos después de editar dashboard/i18n/<idioma>/*.json
```
