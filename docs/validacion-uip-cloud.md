# Validación del CLI de UiPath desde Claude cloud (Fase 0)

Antes de desarrollar la Torre de Control hay que confirmar que la rutina, corriendo en un contenedor Linux
de Claude cloud, puede leer Orchestrator. Este documento registra lo validado y lo que falta.

- **Fase 0.A**: sin credenciales, en un contenedor cloud. **Completada el 2026-11-09.**
- **Fase 0.B**: con credenciales reales, en el entorno `momentum-operaciones`. **Completada el 2026-11-09: GO.** Se ejecuta con el skill `/verificar-entorno`.

## Resultado de la Fase 0.B (2026-11-09) — GO

| Comprobación | Resultado |
|---|---|
| Login headless (client credentials) con los 8 scopes de solo lectura | ✅ |
| Lecturas por CLI: jobs, historial de un job, logs, colas, queue items, assets, procesos, triggers y máquinas | ✅ |
| Fallback REST: token y `GET /odata/Folders` | ✅ HTTP 200 |
| Hosts bloqueados por la política de red | ✅ Ninguno |
| Bitbucket: `ls-remote` y clon superficial | ✅ Para git funciona Basic con usuario `x-token-auth` (access token). Para la API REST funciona Bearer. |
| `ArtifactData` (set / get / delete) desde una sesión del entorno | ✅ **Sin aprobación manual** |

Notas para el diseño:
- `folders list` devuelve 0: la app no lista carpetas a nivel tenant. La rutina consulta siempre con `--folder-path`.
- `jobs logs` solo trae líneas de jobs terminados. Cada línea tiene `Level`, `Message` y `TimeStamp`.
- `assets list` trae el campo `Value`, y los queue items traen `SpecificContent` y `SpecificData`. **El colector los descarta sin guardarlos.**
- `BITBUCKET_REPO_PRUEBA` acepta la URL copiada del navegador. El script la normaliza a `workspace/repo`.

## Resultado de la Fase 0.A

| # | Comprobación | Resultado |
|---|---|---|
| 1 | Instalar `@uipath/cli` desde npm en Linux (Node 22) | ✅ Tarda 1 s. Instala el binario `uip`. |
| 2 | Ejecutar el CLI sin interfaz | ✅ `uip --help` y `uip --version` responden en menos de 0,5 s. |
| 3 | Auto-actualización | ⚠️ El primer comando actualizó el CLI solo, de 1.197.1 a 1.205.0. **Se fija con `uip config set version 1.205.0`.** También se pueden usar `UIPATH_CLI_DISABLE_VERSION_SYNC=true` y `UIPATH_CLI_DISABLE_AUTOINSTALL=true`. |
| 4 | Telemetría | ⚠️ El CLI envía telemetría a Application Insights (`*.in.applicationinsights.azure.com`) y el proxy la bloquea. No afecta el funcionamiento. Se apaga con `UIPATH_TELEMETRY_DISABLED=true`. |
| 5 | Comandos de Orchestrator | ✅ No vienen de fábrica: requieren `uip tools install @uipath/orchestrator-tool`, que también se instala desde npm. |
| 6 | Salida máquina | ✅ Con las variables de la fila 3 la salida es limpia: envelope JSON en stdout (`Result`, `Code`, `Data`; o `ErrorCode`, `Message`, `Retry`) y stderr vacío. Código de salida 1 en error. |
| 7 | Login headless | ✅ Lo soporta: `uip login --client-id env.UIPATH_CLIENT_ID --client-secret env.UIPATH_APP_SECRET -t <tenant> -s "<scopes>"`. Los secretos se leen de variables de entorno y no quedan en argv. |
| 8 | Red hasta UiPath | ✅ Con credenciales falsas, tanto el CLI como REST (`/identity_/connect/token`) llegan a `cloud.uipath.com` y reciben `400 invalid_client`. La red y el proxy funcionan; solo falla la autenticación, como se esperaba. |
| 9 | Red hasta Bitbucket | ✅ `bitbucket.org` responde. |
| 10 | Skills oficiales | ✅ El paquete npm `@uipath/skills@1.205.0` (MIT) trae 32 skills. `uip skills install --agent claude` **no admite instalación local** e instala las 32 globalmente. Por eso el setup script copia solo `uipath-troubleshoot`, `uipath-platform` y `uipath-rpa`. |

### Comandos de lectura que usará la rutina (`uip or …`, CLI 1.205.0)

| Señal | Comando | Filtros útiles |
|---|---|---|
| Carpetas | `folders list`, `folders get` | `--path`, `--all` |
| Jobs | `jobs list` | `--folder-path`, `--state`, `--process-name`, `--created-after`/`--ended-after` (ISO 8601), `--limit`, `--offset`, `--sort-by`, `--all-fields` |
| Historial de un job | `jobs history <key>` | — |
| Logs | `jobs logs <key>` | `--level` (Fatal/Error/Warning/Info/Trace), `--limit`, `--offset` |
| Colas | `queues list`, `queues get-stats <key>` | `--folder-path`, `--name` |
| Queue items | `queue-items list`, `queue-items get-history <key>` | `--queue-name`, `--status` (Failed/Abandoned/…), `--sort-by 'Id desc'`, `--all-fields`. **Sin filtro de fecha**: se pagina por Id descendente hasta el watermark. |
| Assets | `assets list` | `--type`. **Se guardan solo nombre y tipo.** |
| Procesos y versiones | `processes list`, `processes version-history <key>` | `--name` |
| Triggers | `triggers list`, `triggers history <key>` | `--type time\|queue\|api`, `--enabled`/`--disabled` |
| Máquinas | `machines list` | `--folder-path` |
| Auditoría | `audit-logs list` | Para detectar deploys y cambios de configuración |

