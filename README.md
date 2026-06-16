# Mayrit

Aplicación de gestión para **Mayrit Insurance Broker** — correduría de seguros y reaseguros
cuyo negocio principal son los **servicios a Agencias de Suscripción** (back-office de binders,
procesamiento de BDX y liquidaciones de primas con los mercados aseguradores).

Sustituye gradualmente al sistema actual basado en **Access (VBA) + Listas de SharePoint**,
migrando módulo a módulo (patrón *strangler fig*) hasta poder apagar Access.

## Arquitectura

- **backend/** — API en **FastAPI** + **PostgreSQL** (Azure). Contiene la lógica de negocio.
- **frontend/** — **React + TypeScript** (Vite). La interfaz de usuario.

Los **datos** viven en PostgreSQL (Azure), no en ficheros: accesibles desde todos los equipos a la vez.

## Trabajo desde varios equipos (oficina · casa · portátil)

La sincronización del **código** se hace con **Git + GitHub** (repo privado), NO con OneDrive:

```
git pull      # al empezar a trabajar
git push      # al terminar
```

Lo que **no** va a Git (cada equipo tiene lo suyo, fuera del repo):
- `~/.mayrit/.env` — credenciales de PostgreSQL y SharePoint.
- El certificado `.pfx` de SharePoint (en `~/.mayrit/`).

## Puesta en marcha (resumen)

### Backend
El venv va FUERA del repo (OneDrive rompe los venv que tiene dentro):
```
py -m venv %USERPROFILE%\.mayrit\venv
%USERPROFILE%\.mayrit\venv\Scripts\activate
cd backend
pip install -r requirements.txt
copy .env.example %USERPROFILE%\.mayrit\.env   # y rellenar credenciales
uvicorn app.main:app --reload
```

### Frontend (requiere Node.js LTS instalado)
```
cd frontend
npm install
npm run dev
```

## Estado

Proyecto recién iniciado. Ver `docs/CONTEXTO.md` para el modelo de negocio y el plan de migración.
