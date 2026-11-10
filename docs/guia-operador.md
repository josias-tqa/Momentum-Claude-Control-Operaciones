# Guía del tablero para el equipo de Grupo Momentum

## Roles

Los roles se asignan desde el menú **Compartir** del tablero.

| Rol | Acceso en Compartir | Puede |
|---|---|---|
| Lector | Viewer | Ver todo |
| Operador | Contributor | Responder, delegar, posponer, descartar y comentar incidentes |
| Admin | Editor | Además: registrar proyectos, aprobar, ajustar y eliminar reglas, editar criterios y ajustes |

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
| **Ajustar regla** / **Crear regla** | Abre el editor de la regla en la misma tarjeta (ver "Reglas"). Los Operadores ven la regla, sin poder cambiarla. |
| **Ver detalle** | Muestra el porqué del triage, el análisis previo (hipótesis, código y documentación relacionados, acciones sugeridas), la evidencia y la actividad. |

**La Torre de Control nunca cambia nada en Orchestrator ni en el código.** Sugiere qué hacer, y lo hace una persona.

## Registrar un proyecto (Admin)

Un **proyecto es una carpeta de Orchestrator**. La rutina detecta sola sus procesos (Dispatcher, Performer, Reporter…), las librerías que usan y la documentación. Todo sale de los paquetes publicados, en la versión que está en producción.

1. Ver más → **Registrar proyecto**. Hay dos formas:
   - En **Carpetas detectadas sin registrar**, tocá **Registrar** en la carpeta que quieras.
   - O escribí el nombre y la carpeta a mano.
2. La próxima corrida lo analiza y genera la **memoria de proceso** y reglas propuestas.
3. Revisá todo y tocá **Activar el control de este proyecto**.

Los procesos que se agreguen después a la carpeta se suman solos.

En **Opciones avanzadas** se puede:
- controlar solo algunos procesos de la carpeta;
- cargar un repo de Bitbucket de respaldo;
- agregar documentación adicional.

Normalmente no hace falta.

## Tarjetas con librería o con deploy

- **`ValidarEPS · LoginFamisanar`**: el error ocurrió dentro de esa actividad de la librería. El análisis lee el código de la librería en la versión que usa el proceso. El detalle dice qué otros proyectos usan la misma librería.
- **`Nueva versión 1.0.129`**: se desplegó una versión nueva después de abrirse la tarjeta. La rutina la vuelve a analizar y explica qué cambió.
- **Volver a analizar**, en el detalle: pide un análisis nuevo en la próxima corrida.

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

### Ajustar una regla desde la tarjeta (Admin)

Si un incidente salió de una regla, o una regla lo marcó como conocido, la tarjeta tiene el botón **Ajustar regla**. El editor se abre ahí mismo, sin salir de la bandeja:

| Qué querés | Qué hacés | Desde cuándo vale |
|---|---|---|
| La regla está bien, pero en cierta condición no aplica | Escribí la **excepción** ("es lunes antes de las 9", "es el proceso Reporter") | Próxima corrida |
| Avisa con una gravedad que no corresponde | Elegí otra **severidad** (P1 a P4) | Al guardar |
| El umbral o la condición están mal | Corregí el **texto** de la regla | Próxima corrida |
| No querés que controle por un tiempo | **Desactivar** | Al guardar |
| La regla no sirve | **Eliminar regla**. Pide confirmación y no se puede deshacer | Al guardar |

- Cuando cambia el texto o una excepción, la regla queda "Por compilar": la próxima corrida la vuelve a traducir y muestra cómo la entendió.
- Las excepciones quedan listadas en la regla y se pueden quitar.
- **Descartar también esta tarjeta** cierra el incidente en el mismo paso, como falso positivo.
- El cambio queda anotado en la actividad de la tarjeta.

Si el incidente no salió de ninguna regla, el botón es **Crear regla**: escribís una para ese caso (por ejemplo, "los abandonados de los lunes antes de las 9 son normales; no avisar") y vale para ese proyecto.

En Ver más → **Reglas**, el botón **Editar** abre el mismo editor para cualquier regla.

### Propuestas de la rutina (Admin)

La rutina también propone por su cuenta. Nunca activa nada: todo aparece en **Para revisar**.

- **Reglas por similitud.** Cuando aprobás o editás una regla, la rutina busca otros procesos que usan el mismo portal, la misma aplicación o la misma librería, y les propone la regla equivalente. La propuesta dice por qué ("usa el mismo portal que…"). Se aprueba, se rechaza o se ajusta con **Editar** antes de aprobar.
- **Cambios sugeridos.** Una vez por día la rutina revisa los últimos 30 días y marca con **Cambio sugerido** las reglas que conviene tocar: una excepción o un umbral distinto si la regla avisa y casi siempre se descarta, una severidad más baja si sus tarjetas se posponen, o desactivarla si no dispara hace 60 días. **Revisar** abre el editor con la sugerencia; **Aplicar** la carga en el formulario y vos confirmás con Guardar. **No, gracias** la descarta y no vuelve por 90 días.
- **Reglas nuevas de la revisión diaria.** Si un mismo tema sin regla se descartó varias veces, o un aviso se repite sin que nadie lo mire, llega una regla propuesta.

Como máximo llegan 3 propuestas por proyecto por vez.