**Verbos prohibidos para la rutina**, que el hook de solo lectura bloqueará:
- Cualquier `create`, `update`, `delete`, `start`, `stop`, `restart`, `resume`, `rollback`, `assign`, `share`, `add`, `bulk-add` o `set-*`.
- **`assets get-asset-value`**, porque expone el valor de un asset o secreto.
- **`attachments download`** y **`jobs healing-data`**, porque bajan capturas y archivos que pueden tener PII.
- `jobs logs --export`.

## Accesos necesarios (los confirma la Fase 0.B)

| Sistema | Qué hay que crear | Detalle |
|---|---|---|
| UiPath Automation Cloud | **External Application confidencial** (Admin > External Applications) | Application scopes **solo de lectura** de Orchestrator API: `OR.Folders.Read`, `OR.Jobs.Read`, `OR.Queues.Read`, `OR.Assets.Read`, `OR.Execution.Read`, `OR.Monitoring.Read` (logs), `OR.Robots.Read`, `OR.Machines.Read`. Si alguna lectura da 403, el reporte dice cuál falta. |
| Orchestrator | Asignar la External App a cada carpeta de producción a monitorear | Con un rol de carpeta de solo lectura, p. ej. "Monitor Operaciones": View en Jobs, Logs, Queues, Transactions, Assets, Processes, Triggers. Sin la asignación, las lecturas vuelven vacías o 403. |
| Bitbucket Cloud | Token de acceso del workspace o del repositorio, **solo lectura de repositorio** | Si es un API token de Atlassian (usuario + token), también hay que cargar `BITBUCKET_USER`. Sin permisos de escritura: la app solo reporta. |
| Entorno Claude cloud: red | Acceso **Limited** con estos Allowed domains | `cloud.uipath.com`, `bitbucket.org`, `api.bitbucket.org`, con "Allow package managers" marcado (npm). Si 0.B detecta hosts bloqueados, se agregan. |
| Entorno Claude cloud: variables y secretos | Ver la tabla siguiente | Se cargan en la configuración del entorno. **Nunca se pegan en el chat.** |
| Entorno Claude cloud: setup script | Contenido de `scripts/setup-entorno.sh` | Instala el CLI fijado, el tool de Orchestrator y las 3 skills oficiales. No lee secretos. |

### Variables del entorno

| Variable | Secreto | Uso |
|---|---|---|
| `UIPATH_ORG` | no | Nombre lógico de la organización en Automation Cloud |
| `UIPATH_TENANT` | no | Nombre del tenant de producción |
| `UIPATH_CLIENT_ID` | sí | App ID de la External Application |
| `UIPATH_APP_SECRET` | sí | Secret de la External Application |
| `UIPATH_SCOPES` | no | Opcional. Si no está, se usan los scopes de la tabla anterior. |
| `UIPATH_CARPETA_PRUEBA` | no | Folder path de producción para la verificación (con actividad en las últimas 24 h) |
| `BITBUCKET_TOKEN` | sí | Token de solo lectura |
| `BITBUCKET_USER` | no | Solo para un API token de Atlassian |
| `BITBUCKET_REPO_PRUEBA` | no | `workspace/repo` de un proyecto para la verificación |
| `OPS_ARTIFACT_URL` | no | URL del tablero, o de un artifact de prueba en la Fase 0.B |
| `UIPATH_TELEMETRY_DISABLED` | no | `true` |
| `UIPATH_CLI_DISABLE_VERSION_SYNC` | no | `true` |

## Cómo se ejecuta la Fase 0.B

1. Crear el entorno cloud `momentum-operaciones` con la red, las variables y el setup script de este documento.
2. Desde esa sesión, el agente de desarrollo lanza una sesión nueva en ese entorno con el repo
   `Momentum-Claude-Control-Operaciones`. Las variables de entorno solo las ven las sesiones nuevas.
   Esa sesión ejecuta `/verificar-entorno`.
3. El agente lee el transcript de esa sesión. El reporte contiene solo conteos y nombres de campos, nunca datos.
4. Criterio:
   - **GO**: login headless OK y lecturas de jobs, queue items y procesos OK con el CLI.
   - **GO CON FALLBACK**: el CLI falla pero la API REST OData responde con el token de client credentials.
     El colector usa REST con el header `X-UIPATH-OrganizationUnitId` y un User-Agent propio. El default
     de algunos clientes recibe 403 de Cloudflare (lección del harness TQA).
   - **NO-GO**: ninguno responde. Se replantea, por ejemplo con una rutina local por Remote Control.
5. Además: Bitbucket `ls-remote` y clon OK, y escritura con `ArtifactData` **sin pedir aprobación**,
   requisito de una rutina desatendida.

## Código desde paquetes

Verificado el 2026-11-09: `packages download` y `libraries download` traen los `.nupkg` con los `.xaml`, el `project.json` (dependencias exactas) y la documentación. Alcanzan los scopes de solo lectura. La extracción usa la lista blanca de `scripts/lib/paquetes.mjs`.
