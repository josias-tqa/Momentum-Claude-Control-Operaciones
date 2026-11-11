# Instalación en Grupo Momentum

Momentum es dueña de todo: el código, el entorno cloud, la rutina y el tablero. Todo corre con la cuenta de
Claude de Momentum y con credenciales propias de Momentum. El tablero arranca con la base vacía y los
proyectos se descubren desde cero escaneando Orchestrator.

**La guía interactiva es el skill `/instalar-torre`** (`.claude/skills/instalar-torre/SKILL.md`). Para
empezar, ver `LEEME-PRIMERO.md`.

## Resumen de fases

| Fase | Qué | Dónde | Detalle |
|---|---|---|---|
| A | Revisar la carpeta y correr los tests | Claude Code en la computadora de quien instala | `npm ci && npm test`, `npm run check:ayuda`, `npm run check:i18n` |
| B | Guardar el código en Bitbucket (y el espejo de solo lectura en GitHub, si hace falta) | Bitbucket / GitHub | `docs/instalacion/bitbucket-y-espejo.md` |
| C | Acceso de solo lectura a Orchestrator | UiPath Automation Cloud | `docs/instalacion/uipath-acceso-cli.md` |
| D | Entorno cloud `momentum-operaciones` (red, setup script, variables) | claude.ai/code | `docs/configuracion-cloud.md` |
| E | Verificar accesos y publicar el tablero | Sesión cloud en ese entorno | `/verificar-entorno`, `dashboard/capabilities.json` |
| F | Seed, prueba en seco y rutina programada | Sesión cloud | `/control-mantenimiento seed`, `/control-corrida --dry-run` |
| G | Primer uso: carpeta a escanear, registrar y activar proyectos, compartir | Tablero | `docs/cliente-nuevo.md`, `docs/guia-operador.md` |

## Decisiones que toma Momentum

- **Cuenta dueña.** La misma cuenta de Claude publica el tablero, crea el entorno y es dueña de la rutina:
  solo el dueño del tablero puede escribir corridas e incidentes. Conviene una cuenta de servicio o
  compartida del área de operaciones, para que no dependa de una persona.
- **Zona horaria** de los horarios de la rutina y del tablero (`seed/settings.json`, `timezone`).
- **Horario de la rutina** (por defecto, cada hora en horario operativo).
- **Bitbucket como respaldo de código** de los proyectos UiPath (opcional: el código ya sale de los paquetes publicados en Orchestrator).

La migración de datos (`/control-mantenimiento export`/`import`) no se usa en esta instalación.
