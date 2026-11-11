# Código en Bitbucket (y espejo para Claude cloud)

## Por qué puede hacer falta un espejo

La rutina corre en **Claude cloud** (Claude Code on the web): cada disparo abre una sesión en un contenedor
que clona este repositorio. Al momento de escribir esto, esas sesiones toman el código **desde GitHub**.
Si en el momento de instalar Claude cloud ya admite Bitbucket como fuente de repositorios, no hace falta
espejo: el skill `/instalar-torre` lo verifica primero.

Si no lo admite, el esquema es:

```
Bitbucket (fuente de verdad, donde el equipo hace cambios)
    │  Bitbucket Pipelines, en cada push a main
    ▼
GitHub privado (espejo de solo lectura)  ──►  Claude cloud: entorno + rutina
```

- Nadie trabaja sobre el espejo: todo cambio entra por Bitbucket.
- El espejo es privado y solo lo lee la app de Claude para GitHub.
- La rutina nunca hace push: el bloqueo de solo lectura lo impide.

## 1. Repositorio en Bitbucket

1. Bitbucket → **Create repository**. Nombre sugerido: `torre-control-operaciones`. **Privado.** Sin README ni `.gitignore` (el código ya los trae).
2. Desde la carpeta descomprimida, la persona que instala corre en **su propia terminal** (usa sus credenciales de Bitbucket, que nunca pasan por Claude):

   ```bash
   git init -b main
   git add -A
   git commit -m "Torre de Control de Operaciones: versión inicial"
   git remote add origin https://bitbucket.org/<workspace>/torre-control-operaciones.git
   git push -u origin main
   ```

3. Recomendado: en **Repository settings → Branch restrictions**, exigir pull request para `main`.

## 2. Espejo en GitHub (si hace falta)

1. Crear en GitHub un repositorio **privado** vacío, por ejemplo `<org-momentum>/torre-control-operaciones`.
2. **Llave para el espejo:**
   1. Bitbucket → repo → **Repository settings → Pipelines → Settings**: habilitar Pipelines.
   2. **Repository settings → Pipelines → SSH keys → Generate keys**. Copiar la llave pública.
   3. En la misma pantalla, **Known hosts**: escribir `github.com` → **Fetch** → **Add host**.
   4. GitHub → repo espejo → **Settings → Deploy keys → Add deploy key**: pegar la llave pública, marcar **Allow write access**. Es la única llave con escritura sobre el espejo.
3. **Pipeline:** copiar `docs/instalacion/bitbucket-pipelines.espejo.yml` a la raíz como `bitbucket-pipelines.yml`.
   En Bitbucket → **Repository settings → Pipelines → Repository variables**, crear `GITHUB_ESPEJO` = `<org-momentum>/torre-control-operaciones`.
   Hacer commit y push: el pipeline corre y el espejo queda igual a `main`.
4. **Acceso de Claude:** la cuenta dueña entra a https://claude.ai/code, conecta su GitHub e instala la **Claude GitHub App**
   solo en el repo espejo (o le pide a un owner de la organización de GitHub que la instale).

## 3. Cambios futuros

- Todo cambio de código entra por Bitbucket, idealmente con pull request y `npm test` en verde.
- Si se cambia el tablero (`dashboard/`), después hay que volver a publicarlo en la **misma URL**
  (ver `docs/configuracion-cloud.md`). Los datos de la base no se pierden.
