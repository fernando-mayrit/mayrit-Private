# Instalar Mayrit en un equipo nuevo

Guía paso a paso para dejar Mayrit funcionando en un PC con Windows que no lo tenía.
Probada de extremo a extremo (oficina · casa · portátil). Tiempo aproximado: 15–20 min.

> **Resumen mental:** el *código* viene de GitHub; los *datos* viven en PostgreSQL (Azure) y
> son compartidos por todos los equipos; las *credenciales* (`~/.mayrit/.env` + certificado
> `.pfx`) son de cada equipo y NO están en Git. Instalar = clonar código + poner credenciales
> + instalar dependencias.

---

## 0. Requisitos previos (instalar una vez por equipo)

Necesitas tres herramientas. Comprueba si ya están abriendo PowerShell y ejecutando:

```powershell
git --version
py --version      # o:  python --version
node --version
```

Lo que falte, instálalo (PowerShell; lo más cómodo es `winget`):

| Herramienta | Para qué | Instalación |
|---|---|---|
| **Git** | traer/sincronizar el código | `winget install --id Git.Git -e` |
| **Python 3.12+** | backend (FastAPI) | `winget install --id Python.Python.3.12 -e` (o desde la Store) |
| **Node.js LTS** | frontend (React/Vite) | `winget install --id OpenJS.NodeJS.LTS -e` |

> **Importante:** tras instalar con winget, **cierra y vuelve a abrir PowerShell** (o reinicia
> sesión) para que el `PATH` se actualice. Si `node` se instaló pero `npm install` falla con
> *"node no se reconoce…"*, es justo este problema: abre una terminal nueva.

---

## 1. Clonar el repositorio

El repo va **en `C:\Dev\mayrit`** en todos los equipos (misma ruta → los scripts y accesos
directos funcionan igual en todos). **Fuera de OneDrive**.

```powershell
git clone https://github.com/fernando-mayrit/mayrit-Private.git C:\Dev\mayrit
cd C:\Dev\mayrit
```

> Si pide login, usa la cuenta `fernando-mayrit` (repo privado). Con `gh auth login` o un
> Personal Access Token se hace una sola vez.

---

## 2. Credenciales locales (`~/.mayrit\.env`)

Estos ficheros **no** están en Git: hay que crearlos en cada equipo. Van en
`C:\Users\<tu-usuario>\.mayrit\` (carpeta privada, fuera de OneDrive).

```powershell
mkdir $env:USERPROFILE\.mayrit -Force
copy C:\Dev\mayrit\backend\.env.example $env:USERPROFILE\.mayrit\.env
notepad $env:USERPROFILE\.mayrit\.env
```

Rellena en el `.env` los valores reales (los no-secretos ya vienen puestos en la plantilla):

```ini
# PostgreSQL (Azure) — base 'mayrit', mismo servidor que Alea
PG_HOST=alea-db.postgres.database.azure.com
PG_PORT=5432
PG_DATABASE=mayrit
PG_USER=mayrit_app          # ← rellenar
PG_PASSWORD=********         # ← rellenar (secreto)
PG_SSLMODE=require

