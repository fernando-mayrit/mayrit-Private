# Despliegue de Mayrit en Azure App Service

Objetivo: que todo el equipo use **una única URL** y que cada cambio se publique solo con un
`git push` (sin instalar nada en cada PC). El backend (FastAPI) sirve también el frontend ya
compilado. La base de datos sigue siendo la de Azure (compartida), no cambia.

## Arquitectura
- **1 App Service (Linux, Python)** = backend + frontend (carpeta `backend/static`, generada en el CI).
- **GitHub Actions** ([.github/workflows/deploy.yml](../.github/workflows/deploy.yml)): en cada push a
  `main` compila el frontend, lo mete en `backend/static` y despliega el backend.
- **Migraciones**: [backend/startup.sh](../backend/startup.sh) ejecuta `alembic upgrade head` al arrancar.

---

## 1) Crear el App Service (portal de Azure)
1. *Create a resource* → **Web App**.
2. Grupo de recursos: el mismo de `alea-db` (o uno nuevo "mayrit").
3. **Name**: `mayrit` → la URL será `https://mayrit.azurewebsites.net` (cámbialo si está cogido).
4. Publish: **Code**. Runtime: **Python 3.12**. OS: **Linux**.
5. Región: **Spain Central** (igual que la BD, menos latencia).
6. Plan: **Basic B1** (~12–13 €/mes).
7. Crear.

## 2) Configuración → variables de entorno (App settings)
En el App Service → *Settings → Environment variables → App settings*, añade (los valores de tu
`~/.mayrit/.env`):

| Nombre | Valor |
|---|---|
| `PG_HOST` | host de alea-db (…postgres.database.azure.com) |
| `PG_PORT` | `5432` |
| `PG_DATABASE` | `mayrit` |
| `PG_USER` | `mayrit_app` |
| `PG_PASSWORD` | (la contraseña) |
| `PG_SSLMODE` | `require` |
| `SCM_DO_BUILD_DURING_DEPLOYMENT` | `1` |
| `WEBSITES_PORT` | `8000` |

(Opcionales, cuando toque SharePoint/autologin: `SP_SITE_URL`, `SP_TENANT_ID`, `SP_CLIENT_ID`,
`SP_PFX_PASSWORD`, y el certificado — ver nota al final. `MAYRIT_USUARIO` ya no hace falta con login.)

## 3) Comando de arranque
*Settings → Configuration → Startup Command*:
```
bash startup.sh
```

## 4) Permitir que el App Service llegue a la BD
En el **servidor PostgreSQL** `alea-db` → *Networking* → activa
**"Allow public access from Azure services and resources within Azure"** (o añade las IP de salida
del App Service). Guardar.

## 5) Conectar GitHub (despliegue automático)
1. En el App Service → *Deployment Center* → o más simple: *Overview → Get publish profile*
   (descarga un `.PublishSettings`).
2. En GitHub → repo → *Settings → Secrets and variables → Actions*:
   - **New repository secret**: `AZURE_WEBAPP_PUBLISH_PROFILE` = (pega el contenido del archivo descargado).
   - **Variables → New variable**: `AZURE_WEBAPP_NAME` = `mayrit` (el nombre del paso 1).
3. Lanza el workflow: pestaña **Actions → Deploy Mayrit → Run workflow** (o haz un push).

Al terminar, abre `https://mayrit.azurewebsites.net`.

## 5 bis) Dominio propio: `app.mayritbroker.com`

Para usar una URL propia en vez de `mayrit.azurewebsites.net`.

1. **Azure** → App Service `mayrit` → *Settings → Custom domains → Add custom domain*.
   - Domain provider: *All other domains*. Hostname: `app.mayritbroker.com`. TLS/SSL: *App Service Managed Certificate*.
   - Azure muestra **dos registros** que hay que crear en el DNS del dominio:
     - **CNAME**: `app` → `mayrit.azurewebsites.net`
     - **TXT** (verificación): `asuid.app` → `<Domain verification ID>` (el que indique Azure)
2. **DNS de `mayritbroker.com`** (en el registrador / Microsoft 365 admin → Dominios): añade esos
   dos registros (CNAME `app` y TXT `asuid.app`). Espera a que propaguen (minutos).
3. Vuelve a Azure → *Validate* → *Add*. Queda el dominio añadido.
4. **HTTPS**: Azure crea el **certificado gestionado gratuito** y lo enlaza (SNI SSL). Activa
   *Settings → Configuration →* **HTTPS Only**.
5. Si ya está el login de Microsoft (paso 6), añade `https://app.mayritbroker.com/.auth/login/aad/callback`
   a las **URI de redirección** del registro de app de Entra.

> El workflow de despliegue NO cambia (sigue apuntando al App Service `mayrit`); el dominio es solo
> un alias de entrada.

## 6) Login con Microsoft (Entra ID)
En el App Service → *Settings → Authentication* → **Add identity provider** → **Microsoft**:
- Crea/usa un registro de app de Entra.
- *Restrict access*: **Require authentication**.
- *Unauthenticated requests*: **HTTP 302 (redirige al login)**.

A partir de aquí, entrar exige cuenta de Microsoft de la organización.

---

## Notas
- **Actualizar la app**: `git push` a `main` → se despliega solo → todos refrescan (F5).
- **Certificado de SharePoint**: el `.pfx` es secreto y no está en git. Cuando queramos la
  importación de BDX desde Azure, lo subiremos vía *App Service → Certificates* o Key Vault y
  ajustaremos `SP_PFX_PATH`. Hasta entonces, esa función concreta no funcionará en la nube (el
  resto sí).
- **Python local 3.14 vs Azure 3.12**: el código es compatible; no hay que tocar nada.
