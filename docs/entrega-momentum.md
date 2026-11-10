# Entrega a Grupo Momentum

TQA desarrolla y prueba la Torre de Control con su cuenta. Después Momentum pasa a ser dueña de todo: el repo, el entorno, la rutina y el tablero. Un artifact no se transfiere de cuenta, así que Momentum publica **su propio** tablero desde este repo y migra la configuración.

## Pasos

1. **Repo:** transferir o importar `Momentum-Claude-Control-Operaciones` al GitHub de Momentum. La app de Claude para GitHub tiene que tener acceso.
2. **Cuenta dueña:** una cuenta de servicio en la organización de claude.ai de Momentum (Team o Enterprise). Así los miembros de Momentum tienen los tres roles con permisos reales.
3. **Credenciales propias de Momentum:** una External App de UiPath de solo lectura y un token de Bitbucket de solo lectura. **No se reutilizan las de prueba.**
4. **Entorno cloud** `momentum-operaciones` en la cuenta de Momentum, según `docs/configuracion-cloud.md`. Después, `/verificar-entorno`.
5. **Publicar el tablero:** desde una sesión de esa cuenta, publicar `dashboard/index.html` con las capacidades de `dashboard/capabilities.json`. Se obtiene una URL nueva, con la base vacía.
   - La ayuda ya viene compilada dentro del archivo. Antes de publicar, `npm run check:ayuda` confirma que está al día.
6. **Configurar** `OPS_ARTIFACT_URL` en el entorno con esa URL y correr `/control-mantenimiento seed`.
7. **Migrar** (opcional): en el tablero de TQA, `/control-mantenimiento export`. En el de Momentum, `/control-mantenimiento import`.
   - Se migran proyectos, memorias, reglas e historial.
   - **No** se migran los incidentes ni las corridas de prueba.
   - Los proyectos entran "En revisión" para que el Admin de Momentum los active.
8. **Rutina programada** en la cuenta de Momentum.
9. **Compartir** el tablero: Viewer, Contributor y Editor según el rol de cada persona.
10. **Apagar** la rutina y el entorno de prueba de TQA, y revocar sus credenciales.
