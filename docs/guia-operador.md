# Guía del tablero para el equipo de Grupo Momentum

## Roles

Los roles se asignan desde el menú **Compartir** del tablero.

| Rol | Acceso en Compartir | Puede |
|---|---|---|
| Lector | Viewer | Ver todo |
| Operador | Contributor | Responder, delegar, posponer, descartar y comentar incidentes |
| Admin | Editor | Además: registrar proyectos, aprobar reglas, editar criterios y ajustes |

## La pantalla principal

- **Arriba:** un chip por proyecto con un punto de color. Verde: todo bien. Ámbar: hay avisos. Rojo: hay problemas P1/P2. Gris: pausado o sin datos. **Un clic filtra todo por ese proyecto.**
- **A la derecha:** cuándo fue el último control. Si la rutina dejó de correr, se ve en rojo.
- **Para revisar** (solo Admin): reglas propuestas y proyectos recién analizados.
- **Para vos:** incidentes que te delegaron.
- **Requiere acción:** incidentes escalados, ordenados por severidad.
- **Avisos:** cosas para saber, en formato compacto.
- **Ver más**, al pie: corridas, no reportados, proyectos, reglas y ajustes.

## Cada tarjeta es un tema

Si el problema vuelve a ocurrir, **no se crea otra tarjeta**. La misma muestra "×7 · última hace 12 min". Si un tema resuelto vuelve dentro de los 30 días, se reabre la misma tarjeta con la marca "Reapareció".

| Botón | Qué hace |
|---|---|
| **Delegar** | Asigna la revisión a una persona. Le aparece en "Para vos". |
| **Posponer** | Oculta la tarjeta hasta una fecha. Vuelve antes si el problema empeora. |
| **Descartar** | Con un motivo: esperado, falso positivo, dato de negocio o sistema externo. La rutina lo anota en la memoria del proyecto y puede proponer una regla para no volver a avisar. |
| **Responder** | Con una decisión, por ejemplo "requiere fix" (con ticket) o "volver a controlar en…" (con fecha), más notas. Queda en la memoria de producción. |
| **Comentar** | Nota para el equipo, en la actividad de la tarjeta. |
| **Ver detalle** | Muestra el porqué del triage, el análisis previo (hipótesis, código y documentación relacionados, acciones sugeridas), la evidencia y la actividad. |

**La Torre de Control nunca cambia nada en Orchestrator ni en el código.** Sugiere qué hacer, y lo hace una persona.

## Registrar un proyecto (Admin)

Un **proyecto** agrupa sus **procesos**, por ejemplo un Dispatcher, un Performer y un Reporter. Normalmente comparten la carpeta de Orchestrator y cada uno tiene su propio repositorio.

1. Ver más → **Registrar proyecto**. Completá:
   - el nombre;
   - la carpeta de producción de Orchestrator;
   - los procesos: por cada uno, su nombre, el repo de Bitbucket (sirve la URL copiada del navegador) y la rama.
     - Opcional: el nombre del proceso en Orchestrator. Si lo dejás vacío, el análisis lo detecta.
     - Opcional: la documentación del proceso.
     - Opcional: una carpeta propia, si no usa la del proyecto.
   - Con **+ Agregar proceso** sumás más procesos.
2. La próxima corrida analiza el proyecto:
   - inventario y baseline de 30 días;
   - el código de cada repo y la documentación;
   - empareja cada repo con su proceso de Orchestrator y avisa si un repo no corresponde.
   - Genera la **memoria de proceso** y propone reglas.
3. Revisá la memoria y las reglas, y tocá **Activar el control de este proyecto**.

## Corregir la configuración de un proyecto (Admin)

1. Entrá al proyecto (Ver más → Proyectos) y tocá **Editar configuración**, o andá a la pestaña **Configuración**.
2. Ahí podés cambiar:
   - el nombre;
   - la carpeta;
   - los repos;
   - agregar o quitar procesos;
   - la documentación y los criterios de triage.
3. **Guardar y re-analizar** guarda los cambios y pide a la próxima corrida que vuelva a analizar el proyecto: memoria, inventario y emparejamiento.
   - Si el proyecto ya estaba activo, sigue activo.
   - **Solo guardar** no dispara el análisis.

## Reglas

Se escriben en lenguaje natural, por ejemplo: "si se ven más de 10 errores de login seguidos, escalar". La rutina las traduce a un control y muestra cómo las entendió.

Las reglas que nacen de respuestas a incidentes llegan como **propuestas**. Un Admin las aprueba o rechaza.
