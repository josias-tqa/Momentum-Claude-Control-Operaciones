---
name: instalar-torre
description: Guía paso a paso para que el equipo de Grupo Momentum instale la Torre de Control con su propia cuenta - código en Bitbucket (y espejo en GitHub si Claude cloud lo necesita), acceso de solo lectura a Orchestrator con el CLI uip, entorno cloud, publicación del tablero, seed, rutina programada y primer escaneo de proyectos. Usar cuando piden "instalar", "configurar", "poner en marcha" o "retomar la instalación" de la Torre de Control, o con /instalar-torre.
---

# Instalar la Torre de Control en Grupo Momentum

Sos la guía de instalación. Del otro lado hay una persona de Momentum que puede no conocer Claude Code,
UiPath Admin o Bitbucket en detalle. Tu trabajo es llevarla **fase por fase**, una cosa a la vez, y comprobar
cada paso antes de seguir.

## Cómo guiar

- Hablá en español, claro y concreto. Un paso por mensaje cuando el paso lo hace la persona en otra pantalla
  (UiPath, Bitbucket, GitHub, configuración del entorno). Decí exactamente qué menú tocar y qué escribir.
- Antes de cada fase, decí qué se va a lograr y quién tiene que hacerlo (por ejemplo, "esto lo hace el Admin de UiPath").
  Si esa persona no está, ofrecé preparar el pedido: los documentos de `docs/instalacion/` se pueden reenviar tal cual.
- Después de cada paso, **verificá** (un comando, una lectura, o una pregunta concreta: "¿qué ves en pantalla?").
  Si algo falla, diagnosticá con la tabla de fallas de `/verificar-entorno` y `docs/configuracion-cloud.md`.
- Lo que cambia rápido en el producto (nombres de menús de Claude cloud, rutinas, conectores, fuentes de repositorio)
  **no lo afirmes de memoria**: si tenés la herramienta de documentación del entorno o la de búsqueda web, consultala;
  si no, describí el objetivo y pedí a la persona que te diga qué opciones ve.
- Registrá el avance en `work/instalacion/progreso.md` (fase, fecha, datos **no secretos** decididos: zona horaria,
  workspace de Bitbucket, nombre del entorno, URL del tablero). `work/` no se versiona. **Nunca** escribas estado bajo `.claude/`.
  En una sesión cloud ese archivo no existe: reconstruí el estado con el paso 0.

## Reglas de seguridad durante la instalación

1. **Secretos nunca en el chat.** El App Secret de UiPath y cualquier token se cargan directamente en la configuración
   del entorno de Claude cloud. Si alguien pega uno en el chat, decile que lo rote (generar uno nuevo en UiPath) y no lo repitas.
2. **Credenciales personales, en su terminal.** El `git push` a Bitbucket o GitHub lo corre la persona en su propia terminal.
   Vos le das los comandos. (El hook de solo lectura además bloquea `git push` hacia `bitbucket.org`.)
3. **Solo lectura en Orchestrator**, como siempre (`CLAUDE.md`). La External App no debe tener ningún scope de escritura:
   si la persona propone uno, explicale por qué no.
4. **Sin datos de personas** en el tablero, en el progreso ni en los mensajes: nombres de carpetas y procesos sí; usuarios, mails o valores, no.

## 0. Dónde estamos

Detectá el estado antes de proponer nada:

| Señal | Cómo | Significa |
|---|---|---|
| ¿Sesión local o cloud? | `echo $CLAUDE_CODE_REMOTE` (`true` = cloud) | Local: fases A–D. Cloud: fases E–G |
| Progreso previo | `cat work/instalacion/progreso.md` | Retomar desde ahí |
| Tests | `node --version` (≥ 20) | Fase A |
| ¿Repo git con remoto? | `git remote -v` | Fase B hecha si apunta a Bitbucket |
| CLI de UiPath | `uip --version` | En cloud: el setup script corrió |
| Variables | `node -e "for (const v of ['UIPATH_ORG','UIPATH_TENANT','UIPATH_CLIENT_ID','UIPATH_APP_SECRET','UIPATH_CARPETA_PRUEBA','OPS_ARTIFACT_URL']) console.log(v, process.env[v] ? 'definida' : 'falta')"` | Fase D/E. **Nunca imprimas los valores** |

Mostrá a la persona un resumen de las fases (tabla de `docs/entrega-momentum.md`) marcando cuáles están hechas, y proponé la siguiente.

## Fase A — Revisar el paquete (local, 5 min)

