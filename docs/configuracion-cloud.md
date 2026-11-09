# Configuración en Claude cloud: entorno y rutina programada

## 1. Entorno `momentum-operaciones`

Cómo crearlo y qué accesos necesita está en `docs/validacion-uip-cloud.md`, en la sección "Accesos necesarios".

| Parte | Valor |
|---|---|
| Red | Limited con Allowed domains `cloud.uipath.com`, `bitbucket.org` y `api.bitbucket.org`, más package managers |
| Setup script | Contenido de `scripts/setup-entorno.sh` |
| Variables | `UIPATH_ORG`, `UIPATH_TENANT`, `UIPATH_CLIENT_ID`, `UIPATH_APP_SECRET`, `BITBUCKET_TOKEN`, **`OPS_ARTIFACT_URL`** (URL del tablero), `UIPATH_TELEMETRY_DISABLED=true`, `UIPATH_CLI_DISABLE_VERSION_SYNC=true` |

Después de cambiar variables, correr `/verificar-entorno` en una sesión nueva del entorno.

## 2. Rutina (scheduled task)

- **Tipo:** una sesión nueva en cada disparo, en el entorno `momentum-operaciones`, con este repo como fuente.
- **Frecuencia:** cada hora en horario operativo. El mínimo habitual de la plataforma es 1 hora.
  - Ejemplo de cron: `CRON_TZ=America/Argentina/Buenos_Aires 7 6-22 * * *`, que corre a los :07 entre las 6 y las 22.
  - Usar la zona horaria real de Momentum.
- **Prompt:** "Ejecutá /control-corrida."
- **Notificaciones:** push al dueño cuando una corrida termina con algo relevante (opcional).

La rutina corre como la cuenta dueña del tablero. Por eso es la única que puede escribir corridas e incidentes.

Para probar sin tocar UiPath: `/control-corrida --dry-run` usa los fixtures sintéticos y no escribe en el tablero.

## 3. Si algo falla

| Síntoma en el tablero | Qué mirar |
|---|---|
| "Rutina detenida" en rojo | La rutina programada está pausada o falla al arrancar. Revisar su historial de ejecuciones. |
| Tarjeta de categoría "Monitoreo": "no pudo iniciar sesión" | Secret de la External App vencido o rotado. Correr `/verificar-entorno`. |
| Proyecto en estado "Con error" | Leer el `statusNote` del proyecto. Suele ser que la External App no está asignada a esa carpeta. |
