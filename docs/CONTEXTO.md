# PROYECTO MAYRIT — Contexto

## Qué es Mayrit
Correduría de seguros y reaseguros **atípica**: intermedia muy pocas pólizas; el grueso del
negocio son **servicios a Agencias de Suscripción** (Alea es cliente de Mayrit, y hay otras).
Mayrit se sitúa **entre las agencias y los Mercados Aseguradores** que ponen la capacidad de
suscripción detrás. Las agencias producen binders y bordereaux; Mayrit los **gestiona, procesa
y liquida** contra los mercados.

**Núcleo crítico (común a todas las agencias):** gestión y procesamiento de **binders + todos
los BDX que cuelgan de ellos + liquidaciones de primas**. Accesorio: compliance, auditorías.

**Facturación (4 modelos):** comisión de binder · comisión de póliza · fees · otras comisiones
(a veces compartidas con la agencia). Lo habitual: % sobre las primas de los BDX.

## Stack
- Backend: **FastAPI + PostgreSQL** (Azure, mismo servidor que Alea, base `mayrit` aparte).
- Frontend: **React + TypeScript** (Vite).
- Sincronización de código entre 3 equipos (oficina/casa/portátil): **Git + GitHub** (privado).

## Sistema actual a sustituir
**Access (VBA) + Listas de SharePoint** (sitio `https://mayritbroker.sharepoint.com/sites/Mayrit-Negocio`).
Anti-patrón a corregir: **una tabla por binder (52 tablas)** + **una de siniestros por binder**.

Tablas/listas actuales y mapeo previsto al modelo nuevo:

| Actual | Qué es | Modelo nuevo |
|---|---|---|
| Corredores | Productores de negocio (corredores **y** agencias, con un `tipo`) | `productores` (con `tipo`; flag `es_cliente` para las agencias) |
| Clientes | Tomadores de las pólizas | `tomadores` (renombrado para evitar confusión) |
| Binders | Binding authority agencia↔mercado | `binders` |
| Mercados Aseguradores | Compañías/sindicatos que ponen capacidad | `mercados` |
| Bdx | Bordereaux por binder | `bdx_lineas` (normalizada, con `binder_id`) |
| (52 tablas por binder) | Líneas de cada binder | → colapsan en `bdx_lineas` |
| Liquidaciones | Liquidación de primas con mercados | `liquidaciones` |
| LPANs | London Premium Advice Note (liquidación de prima en Londres) | `lpan` |
| (siniestros ×52) | Siniestros por binder | `siniestros` (normalizada, con `binder_id`) |
| UCR | Unique Claims Reference | vinculado a `siniestros` |
| Recibos | Recibos de prima | `recibos` |

## Estrategia de migración — "strangler fig"
Modelar desde cero en PostgreSQL y **desconectar tabla a tabla**. Reglas:
- Cada tabla tiene **un único dueño de escritura** en cada momento (Access/SharePoint **o** el
  sistema nuevo, nunca los dos a la vez).
- Durante la convivencia, el sistema nuevo puede **LEER** de SharePoint en solo lectura (puente
  reutilizado de Alea) para dependencias cruzadas; al migrar + verificar un módulo se **desconecta**
  su lista de SharePoint.
- Orden previsto: **(1) Maestras** (Productores/Agencias · Mercados · Binders) → **(2) BDX** (núcleo)
  → **(3) Liquidaciones + LPAN** → **(4) Siniestros + UCR** → **(5) Recibos** → accesorios.
- **"App primero, volcado al final" (decisión 2026-06-15):** NO se copian datos reales a Postgres
  mientras Access siga vivo (evita dos bases divergiendo). Cada módulo se construye con datos de
  prueba; el volcado real se hace UNA vez en el cutover, apagando Access para esa tabla a la vez.

## Sinergia con Alea
El dominio (binders/BDX/UMR/UCR/liquidaciones) solapa mucho con la app de Alea, pero desde el lado
**agregador/intermediario**. Reutilizable: arquitectura, utillaje de SharePoint (`sharepoint.py`),
generación de Word, patrón Postgres-en-Azure.

## Inspección de SharePoint — HECHA (2026-06-15)
Esquema real volcado en `docs/esquema_sharepoint.txt` (138 listas, solo esquema, sin datos).
Setup reutilizado de Alea: misma app `Alea-SharePoint` + mismo certificado; se concedió
`Sites.Selected` (Read) sobre `Mayrit-Negocio` con `backend/tools/conceder_permiso_sharepoint.ps1`.
Credenciales locales en `~/.mayrit/.env` (fuera de Git).

### Lo que confirma el esquema
- **Maestras** (tablas `T*`): `TBinders` (53), `TCorredores` (70), `TClientes` (283),
  `TMercados` (35), `TPolizas` (115), `TCotizaciones` (382), `TBordereaux` (810),
  `TLPAN` (3078), `TLiquidaciones` (4330) y `TLiquidaciones1` (4018, parece versión con
  más campos: `Id`, `Mercado`, `CuentaOrigen/Destino`), `TRecibos` (1063), `TUCR` (86).
- **Catálogos**: `Mayrit - Producto` (32), `Mayrit - Ramo` (11), `TProvincias` (52),
  `TRegiones` (8), `TTasasHIO` (9), `CodigosPostales` (11040), `NCB` (11).
