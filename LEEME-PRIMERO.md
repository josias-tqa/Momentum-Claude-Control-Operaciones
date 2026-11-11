# Torre de Control de Operaciones UiPath — Instalación en Grupo Momentum

Esta carpeta es la Torre de Control completa: el tablero, la rutina de Claude que controla los
procesos UiPath de producción, sus scripts, sus tests y su documentación. Desde ahora es de Momentum.

**No hace falta leer todo esto a mano. Claude los guía paso a paso.**

## Cómo empezar (5 minutos)

1. Descomprimí el `.zip` en una carpeta de trabajo, por ejemplo `Documentos/torre-de-control`.
2. Abrí **Claude Code** con la cuenta de Claude de Momentum que va a ser **dueña** de la Torre de Control:
   - en la app de escritorio de Claude, pestaña **Code**, elegí esa carpeta; o
   - en una terminal, dentro de la carpeta: `claude`.
3. Escribí:

   ```
   /instalar-torre
   ```

Claude revisa en qué punto están y los lleva fase por fase. Pueden cortar en cualquier momento:
al volver, escriban `/instalar-torre` de nuevo y retoma donde quedó.

## Qué van a necesitar (Claude lo pide en el momento justo)

| Quién | Qué |
|---|---|
| La persona que instala | Node.js 20 o superior y git en su computadora |
| Dueño de la cuenta de Claude | Un plan **Team o Enterprise** con Claude Code habilitado. La misma cuenta publica el tablero y es dueña de la rutina |
| Admin de Bitbucket | Crear el repositorio donde queda guardado este código |
| Admin de GitHub (si se usa el espejo) | Un repositorio privado espejo para que Claude cloud lea el código. Ver `docs/instalacion/bitbucket-y-espejo.md` |
| Admin de UiPath Automation Cloud | Una External Application **de solo lectura** y su asignación a las carpetas de producción. Ver `docs/instalacion/uipath-acceso-cli.md` |

Tiempo estimado: 2 a 3 horas en total, la mayor parte esperando permisos de los administradores.

## Reglas que no cambian

- **Solo lectura.** La Torre de Control nunca inicia, detiene ni modifica nada en Orchestrator.
- **Los secretos nunca van al chat.** Client secrets y tokens se cargan solo en la configuración del entorno de Claude cloud.
- **Sin datos personales en el tablero.** Todo lo que viene de Orchestrator pasa por un redactor de PII antes de publicarse.

El detalle técnico está en `CLAUDE.md` y `README.md`.
