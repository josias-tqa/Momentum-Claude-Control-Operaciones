---
name: verificar-entorno
description: Verifica que el entorno cloud de la Torre de Control puede leer Orchestrator con el CLI uip (o con REST como fallback), clonar Bitbucket con un token de solo lectura y escribir en el tablero con ArtifactData sin prompts. Usar al configurar o cambiar el entorno (Fase 0.B), al rotar credenciales, o cuando la rutina falla por acceso o red.
---

# Verificar entorno

Comprobación de solo lectura. **No ejecutar ningún comando `uip` que no sea `login`, `list`, `get`, `logs` o `history`.**
No imprimir, copiar ni resumir valores de secretos, de assets ni de queue items: el script solo reporta
nombres de campos y conteos, y el informe final debe mantener esa regla.

## Pasos

1. Confirmar que el setup script corrió: `uip --version` debe devolver la versión de `config/versiones.json`.
   Si no está instalado, ejecutar `bash scripts/setup-entorno.sh` y anotar en el informe que el setup del
   entorno no está configurado.
2. Ejecutar la verificación:
   ```bash
   node scripts/verificar-entorno.mjs --carpeta "$UIPATH_CARPETA_PRUEBA" --repo "$BITBUCKET_REPO_PRUEBA"
   ```
   Si una variable opcional no existe, omitir el argumento correspondiente.
3. Si existe `OPS_ARTIFACT_URL`, probar la escritura en el tablero con la herramienta `ArtifactData`:
   - `set` en la colección `verificacion`, documento `ping`, con `{ "at": "<ISO ahora>", "origen": "verificar-entorno" }`
     (si el documento ya existe, leerlo primero con `get` y pasar su `version` como `if_version`);
   - `get` del mismo documento para confirmar;
   - `delete` del documento (con `if_version`).
   Registrar si alguna de las llamadas pidió aprobación manual: en una rutina desatendida eso es una falla.
4. Leer `work/verificacion/<marca>/reporte.md` y presentar, en el idioma de `config/settings.language` si ya existe el tablero (si no, en español):
   - el veredicto UiPath (GO / GO CON FALLBACK / NO-GO) y el de Bitbucket;
   - el resultado de ArtifactData;
   - cada comprobación en falla con su causa probable y qué acceso falta (scope de la External App,
     asignación de la app a la carpeta, dominio en la política de red, variable de entorno);
   - las formas de respuesta (nombres de campos) de jobs, logs y queue items, que alimentan el diseño
     del colector.
5. Máximo 2 reintentos por comando. Después de 3 fallas distintas, detenerse y reportar: el problema es
   de configuración, no transitorio.

## Qué significa cada falla habitual

| Síntoma | Causa probable | Arreglo |
|---|---|---|
| `invalid_client` (400) en login | Client ID/secret incorrecto o app deshabilitada | Revisar la External App en Admin > External Applications |
| Login OK pero `403` en `or ...` | Falta el scope o la app no está asignada a la carpeta | Agregar el scope `OR.*.Read` / asignar la app a la carpeta con un rol de solo lectura |
| Lista vacía en la carpeta esperada | Folder path incorrecto o sin acceso a esa carpeta | Verificar `UIPATH_CARPETA_PRUEBA` con `uip or folders list` |
| Host bloqueado por la política de red | Dominio fuera de Allowed domains | Agregar el host a la política de red del entorno |
| `Authentication failed` en Bitbucket | Token vencido, sin `read` de repositorio, o falta `BITBUCKET_USER` para un API token | Regenerar el token de solo lectura |