# SharePoint (puente de SOLO LECTURA durante la migración)
SP_TENANT_ID=1e9cd105-...    # ← rellenar
SP_CLIENT_ID=35b41519-...    # ← rellenar (app Alea-SharePoint)
SP_SITE_URL=https://mayritbroker.sharepoint.com/sites/Mayrit-Negocio
SP_PFX_PATH=C:\Users\<tu-usuario>\.mayrit\mayrit-sp.pfx   # ← ajustar tu usuario
SP_PFX_PASSWORD=********     # ← rellenar (secreto)
```

**Certificado de SharePoint:** copia el fichero `mayrit-sp.pfx` (el mismo de Alea) a
`C:\Users\<tu-usuario>\.mayrit\mayrit-sp.pfx`. Pásalo por un medio seguro (USB / gestor de
contraseñas), nunca por Git ni email.

> **Códigos postales (opcional, recomendado):** la pantalla de direcciones lee el callejero de
> la base `alea`. Si este equipo también tiene Alea configurado (`C:\Users\<tu-usuario>\.alea\.env`),
> Mayrit lo reutiliza automáticamente en solo lectura. Si no, esa función concreta no estará
> disponible, pero el resto de la app funciona igual.

---

## 3. Backend (FastAPI)

Crea el entorno virtual **FUERA del repo** (en `%USERPROFILE%\.mayrit\venv`) e instala
dependencias. ⚠️ Importante si el repo está en OneDrive: OneDrive deshidrata/borra los venv,
así que el entorno NO debe vivir dentro del repo.

```powershell
py -m venv $env:USERPROFILE\.mayrit\venv
& "$env:USERPROFILE\.mayrit\venv\Scripts\python.exe" -m pip install --upgrade pip
cd C:\Dev\mayrit\backend
& "$env:USERPROFILE\.mayrit\venv\Scripts\pip.exe" install -r requirements.txt
```

Las tablas ya existen en la base `mayrit` de Azure (compartida). **No** hace falta crear nada;
las migraciones de Alembic solo se ejecutan cuando alguien cambia el modelo:

```powershell
# Solo si el modelo cambió y este equipo va por detrás (desde backend\):
& "$env:USERPROFILE\.mayrit\venv\Scripts\alembic.exe" upgrade head
```

---

## 4. Frontend (React + Vite)

```powershell
cd C:\Dev\mayrit\frontend
npm install
```

> Si `npm install` falla en `esbuild` con *"node no se reconoce…"*, es el `PATH`: abre una
> **terminal nueva** (paso 0) y repite. Node debe estar accesible como `node` a secas.

---

## 5. Arrancar la app

### Opción A — Uso normal (un clic)

Crea el acceso directo **"Mayrit"** (icono Y naranja). Una sola vez por equipo:

```powershell
cd C:\Dev\mayrit
powershell -ExecutionPolicy Bypass -File configurar_acceso_directo.ps1
```

Aparece en el Escritorio y en el menú Inicio. Para anclarlo a la barra de tareas: abre Inicio,
escribe "Mayrit", clic derecho → **Anclar a la barra de tareas**. Arranca backend + frontend
ocultos y abre la app en Edge modo app.

### Opción B — Desarrollo (dos terminales, ver logs)

```powershell
# Terminal 1 — backend
cd C:\Dev\mayrit\backend
& "$env:USERPROFILE\.mayrit\venv\Scripts\uvicorn.exe" app.main:app --reload   # → http://localhost:8000

# Terminal 2 — frontend
cd C:\Dev\mayrit\frontend
npm run dev                                             # → http://localhost:5173
```

Abre **http://localhost:5173** en el navegador. La API está en http://localhost:8000
(documentación interactiva en http://localhost:8000/docs).

> El backend tarda unos segundos en quedar listo (conecta a Azure al arrancar). Si el navegador
> da *ERR_CONNECTION_REFUSED* nada más arrancar, espera ~10 s y recarga.

---

## 6. Trabajo diario desde varios equipos

El código se sincroniza con Git (los datos ya son comunes vía Azure):

```powershell
cd C:\Dev\mayrit
git pull        # AL EMPEZAR a trabajar (trae lo de los otros equipos)
# ...trabajar...
git push        # AL TERMINAR
```

Si un `git pull` trae cambios en dependencias, vuelve a lanzar `pip install -r requirements.txt`
(backend) y/o `npm install` (frontend), y `alembic upgrade head` si cambió el modelo.

---

## Resolución de problemas

| Síntoma | Causa probable | Solución |
|---|---|---|
| `ERR_CONNECTION_REFUSED` en localhost | servidores no arrancados / aún arrancando | Lanza el acceso directo o las dos terminales; espera ~10 s |
| `npm install` falla en esbuild ("node no se reconoce") | Node no está en el `PATH` de la terminal | Abre una terminal **nueva** tras instalar Node |
| Backend arranca pero `/health` falla | credenciales PG mal o sin red a Azure | Revisa `~/.mayrit\.env`; comprueba conexión al servidor |
| Error de SharePoint / certificado | falta el `.pfx` o ruta/contraseña mal | Copia `mayrit-sp.pfx` a `~/.mayrit\` y revisa `SP_PFX_*` |
| `git clone` pide login y no entra | repo privado | Autentícate con la cuenta `fernando-mayrit` (gh / PAT) |

---

## Checklist rápido (equipo nuevo)

- [ ] Git, Python 3.12+ y Node LTS instalados (terminal reabierta)
- [ ] `git clone … C:\Dev\mayrit`
- [ ] `~/.mayrit\.env` creado y relleno + `mayrit-sp.pfx` copiado
- [ ] backend: `py -m venv %USERPROFILE%\.mayrit\venv` (FUERA del repo) + `pip install -r requirements.txt`
- [ ] frontend: `npm install`
- [ ] acceso directo creado (`configurar_acceso_directo.ps1`) **o** las dos terminales
- [ ] http://localhost:5173 abre la app
