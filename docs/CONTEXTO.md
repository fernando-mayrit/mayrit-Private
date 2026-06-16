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

**Las 4 fuentes de negocio (menú lateral "Negocio"):**
1. **Binders** — HECHO (alta/edición/borrado). Estructura de 3 niveles:
   Binder → **Secciones** → **Mercados con participación %**.
   - Cabecera: **Agreement Number** (obligatorio, mayúsculas) → **UMR** automático = `B1634`+Agreement
     (solo lectura); **Coverholder** = Productor de tipo "Agencia de Suscripción" (FK); **Vigencia**
     (efecto · YOA=año del efecto · vencimiento = efecto+1año−1día, editable); **Estado** (desplegable,
     por defecto "En Vigor" y bloqueado en el alta; estados: En Vigor/Cancelado/Renovado/No
     Renovado/Cerrado); **Moneda** = EUR automática (no se pregunta; columna en tablas).
   - Cada **Sección**: **Ramo** (del catálogo) · **Risk Codes** (varios, de los del ramo) ·
     **Límite de primas** · **Notificación %** · **Comisión %** (≤100) · **Sujeto a PC?** (sí/no) ·
     **Mercados** (varios, con participación %). Todos obligatorios al dar de alta (salvo notas).
     **Límite de primas + Notificación %** son la base de un cálculo FUTURO: comparar la producción
     que se va notificando en cada BDX contra ese límite y **avisar cuando se exceda** (Fase BDX).
   - Cada sección: la **suma de participaciones de sus mercados debe ser 100 %** (con total en vivo).
     Al añadir mercados, el desplegable oculta los ya elegidos en esa sección.
   - **Datos comunes del binder** (debajo de las secciones, no por sección): **Profit Commission**
     (check; solo activable si alguna sección tiene "Sujeto a PC?"; al activarlo aparecen **PC %** y
     **Gastos %**, obligatorios) · **Intervalo + Plazo (días)** para **Risk Bdx**, **Premium Bdx** y
     **Claims Bdx** (intervalo: Mensual/Trimestral/Semestral/Anual) · **Comisión Mayrit %** ·
     **Cuenta bancaria** (del catálogo). Todo obligatorio salvo Notas.
   - Tablas: `binders` (+ columnas comunes), `binder_secciones`, `seccion_mercados`,
     `seccion_risk_codes`. Router propio.
   - **Suplementos = versiones (decisión 2026-06-16).** Un suplemento puede cambiar casi cualquier
     término. Se modela como **snapshot**: el binder normalizado es el estado ACTUAL; la tabla
     `binder_suplementos` guarda cada versión (número 0=alta, 1, 2…) con **fecha de efecto**
     (puede ser **retroactiva**), motivo y una **copia JSON completa de los términos**. La versión
     vigente en una fecha = la de mayor `fecha_efecto ≤ fecha` (lo usará el cálculo de BDX:
     GWP/Notificación según la versión vigente en la fecha de cada BDX). **Editar** el binder =
     corrección de la versión vigente (refresca su snapshot, NO crea versión); **"+ Suplemento"** =
     nueva versión (reutiliza el formulario del binder). En la UI: acción "+ Suplemento" y "Historial".
     Endpoints `GET`/`POST /binders/{id}/suplementos`. En Access NO se llevaba control de suplementos
     (funcionalidad nueva). Pendiente (con BDX): **recálculo** cuando un suplemento sea retroactivo.
   - **El binder es un documento FIJO (decisión 2026-06-16).** En el listado cada fila solo tiene
     **"Editar"**. Al abrir el binder, la ficha está en **solo lectura salvo el Estado** (lo único
     editable; se guarda con PUT, no crea versión). Desde dentro de la ficha hay botones
     **"+ Suplemento"** (pasa a editar como nueva versión) e **"Historial"**, y **"Borrar"** en las
     acciones del panel. No hay edición libre de los términos (eso es un suplemento).
   - **Convención de UI (toda la app):** "Borrar" ya NO está en los listados; vive **dentro del
     formulario** (prop `onDelete` de `FormPanel`, botón rojo a la izquierda de Guardar/Cancelar),
     visible solo al editar un registro existente.
2. **Pólizas** — el negocio de *Open Market* (OM). [pendiente]
3. **Consultoría** — los *fees*. [pendiente]
4. **Comisiones** — negocio del que se generan comisiones pero que no es binder ni póliza. [pendiente]

**Catálogos (Configuración):** **Ramos** — pantalla de gestión (alta/edición/borrado). Cada ramo
tiene varios **Risk Codes** (código único: un risk code pertenece a un solo ramo). Tablas `ramos`
(11 sembrados) y `risk_codes`. Se usan en las secciones de binder (y luego en pólizas).
**Cuentas Bancarias** — pantalla CRUD (`cuentas_bancarias`: nombre, banco, IBAN con validación
mod-97, SWIFT/BIC, moneda, notas). Alimenta el desplegable de cuenta del binder. Las pantallas de
catálogo van con tipografía más pequeña (clase CSS `compacto`).

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

**Datos compartidos (códigos postales):** Mayrit NO duplica el callejero; lee la tabla
`codigos_postales` (~37.900 filas) de la **base `alea`** del mismo servidor, en **solo lectura**.
Como esa tabla es de `aleaadmin` y `alea_app` no puede ceder permisos, Mayrit se conecta a la base
`alea` reutilizando las credenciales de `~/.alea/.env` (ver `ref_database_url` en `config.py` y
`app/codigos_postales.py`). Endpoint: `GET /codigos-postales/{cp}`.

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
- **Fechas:** los campos de fecha van **centrados** en su caja (regla global en `styles.css`:
  `input[type="date"] { text-align: center }`).
- **Selectores en botones:** componente `OptionButtons` (horizontal a partes iguales, o `vertical`).
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

**Desarrollo (dos terminales):** requiere venv del backend y `npm install` en el frontend hechos.
⚠️ El **venv vive FUERA del repo** (en `%USERPROFILE%\.mayrit\venv`), porque el repo está en
OneDrive y OneDrive deshidrata/borra los venv que tiene dentro. Los lanzadores ya apuntan ahí.
- Backend:  `cd backend` · `& "$env:USERPROFILE\.mayrit\venv\Scripts\uvicorn.exe" app.main:app --reload`  → http://localhost:8000
- Frontend: `cd frontend` · `npm run dev`  → http://localhost:5173

## Decisión abierta (para más adelante)
Hay `TLiquidaciones` (4330) y `TLiquidaciones1` (4018): decidir cuál es la buena. Relevante en
la Fase 3 (Liquidaciones+LPAN), no ahora.