1. Confirmá Node.js ≥ 20 y git. Si faltan, indicá cómo instalarlos para su sistema operativo.
2. `npm ci` y `npm test`. Tienen que pasar todos. Si falla `npm ci` por red, puede ser el proxy de la empresa.
3. `npm run check:ayuda` y `npm run check:i18n`: la ayuda y los textos en español e inglés están al día.
4. **Decisiones** (preguntalas, con estas recomendaciones):
   - **Cuenta dueña:** la cuenta de Claude con la que está esta sesión, ¿es la que va a ser dueña del tablero y la rutina?
     Tiene que ser la **misma** en las fases D a G, en un plan Team o Enterprise con Claude Code on the web habilitado
     (lo habilita un Owner/Admin de la organización de Claude). Recomendado: una cuenta de servicio o compartida de operaciones.
   - **Zona horaria** de Momentum (IANA, por ejemplo `America/Bogota`). Si no es `America/Argentina/Buenos_Aires`,
     cambiá `timezone` en `seed/settings.json` y el ejemplo de cron en `docs/configuracion-cloud.md`, y corré `npm test`.
   - **Idioma** del tablero y de los textos de la rutina: `language` en `seed/settings.json` (`es` o `en`; por defecto `es`). Se puede cambiar después en Ajustes.
   - **Horario de la rutina:** por defecto cada hora, de 6 a 22 los 7 días. Ajustalo a su operación.
   - Revisá con ellos `triageCriteria` y `severityMatrix` de `seed/settings.json`: son los criterios iniciales; después se editan en Ajustes.

## Fase B — Código en Bitbucket (local, 15–30 min)

Seguí `docs/instalacion/bitbucket-y-espejo.md`.

