# Recomendaciones de publicación para el equipo de desarrollo

La Torre de Control lee el código y la documentación directamente de los **paquetes publicados en Orchestrator**, en la versión que está en producción. Por eso importa qué entra en cada paquete.

## Que la documentación viaje en el paquete

- Poné `README.md`, o una carpeta `docs/` con el SDD y el Runbook, **en la raíz del proyecto UiPath**. En los repos de Momentum esa raíz es también la raíz del repo.
- Hacelo también en las **librerías**: hoy ValidarEPS no trae documentación.
- No agregues esas rutas a `ignoredFiles` del `project.json`.

## Qué no debería publicarse

Agregá a `designOptions.processOptions.ignoredFiles`:

- `Exceptions_Screenshots/`: capturas de excepción, pueden mostrar datos de pacientes.
- Los archivos reales de `Data/`: `Config.xlsx` con valores reales, CSV de credenciales o de ruteo.
- `.autopilot/`, `.claude/`, `.storage/`: archivos internos de herramientas que no hacen falta en producción.

La Torre de Control **nunca abre** esos archivos, porque extrae solo `.xaml`, `.cs`, `project.json` y documentación. Pero cualquiera con acceso al feed sí podría abrirlos.

## Versiones

- Publicá el proceso y sus librerías con **versiones fijas**. `project.json` ya las fija, por ejemplo `ValidarEPS [1.0.147]`.
- Si el proyecto se versiona en git, agregá el tag `v<versión>` al publicar. Es opcional: la Torre de Control ya no lo necesita.
