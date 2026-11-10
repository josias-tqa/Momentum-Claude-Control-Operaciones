# Puesta en marcha con un cliente nuevo

La Torre de Control no está atada a Grupo Momentum: el mismo repo sirve para otro tenant de UiPath. Cada cliente tiene **su propio** tablero (artifact), su entorno cloud y sus credenciales. Lo que es de Momentum en este repo es solo texto: los criterios de `seed/settings.json`, la introducción de la ayuda y los nombres de los documentos.

## Antes de empezar

| Qué | Dónde está explicado |
|---|---|
| External App de UiPath de solo lectura, asignada a las carpetas de producción | `docs/validacion-uip-cloud.md`, "Accesos necesarios" |
| Entorno cloud con sus variables y su setup script | `docs/configuracion-cloud.md` |
| Verificación de accesos | skill `/verificar-entorno` |

Para que el escaneo recorra las subcarpetas, la External App necesita además un **rol de tenant que permita ver carpetas** (Folders → View). Sin eso solo se puede leer la carpeta indicada, y el tablero lo avisa.

## Pasos

1. **Publicar el tablero** del cliente: `dashboard/index.html` con las capacidades de `dashboard/capabilities.json`. Queda una URL nueva con la base vacía.
2. **Configurar** `OPS_ARTIFACT_URL` en el entorno y correr `/control-mantenimiento seed`. Revisar los criterios de triage en **Ajustes**: los del seed son los de Momentum.
3. **Programar la rutina** (`docs/configuracion-cloud.md`).
4. **Indicar la carpeta a escanear. Es el primer paso dentro del tablero:**
   1. Un Admin entra a **Ajustes → Proyectos a controlar** y escribe la carpeta de Orchestrator donde están los proyectos de producción, por ejemplo `Produccion`. Si son varias, separadas por coma.
   2. Toca **Guardar y escanear**. El tablero guarda la carpeta en `config/settings.discovery.rootFolders` y deja una solicitud `discover_projects`.
   3. La próxima corrida ejecuta `/control-descubrir` en modo proponer: recorre todo lo que hay adentro y deja en `config/discovery` cada carpeta que tiene procesos.
5. **Revisar los proyectos propuestos** en **Proyectos → Registrar proyecto**:
   - **Ignorar** las carpetas que no son de producción (pruebas, desarrollo).
   - **Registrar** las demás, una por una o todas juntas con **Registrar los N**.
6. **La rutina hace el alta** de cada proyecto, hasta 3 por corrida: inventario, baseline, memoria de proceso, discrepancias y reglas propuestas.
7. **Revisar y activar** cada proyecto. Antes de activar conviene:
   - responder o descartar sus **discrepancias** (pestaña Discrepancias);
   - subir el **PDD, SDD o Runbook** que no venga en el paquete (pestaña Documentación) y pedir un re-análisis;
   - aprobar o rechazar las reglas propuestas.
8. **Compartir** el tablero con los roles de cada persona.

Mientras el tablero no tiene proyectos, la Bandeja y Proyectos muestran los pasos 4 a 6 a los Admin.

## Opcional

- **Aprobación automática de reglas** (Ajustes → Reglas). Viene apagada. Conviene dejarla así durante el piloto, mientras se conoce qué propone la rutina, y encenderla cuando las propuestas ya resultan confiables.
- **Varias carpetas raíz.** Sirve cuando producción está repartida, por ejemplo por área. El escaneo diario propone solas las carpetas nuevas.