1. **¿Hace falta espejo?** Averiguá si hoy Claude cloud (Claude Code on the web) acepta Bitbucket como fuente de
   repositorio de un entorno o rutina (documentación del entorno o https://code.claude.com/docs/en/claude-code-on-the-web).
   - Si lo acepta: solo Bitbucket.
   - Si no: Bitbucket como fuente de verdad + espejo privado en GitHub con Bitbucket Pipelines. Explicá el porqué en una frase.
2. Commit inicial: podés correr `git init -b main`, `git add -A` y `git commit` vos. Antes, `git status` para confirmar que
   no entra nada de `work/` ni `node_modules/`.
3. La persona crea el repo vacío en Bitbucket y corre en su terminal `git remote add` + `git push -u origin main`.
   Verificá con `git ls-remote origin` (si pide credenciales, que lo corra ella).
4. Si hay espejo: deploy key, known hosts, `GITHUB_ESPEJO`, `bitbucket-pipelines.yml` (copia de `docs/instalacion/bitbucket-pipelines.espejo.yml`),
   commit y push. Pedile que confirme que el pipeline terminó en verde y que el repo de GitHub muestra el mismo último commit.
5. La cuenta dueña conecta GitHub en claude.ai y la **Claude GitHub App** queda instalada en el repo espejo (solo en ese).

## Fase C — Acceso de solo lectura a Orchestrator (Admin de UiPath, 20–40 min)

Seguí `docs/instalacion/uipath-acceso-cli.md`. Si quien instala no es Admin de UiPath, ofrecé ese archivo para reenviarlo.

1. External Application confidencial con **solo** los 8 scopes `OR.*.Read`.
2. Rol de carpeta `Monitor Operaciones` (solo View) y asignación de la app a la(s) carpeta(s) raíz de producción.
3. Rol de tenant con Folders → View (para descubrir subcarpetas).
4. Datos que salen de esta fase: organización, tenant, App ID, App Secret (secretos → directo al entorno), una carpeta
   con actividad en las últimas 24 h para la verificación y la carpeta raíz de producción (para el tablero, fase G).

No se puede verificar desde la computadora local sin exponer el secret: la verificación real es en la fase E.

## Fase D — Entorno cloud `momentum-operaciones` (cuenta dueña, 10 min)

Seguí `docs/configuracion-cloud.md` y la tabla de variables de `docs/validacion-uip-cloud.md`.

1. En https://claude.ai/code, crear el entorno `momentum-operaciones`:
   - **Red:** Limited, con Allowed domains `cloud.uipath.com` (más `bitbucket.org` y `api.bitbucket.org` si van a usar
     Bitbucket como respaldo de código de los proyectos UiPath) y "Allow package managers" marcado.
   - **Setup script:** el contenido de `scripts/setup-entorno.sh`, tal cual.
   - **Variables:** `UIPATH_ORG`, `UIPATH_TENANT`, `UIPATH_CLIENT_ID`, `UIPATH_APP_SECRET`, `UIPATH_CARPETA_PRUEBA`,
     `UIPATH_TELEMETRY_DISABLED=true`, `UIPATH_CLI_DISABLE_VERSION_SYNC=true`. Si la pantalla ofrece una sección de
     secretos separada, el App Secret va ahí. `OPS_ARTIFACT_URL` **todavía no**: se agrega en la fase E.
   - Opcional, respaldo de código: `BITBUCKET_TOKEN` (token **de solo lectura** de repositorios), `BITBUCKET_USER` si es API token
     de Atlassian, `BITBUCKET_WORKSPACES`, `BITBUCKET_REPO_PRUEBA`.
2. Explicale que a partir de acá se sigue en una **sesión nueva en la nube**: en claude.ai/code, nueva sesión, entorno
   `momentum-operaciones`, repositorio de la Torre de Control (o su espejo), y escribir `/instalar-torre`.
3. Anotá en el progreso que la fase D quedó lista y qué datos no secretos se usaron.

## Fase E — Verificar y publicar el tablero (sesión cloud)

1. `/verificar-entorno`. Esperado: **GO** en UiPath. Si no, resolver con su tabla de fallas antes de seguir
   (lo típico: scope faltante, app no asignada a la carpeta, dominio fuera de la red). Las variables nuevas solo las ven las sesiones nuevas.
2. **Publicar el tablero** desde esta sesión (la cuenta dueña):
   - Cargá el skill `artifact-capabilities` y publicá `dashboard/index.html` con la herramienta Artifact, con las
     capacidades de `dashboard/capabilities.json` (sin el campo `_nota`), título "Torre de Control" e ícono `chart`.
   - Si alguna capacidad no está disponible en la cuenta (por ejemplo la base de datos), detenete y explicá qué tiene que
     habilitar un Admin de la organización de Claude.
   - Pasale la URL a la persona. **Esa URL es el tablero de producción:** una publicación desde otro archivo crearía otro tablero vacío.
3. La persona agrega `OPS_ARTIFACT_URL` = esa URL (sin `?sk=…`) a las variables del entorno y abre **otra sesión nueva** con `/instalar-torre`.
4. En la sesión nueva: `/verificar-entorno` otra vez. La escritura con `ArtifactData` tiene que funcionar **sin pedir aprobación**:
   si pidió aprobación, la rutina desatendida va a fallar; revisá con `session.permissions` de la documentación del entorno.

## Fase F — Seed, prueba en seco y rutina (sesión cloud)

1. `/control-mantenimiento seed`. Verificá con `ArtifactData get` de `config/settings` que tiene `triageCriteria` y la zona horaria elegida.
2. `/control-corrida --dry-run`: usa los datos sintéticos de `fixtures/` y no escribe en el tablero. Mostrá el resumen.
3. **Rutina programada** (scheduled task) de la cuenta dueña, según `docs/configuracion-cloud.md`:
   - una sesión nueva en cada disparo, entorno `momentum-operaciones`, este repo (o el espejo) como fuente;
   - cron con la zona horaria de Momentum, en un minuto que no sea :00 (por ejemplo `CRON_TZ=America/Bogota 7 6-22 * * *`);
   - prompt: `Ejecutá /control-corrida.`;
   - notificaciones push al dueño, opcional.
   Guiala en la pantalla de rutinas de claude.ai/code. Si tenés una herramienta para crear tareas programadas y
   podés fijar el entorno y el repositorio, ofrecé crearla vos y confirmá con ella el horario antes de hacerlo.
4. **Primera corrida:** dispará la rutina a mano una vez (o `/control-corrida` en la sesión). En el tablero tiene que
   aparecer una corrida en **Corridas** y la rutina en verde abajo del menú. Con la base vacía la corrida no encuentra
   proyectos: es lo esperado.

## Fase G — Primer uso del tablero (Admin de Momentum)

Seguí `docs/cliente-nuevo.md`, pasos 4 a 8, y `docs/guia-operador.md`:

1. **Compartir** el tablero desde su menú: Admin = Editor, Operador = Contributor, Lector = Viewer.
2. Un Admin entra a **Ajustes → Proyectos a controlar**, escribe la carpeta raíz de producción y toca **Guardar y escanear**.
3. La próxima corrida propone los proyectos. En **Proyectos → Registrar proyecto**: ignorar lo que no es producción y registrar el resto.
4. La rutina hace hasta 3 altas por corrida. Por cada proyecto: revisar discrepancias, subir PDD/SDD/Runbook que falten,
   aprobar o rechazar las reglas propuestas y **activarlo**.
5. Recomendaciones del piloto: empezar con uno o dos proyectos activos; dejar **apagada** la aprobación automática de reglas
   hasta conocer qué propone la rutina; compartir `docs/recomendaciones-publicacion.md` con el equipo de desarrollo UiPath.

## Cierre

Dejá a la persona un resumen con:
- URL del tablero, nombre del entorno, horario de la rutina y repositorios (Bitbucket y espejo);
- **mantenimiento:** fecha de vencimiento del App Secret (agendar la rotación: nuevo secret en UiPath → reemplazar
  `UIPATH_APP_SECRET` en el entorno → `/verificar-entorno`); cómo se actualiza el código (Bitbucket → espejo);
  cómo se republica el tablero (`docs/configuracion-cloud.md`, sección 3); qué mirar si la rutina se pone en rojo (sección 4);
- que la rutina consume uso del plan de Claude de la cuenta dueña en cada disparo.

Marcá la instalación como terminada en `work/instalacion/progreso.md` si estás en local.
