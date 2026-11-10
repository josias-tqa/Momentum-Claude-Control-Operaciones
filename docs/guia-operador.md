# Guía del tablero para el equipo de Grupo Momentum

## Roles

Los roles se asignan desde el menú **Compartir** del tablero.

| Rol | Acceso en Compartir | Puede |
|---|---|---|
| Lector | Viewer | Ver todo |
| Operador | Contributor | Responder, delegar, posponer, descartar y comentar incidentes |
| Admin | Editor | Además: registrar proyectos, aprobar, ajustar y eliminar reglas, editar criterios y ajustes |

## Cómo moverse

El menú está siempre a la vista: a la izquierda en una computadora, abajo en el teléfono.

| Sección | Para qué |
|---|---|
| **Bandeja** | Lo que hay que mirar ahora. El número indica cuántos temas hay abiertos. |
| **Proyectos** | Estado, memoria, reglas e inventario de cada proyecto. Desde acá se registran proyectos nuevos (Admin). |
| **Corridas** | Cada ejecución de la rutina: qué revisó y qué encontró. |
| **Reglas** | Puntos de control en lenguaje natural. El número indica cuántas propuestas esperan aprobación. |
| **Fuera de bandeja** | Temas abiertos que no se muestran en la bandeja: pospuestos, respondidos, descartados y los que el triage decidió no reportar. En el teléfono está dentro de **Más**. |
| **Ajustes** (Admin) | Criterios de triage, umbrales y retención. En el teléfono está dentro de **Más**. |

Abajo del menú se ve el **estado de la rutina** y cuándo fue el último control. Si la rutina dejó de correr, se marca en rojo y la bandeja lo avisa arriba.

### Filtrar por proyecto

Arriba a la derecha de la Bandeja, Corridas, Reglas y Fuera de bandeja está el selector **Proyecto**:

1. Tocalo y escribí parte del nombre o de la carpeta.
2. Elegí el proyecto con un clic, o con las flechas y Enter.

Cada proyecto muestra un punto de color (verde: sin novedades; ámbar: con avisos; rojo: con problemas P1/P2; gris: pausado o sin datos) y cuántos temas tiene abiertos. Primero aparecen los que tienen temas abiertos.

El filtro queda aplicado en todas esas secciones hasta que lo quites con la **×** al lado del selector.

## La bandeja

- **Para revisar** (solo Admin): reglas propuestas y proyectos recién analizados.
- **Para vos:** incidentes que te delegaron.
- **Requiere acción:** incidentes escalados, ordenados por severidad.
- **Avisos:** cosas para saber, en formato compacto.

Los botones de arriba (**Todo**, **Para vos**, **Requiere acción**, **Avisos**) muestran solo esa parte. El buscador filtra por título, proyecto, categoría o severidad.

## Cada tarjeta es un tema

Si el problema vuelve a ocurrir, **no se crea otra tarjeta**. La misma muestra "×7 · última hace 12 min". Si un tema resuelto vuelve dentro de los 30 días, se reabre la misma tarjeta con la marca "Reapareció".

| Botón | Qué hace |
|---|---|
| **Delegar** | Asigna la revisión a una persona. Le aparece en "Para vos". |
| **Posponer** | Oculta la tarjeta hasta una fecha. Vuelve antes si el problema empeora. |
| **Descartar** | Con un motivo: esperado, falso positivo, dato de negocio o sistema externo. La rutina lo anota en la memoria del proyecto y puede proponer una regla para no volver a avisar. |
| **Responder** | Con una decisión, por ejemplo "requiere fix" (con ticket) o "volver a controlar en…" (con fecha), más notas. Queda en la memoria de producción. |
| **Ajustar regla** / **Crear regla** | Abre el editor de la regla en el mismo tema (ver "Reglas"). Los Operadores ven la regla, sin poder cambiarla. |

Después de posponer, descartar o responder aparece un aviso con **Deshacer** durante unos segundos.

### El detalle de un tema

Un clic en la tarjeta (o en **Ver detalle**) abre el detalle en un panel al costado, sin perder el lugar en la lista. Se cierra con la **×**, con Esc o tocando fuera.

El detalle muestra, en este orden:

1. Las acciones (las mismas de la tarjeta).
2. **Por qué está acá:** el porqué del triage, la decisión y las reglas que aplicaron.
3. **Análisis previo:** hipótesis, acciones sugeridas, código y documentación relacionados.
4. **Evidencia** redactada.
5. **Actividad**, con un cuadro para **comentar** (nota para el equipo).

Si el tema está pospuesto, respondido o descartado, el detalle lo dice arriba y ofrece **Devolver a la bandeja**. Esos temas se encuentran en **Fuera de bandeja**.

**La Torre de Control nunca cambia nada en Orchestrator ni en el código.** Sugiere qué hacer, y lo hace una persona.

## Registrar un proyecto (Admin)

Un **proyecto es una carpeta de Orchestrator**. La rutina detecta sola sus procesos (Dispatcher, Performer, Reporter…), las librerías que usan y la documentación. Todo sale de los paquetes publicados, en la versión que está en producción.

1. **Proyectos** → **Registrar proyecto**. Hay dos formas:
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
- **Volver a analizar**, en el detalle, junto a **Análisis previo**: pide un análisis nuevo en la próxima corrida.

## Corregir la configuración de un proyecto (Admin)

1. Entrá al proyecto desde **Proyectos** y tocá **Editar configuración**, o andá a la pestaña **Configuración**.
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
- **Descartar también este tema** cierra el incidente en el mismo paso, como falso positivo (con **Deshacer** en el aviso).
- El cambio queda anotado en la actividad de la tarjeta.

Si el incidente no salió de ninguna regla, el botón es **Crear regla**: escribís una para ese caso (por ejemplo, "los abandonados de los lunes antes de las 9 son normales; no avisar") y vale para ese proyecto.

En Ver más → **Reglas**, el botón **Editar** abre el mismo editor para cualquier regla.

### Propuestas de la rutina (Admin)

La rutina también propone por su cuenta. Nunca activa nada: todo aparece en **Para revisar**.

- **Reglas por similitud.** Cuando aprobás o editás una regla, la rutina busca otros procesos que usan el mismo portal, la misma aplicación o la misma librería, y les propone la regla equivalente. La propuesta dice por qué ("usa el mismo portal que…"). Se aprueba, se rechaza o se ajusta con **Editar** antes de aprobar.
- **Cambios sugeridos.** Una vez por día la rutina revisa los últimos 30 días y marca con **Cambio sugerido** las reglas que conviene tocar: una excepción o un umbral distinto si la regla avisa y casi siempre se descarta, una severidad más baja si sus tarjetas se posponen, o desactivarla si no dispara hace 60 días. **Revisar** abre el editor con la sugerencia; **Aplicar** la carga en el formulario y vos confirmás con Guardar. **No, gracias** la descarta y no vuelve por 90 días.
- **Reglas nuevas de la revisión diaria.** Si un mismo tema sin regla se descartó varias veces, o un aviso se repite sin que nadie lo mire, llega una regla propuesta.

Como máximo llegan 3 propuestas por proyecto por vez.
