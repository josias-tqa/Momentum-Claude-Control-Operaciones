# Acceso de solo lectura a Orchestrator para la Torre de Control

Para el **Admin de UiPath Automation Cloud** de Momentum. Se puede reenviar tal cual.

La Torre de Control lee Orchestrator con el CLI oficial de UiPath (`uip`, paquete npm `@uipath/cli`),
autenticado como una **External Application confidencial** con permisos solo de lectura. No usa ningún
usuario humano ni licencia de robot.

## 1. Crear la External Application

1. Automation Cloud → **Admin** → **External Applications** → **Add Application**.
2. Nombre: `Torre de Control - solo lectura`. Tipo: **Confidential application**.
3. **Add scopes** → Resource: **Orchestrator API Access** → pestaña **Application scope(s)**. Marcar solo estos:

   | Scope | Para qué |
   |---|---|
   | `OR.Folders.Read` | Recorrer las carpetas de producción |
   | `OR.Jobs.Read` | Jobs y su historial |
   | `OR.Monitoring.Read` | Logs de los jobs |
   | `OR.Queues.Read` | Colas y queue items (estado y motivo de falla) |
   | `OR.Assets.Read` | **Nombre y tipo** de los assets. El valor nunca se lee: el CLI lo bloquea |
   | `OR.Execution.Read` | Procesos, versiones y paquetes publicados (de ahí sale el código) |
   | `OR.Robots.Read` | Robots |
   | `OR.Machines.Read` | Máquinas |

   **Ningún scope `.Write`.** Si después falta alguno, `/verificar-entorno` dice cuál.
4. Guardar. Anotar el **App ID** y el **App Secret** en el gestor de contraseñas de Momentum.
   - El secret se muestra una sola vez.
   - **No lo manden por mail ni lo peguen en el chat de Claude.** Se carga directo en el entorno de Claude cloud.
   - Anotar también cuándo vence, para rotarlo antes.

Además hacen falta dos datos no secretos: el **nombre lógico de la organización** y el **nombre del tenant**,
tal como aparecen en la URL: `https://cloud.uipath.com/<organizacion>/<tenant>/orchestrator_`.

## 2. Rol de carpeta de solo lectura

1. Orchestrator → **Tenant** → **Manage Access** → **Roles** → **Create Folder Role**.
2. Nombre: `Monitor Operaciones`.
3. Permisos **solo View** en: Jobs, Logs, Queues, Transactions, Assets, Processes, Packages, Triggers,
   Robots, Machines, Folders. Nada de Create, Edit ni Delete.

## 3. Asignar la app a las carpetas de producción

1. Orchestrator → **Folders** → la carpeta **raíz** donde están los proyectos de producción (por ejemplo `Produccion`).
2. **Assign Account / Group** → buscar la External App `Torre de Control - solo lectura` → rol `Monitor Operaciones`.
3. Si la asignación se hace en la carpeta raíz, se hereda a las subcarpetas. Si producción está repartida
   en varias carpetas raíz, repetir en cada una.

Sin esta asignación las lecturas vuelven vacías o con 403.

## 4. Rol de tenant para el escaneo de subcarpetas

Para que la Torre de Control **descubra sola** los proyectos dentro de la carpeta raíz:

1. **Tenant** → **Manage Access** → **Roles** → **Create Tenant Role** `Monitor Operaciones - Tenant`, con **Folders → View**.
2. **Manage Access** → **Assign roles** → la External App → ese rol.

Sin este paso solo se puede leer la carpeta indicada, y el tablero lo avisa.

## 5. Qué le pasan al equipo que instala

| Dato | Secreto | Dónde se carga |
|---|---|---|
| Nombre de la organización (`UIPATH_ORG`) | no | Variable del entorno de Claude cloud |
| Nombre del tenant (`UIPATH_TENANT`) | no | Variable del entorno |
| App ID (`UIPATH_CLIENT_ID`) | sí | Variable del entorno, **la carga quien administra la cuenta de Claude** |
| App Secret (`UIPATH_APP_SECRET`) | sí | Variable del entorno, ídem |
| Una carpeta de producción con actividad en las últimas 24 h (`UIPATH_CARPETA_PRUEBA`) | no | Variable del entorno, para la verificación |
| La carpeta raíz de producción | no | Se escribe en el tablero: **Ajustes → Proyectos a controlar** |

## Seguridad: por qué es seguro

- La app solo tiene scopes de lectura; aunque alguien intentara escribir, Orchestrator lo rechazaría.
- Además, la Torre de Control trae un bloqueo propio (`.claude/hooks/guard-solo-lectura.mjs`) que impide
  cualquier comando `uip` que no sea de lectura, la lectura de valores de assets y la descarga de capturas o adjuntos.
- De los paquetes publicados se extraen solo `.xaml`, `.cs`, `project.json` y documentación. Nunca planillas, datos ni capturas.
- Para revocar el acceso en cualquier momento: deshabilitar la External App.