- **Anti-patrón a colapsar**: ~52 listas `Mayrit - B1634…` (líneas de BDX por binder) →
  `bdx_lineas`; ~36 listas `Mayrit - Claims…` (siniestros por binder) → `siniestros`.
- **Accesorio (fuera del núcleo)**: ~20 listas `Contabilidad - *` (movimientos bancarios).

## Fase 1 — Maestras: EN CURSO (2026-06-15)
Base de datos `mayrit` creada en el servidor Azure (PostgreSQL 16, usuario `mayrit_app`,
credenciales en `~/.mayrit/.env`).

**Backend (hecho):**
- `backend/app/db.py` — engine SQLAlchemy, sesión y `Base`.
- `backend/app/models/maestras.py` — `Productor` (de `TCorredores`), `Mercado` (de
  `TMercados`), `Binder` (de `TBinders`). Cada fila lleva `sp_old_id` para casar con
  Access/SharePoint durante la convivencia.
- `backend/alembic/` — migraciones; la inicial ya está **aplicada** (tablas creadas).
  Comandos (desde `backend/`): `alembic revision --autogenerate -m "..."` y `alembic upgrade head`.
- `backend/app/schemas/` + `crud.py` + `routers/maestras.py` — **API REST CRUD** de las 3
  maestras (listar con `?q=`, obtener, crear, editar, borrar). CORS para el frontend.

**Frontend (hecho):**
- `frontend/` — Vite + React + TypeScript. `src/api.ts` (cliente CRUD), `src/types.ts`.
- `src/pages/MercadosPage.tsx` — **pantalla de Mercados completa** (tabla, buscador, alta/
  edición en panel lateral, borrado). Probada de extremo a extremo contra la base real.
- **Identidad visual** aplicada (ver sección Imagen de marca).

Pantallas hechas: **Mercados**, **Productores** y **Tomadores** (CRUD completo), con **menú de
navegación** por pestañas (Productores / Mercados / Tomadores / Binders).
- Productores: tipo Corredor/Agencia de Suscripción + Coverholder Sí/No.
- Tomadores (antes "Clientes", renombrado): tipo Persona física/jurídica, alias opcional,
  dirección completa obligatoria.

**Estructura del menú (dos niveles):** las **Maestras** (Productores, Mercados, Tomadores) van
en la **barra superior**; el **Negocio/núcleo** va en una **barra lateral** izquierda. **Binders
NO es una maestra** — es Negocio (de él cuelgan BDX, Liquidaciones, Siniestros, Recibos), así
que vive en el lateral.

**Pendiente de Fase 1:** pantalla de **Binders** (ahora un placeholder). Luego, cuando estén
listas, el cutover de cada maestra (volcado real + apagar Access), según "app primero, volcado
al final".

## Imagen de marca (estándar a seguir en todo)
- Colores: **naranja `#da5833`** (PANTONE 7579 C) y **gris `#4b4b4b`** (PANTONE 446 C).
- Logo: "MAYRIT" con la Y naranja, **sin el lema "Insurance Broker"**
  (`frontend/src/assets/mayrit-logo.png`, va sobre fondo claro).
- Tipografía: **Aller** (Aller Display para títulos; cuerpo en sans neutra hasta tener las
  Aller normales). Fuentes en `frontend/src/assets/fonts/`.
- Implementado en `frontend/src/styles.css` y `App.tsx`.

## Convenciones de UI (aplicar en todas las pantallas)
- **Paneles de alta/edición:** usar `frontend/src/components/FormPanel.tsx`. Clic fuera NO cierra;
  solo cierran con Cancelar/✕/Esc; si hay cambios sin guardar, avisa y pide confirmación.
- **Imagen de marca:** ver sección anterior (logo, naranja UI `#e07a5a`, gris, fondo gris,
  texto en fuente del sistema).

## Cómo arrancar la app
**Uso normal (un clic):** acceso directo **"Mayrit"** en el Escritorio (icono Y naranja). Arranca
backend+frontend ocultos y abre la app en Edge modo app. En cada equipo nuevo, crearlo una vez con
`powershell -ExecutionPolicy Bypass -File configurar_acceso_directo.ps1`. Para anclarlo a la barra
de tareas: clic derecho → "Anclar a la barra de tareas".
- Lanzador silencioso: `arrancar_mayrit.vbs` · visible (diagnóstico): `arrancar_mayrit_visible.bat`.
- Icono de marca: `mayrit-Y.ico` (regenerable con `backend/tools/generar_icono_y.py`); favicon en
  `frontend/public/favicon.ico`.

**Desarrollo (dos terminales):** requiere venv del backend y `npm install` en el frontend hechos:
- Backend:  `cd backend` · `.venv\Scripts\uvicorn app.main:app --reload`  → http://localhost:8000
- Frontend: `cd frontend` · `npm run dev`  → http://localhost:5173

## Decisión abierta (para más adelante)
Hay `TLiquidaciones` (4330) y `TLiquidaciones1` (4018): decidir cuál es la buena. Relevante en
la Fase 3 (Liquidaciones+LPAN), no ahora.
