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
     **Comisión %** (≤100) · **Sujeto a PC?** (sí/no) · **Mercados** (varios, con participación %).
     Todos obligatorios al dar de alta (salvo notas).
   - **Límite de Primas = grupos (decisión 2026-06-16).** El **Límite de primas + Notificación %**
     NO vive en la sección: es un **grupo de límite** (`BinderLimite`) que cubre **1..N secciones**.
     En el formulario, un selector de **Ámbito** (debajo de las secciones) ofrece 3 modos —los dos
     comunes en un clic y el flexible debajo—: **Todo el binder** (1 grupo con todas), **Por sección**
     (1 grupo por sección, el comportamiento previo) y **Por grupos** (subconjuntos; cada sección se
     marca en su grupo, asignación tipo radio → cada sección en exactamente 1 grupo). Tablas:
     `binder_limites` (límite + notificación) + `binder_secciones.limite_id` (FK, `SET NULL`).
     **Límite + Notificación %** son la base de un cálculo FUTURO: comparar la producción notificada
     en los BDX de **todas las secciones de un mismo grupo** contra ese límite y **avisar al exceder**
     (Fase BDX). El snapshot del suplemento guarda `limites` + el `limite_grupo` de cada sección.
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
- **Matiz "app primero" — cohorte inerte (decisión 2026-06-16):** la regla anterior solo evita la
  divergencia de datos **vivos** (escribibles a la vez en ambos lados). Los binders **ya cerrados e
  inertes** en SharePoint no se vuelven a tocar → migrarlos antes NO duplica ni diverge. Por eso la
  migración se hace **por cohortes según ciclo de vida**: (a) **cohorte inerte** = binders Cerrado/No
  Renovado con **toda su cadena cerrada** (sin siniestros/UCR abiertos, liquidaciones y recibos
  cuadrados, sin movimientos esperados; colchón temporal p. ej. cerrados hace > N meses) → se migran
  ya como **histórico de solo lectura**; (b) **cohorte viva** (En Vigor / con BDX en curso) → cutover
  al final con disciplina de único escritor. "Cerrado" en la cabecera NO basta: la cola larga de
  siniestros puede seguir viva.
- **Volcado binder a binder, controlado (decisión 2026-06-16):** NADA de migración en bloque masiva.
  El volcado es **uno a uno**: se importa un binder con toda su cadena, se **verifica**, y solo
  entonces se pasa al siguiente. Así un error se detecta y corrige aislado. Idempotente: usar
  `sp_old_id` para casar filas y una **marca de "migrado"** por binder para no procesarlo dos veces.
  El mismo importador servirá luego para los Excel de BDX del día a día (mismo modelo de datos).

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

## Fase 2 — BDX (núcleo): EN CURSO (2026-06-16)
**Decisiones de modelado:**
- **Un único BDX por binder** (no por periodo). Los periodos nuevos se añaden como más líneas y se
  distinguen por `reporting_period_start` **a nivel de línea** (columnas `reporting_period_start` /
  `reporting_period_end` en `bdx_lineas`).
- **Risk = la tabla entera; Premium = subconjunto de columnas**, no una tabla aparte. La misma fila
  lleva `incluido_en_premium` (bool) y `premium_bdx` (fecha). (4 columnas nuevas en `bdx_lineas`,
  migración `c2d3e4f5a6b7`.)

**Origen y carga (decisión 2026-06-16):** los Risk BDX se traen **directamente de cada lista
`Mayrit - <UMR>` de SharePoint** (no por Excel para el histórico). Las maestras (agencia, mercados…)
las crea el usuario a mano; el importador NO las toca. Volcado **uno a uno y verificado** (ver
"Volcado binder a binder").

**Lector de SharePoint:** `backend/app/sharepoint.py` (SOLO LECTURA, auth por certificado vía
`settings.sp_*` de `~/.mayrit/.env`). Mapea columnas por **Título visible** (estable entre listas;
el InternalName varía) con el dict `MAPEO`. Endpoint de previsualización (sin escribir):
`GET /binders/{id}/bdx/sharepoint-preview` → nº líneas, periodos, sumas y muestra. Probado contra
listas reales (CY0118ALE: 93 líneas; CY0219ALE: 133, 10 periodos).

**Normalizaciones pendientes para el import real (vistas en el preview):**
- Los **% vienen como fracción** en SharePoint (0.8 = 80 %, 0.264 = 26,4 %) → **×100** al importar
  (en la app los % se guardan como entero, p. ej. 80).
- **"Original Currency Premium" trae la MONEDA** (`'EUR'`), no un importe; **"Sum Insured Currency"**
  trae un importe. El nombre de columna no coincide con el significado / con nuestro tipo → revisar
  el mapeo de esas dos al importar.
- `Premium Payment Date` viene como texto `dd/mm/aaaa`; las fechas vienen con hora/`Z` → tomar la
  parte de fecha.
- `_OldID` → `sp_old_id` por línea (clave de idempotencia).

**Importador (HECHO 2026-06-16):** `backend/app/bdx_import.py` + `POST /binders/{id}/bdx/import`.
Crea/rellena el **BDX único** del binder (tipo Risk), **idempotente por `sp_old_id`** (re-importar
actualiza, no duplica), y devuelve **conciliación** (nº líneas y suma GWP SharePoint↔Postgres).
Coacción por el tipo de cada columna del modelo. Decisiones tomadas con datos reales:
- **`_OldID` se expone como `OData__OldID`** (SharePoint antepone `OData_` a campos que empiezan por
  `_`); el lector lo resuelve. Es la clave de idempotencia.
- **Dinero = 2 decimales (céntimos).** El origen trae **ruido de coma flotante** (9–13 decimales, p. ej.
  `294,3999999999998`), no precisión real → se **cuantiza a la escala de la columna** (dinero 2, % 4)
  al guardar. La conciliación redondea cada línea a céntimos antes de sumar.
- **% ×100** (origen en fracción: 0,8 → 80,0000).
- Importes con coma/punto (miles y decimal europeos); fechas sin hora.

**Verificado SOLO en `B1634CY0219ALE` (binder 12):** 133 líneas, 10 periodos, idempotente (2ª pasada =
133 actualizadas, 0 nuevas), conciliación **OK** (GWP 322.178,69 = 322.178,69).

**Plantillas que varían por binder (decisión 2026-06-16):** las listas de SharePoint NO tienen los
mismos títulos de columna. p. ej. CY0219 usa "Commission **Coverholder** %/Amount" (CY0118 "Commission
%/Amount"), "Transaction Type (Original **premium**…)", "Sum insured **Amount**" (vs "Our Line"), y una
columna "Fees". Por eso el lector (`app/sharepoint.py`) mapea por **alias** (lista de títulos posibles
por campo) con coincidencia exacta y luego por prefijo. **Hallazgo importante:** lo que el Access llama
"GWP" en el cálculo de PC es el **GWP *our line*** (`total_gwp_our_line`), no el GWP al 100%. Tras
corregir el mapeo, el binder 12 cuadra con el Access del usuario (GWP our line 289.929,21 ≈ 289.929,19;
Comisión Coverholder 81.144,18 ≈ 81.144,17). El primer import perdió la comisión (salía 0) por usar
solo los títulos de CY0118.

**Regla de cálculo (decisión 2026-06-16): la base de TODOS los cálculos es el GWP *our line*** =
`total_gwp_our_line` (lo suscrito × Written Line %, nuestra participación), NO el GWP al 100%
(`gross_written_premium`). Aplica a este binder y a todos los futuros (totalizadores de la tabla y
cálculo de PC). **Profit Commission (pestaña Cálculos):** GWP our line − Comisiones (Coverholder +
Mayrit, **medias reales** de los importes de los BDX: Coverholder = `commission_coverholder_amount`,
Mayrit = `brokerage_amount`; pueden variar por operación) → Net to UWs; − Siniestralidad
(Indemnización/Fees, Pagado/Reservas, editable simulada) − IBNR (**% manual sobre GWP**) − UW Expenses
(Gastos % del binder × GWP) = Total Outcome; **Resultado** = GWP − Total Outcome; **PC** = PC % ×
Resultado (sin recortar el negativo). Verificado contra el Access del usuario en CY0219ALE.
Pendiente menor: el dinero se guarda a 2 decimales por línea, así que las sumas pueden diferir ~2
céntimos del Access (que redondea al sumar); si hace falta cuadre exacto, subir la escala a 4 decimales.

**UI de BDX (hecho 2026-06-16):** en la ficha del binder, pestaña BDX → tabla `BdxTabla` con
columnas ordenables, **reordenables arrastrando**, ocultables (clic derecho), **filtro por columna
estilo Excel**, contador (líneas filtradas + GWP + Prima a Mayrit), columnas calculadas (Pdte.
Cobro/Traspaso/Liq.) y configuración **persistida** en localStorage (clave `mayrit.bdx.columnas.v3`).
Botón **"⬆ Subir Excel"** abre un **selector de carpeta servido por el backend**
(`GET /bdx/excel-dir`, base en `settings.bdx_excel_dir`) — de momento solo deja **elegir** el fichero.

**⏳ TAREA PENDIENTE — parser de Excel (día a día):** falta el código que, al elegir un `.xlsx`
en "Subir Excel", lo **lea y vuelque** las líneas al BDX del binder (equivalente a `bdx_import.py`
pero leyendo de Excel en vez de SharePoint: mapear columnas, ×100 en %, importes coma/punto, fechas
sin hora, idempotencia). Requiere ver primero la **estructura real** de los Excel de las agencias
(carpeta de Alea) para fijar el mapeo de columnas. Aparcado mientras se pulen otras cosas del front.

**Próximo paso:** UI para lanzar el preview/import desde la app (pantalla de Migración) y seguir
binder a binder.

## Sesión 16-17/06/2026 — ficha del binder (pestañas) y cálculos
- **Pestañas de la ficha del binder** (`BinderDetalle.tsx`), en este orden: **Bloqueo · Datos · BDX ·
  Cálculos · Siniestros · Triangulación**. (La que abre por defecto es **BDX**.)
- **Datos:** tabla "Cifras por mes (Reporting Start)" con **GWP our line · Net Premium to Broker ·
  Recibo** y un **check por fila**. Marcar meses **filtra la tabla BDX** por ese `reporting_period_start`
  (filtro bidireccional: "Quitar filtros" en BDX también limpia los checks de Datos).
- **BDX:** la tabla (`BdxTabla`) tiene cabeceras fijas (sticky), scroll propio (no de página),
  columnas ordenables/reordenables (drag)/ocultables (clic derecho) y **filtro por columna estilo
  Excel**; persistencia en localStorage **`mayrit.bdx.columnas.v4`** (orden por defecto: Certificado,
  Asegurado, Risk Bdx, Prima a Mayrit, Incluido Premium, Premium Bdx, Cobrado, Pdte. Cobro, Traspasado,
  Pdte. Traspaso, Liquidado, Pdte. Liq.). Cuadro de **totales 4 columnas** arriba a la derecha
  (GWP our line/Pólizas[pdte]/Líneas · Prima a Mayrit/Cobrado/Pdte Cobro · A traspasar/Traspasado/Pdte ·
  A liquidar/Liquidado/Pdte). Botones (Subir Excel, + Nueva línea) en la misma fila que los totales.
- **Cálculos:** cuadro de **Profit Commission** que replica el Access del usuario (ver arriba la regla).
  La caja de **IBNR** va en ámbar (campo a rellenar). Verificado contra Access en CY0219ALE.
- **Bloqueo (REAL/persistido, 17/06/2026):** tabla de 3 columnas (Risk/Premium/Claims BDX) con sus
  meses; **clic en la fila del mes cierra/abre el candado** y lo guarda en Postgres (tabla
  `bdx_bloqueos`: binder_id + tipo `risk`/`premium`/`claims` + periodo `YYYY-MM`, endpoints
  GET/POST/DELETE `/binders/{id}/bloqueos`). **Efecto:** una línea cuyo periodo Risk (reporting start)
  o, si está incluida en Premium, su mes `premium_bdx`, esté bloqueado → en la pestaña BDX sale con
  **🔒** (columna izquierda, fila resaltada) y al abrirla el panel es **solo consulta** (inputs
  deshabilitados, sin Guardar/Borrar). El backend rechaza con **409** crear/editar/borrar líneas de un
  periodo bloqueado (`_exigir_no_bloqueada` en `routers/bdx.py`). Claims sin meses (sin módulo de
  siniestros). **OJO pendiente:** la importación (SharePoint/Excel) aún NO respeta el bloqueo (puede
  sobrescribir líneas de un periodo cerrado); falta blindar el import.
- **Diseñador de formulario de línea** (`BdxLineaPanel.tsx`): botón "✎ Diseñar" → arrastrar campos,
  columnas por grupo, mostrar/ocultar, renombrar; persistido (`mayrit.bdxlinea.layout.v1`).
- **Formato único** (`frontend/src/format.ts`): `fmtMiles` (miles con punto, agrupa también los de 4
  cifras, que es-ES no agrupaba) y `fmtFechaES` (dd/mm/aaaa en toda la app).
- **Pendiente de contenido:** blindar la **importación** frente a periodos bloqueados (arriba);
  pestañas **Siniestros** y **Triangulación** (placeholder); contar **Pólizas**; parser de Excel.

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

## Recibos — comisión de Mayrit (núcleo facturación/contabilidad, 17/06/2026)
La **BD más importante**. Flujo: subir/importar un Risk BDX → **generar su recibo de comisión**.
**Regla: 1 recibo por Risk BDX** = por (binder, periodo de reporte `YYYY-MM`).
- **Comisión de Mayrit = `comision_retenida` = Σ `brokerage_amount` de las líneas Risk del periodo**.
  Mercado(s) del binder en `nombre_mercado`/`mercado`. Moneda del binder. `honorarios` = Σ fees.
- **Numeración `AÑO-NNNN`** correlativa por año natural (de `fecha_contable`). **Casado con SharePoint
  por `numero` (NumeroRecibo)** — no se usa `_OldID`.
- **MODELO BASADO EN SharePoint `Mayrit - TRecibos` (reconstruido 17/06, migración `c3d4e5f6a7b8`):**
  la tabla `recibos` refleja las 53 columnas de TRecibos (ciclo completo): contexto
  (numero, referencia, nombre_mercado, mercado, numero_poliza, asegurado, corredor, ramo, tipo_poliza,
  produccion, fechas, yoa, pago, moneda, prima_neta_poliza, participacion, recibo_num, recibos_totales),
  importe+impuestos (prima_neta_recibo, impuestos_*, otros_impuestos, impuestos_recibo, prima_bruta_recibo,
  deduccion_total[_porc], honorarios), comisiones (comision_cedida[_porc], comision_retenida[_porc],
  pagador), cobro (prima_adeudada/cobrada/fecha, comision_retenida_cobrada/traspasada/fecha,
  comision_pendiente_cobro), liquidación (liquidar, liquidar_cobrado/pendiente/liquidado/fecha) y
  comisión cedida-pago (comision_cedida_a_pagar/pagada/fecha) + contable (cuenta, fecha_contable, notas).
  Más enlace app: binder_id, periodo, anio, estado (Emitido/Anulado). **Los "pendientes"
  (comision_pendiente_cobro, liquidar_pendiente_cobro) los recalcula el backend** (`_recompute`).
  **Unique (binder_id, periodo)**. Líneas del BDX → `bdx_lineas.recibo_id` (FK SET NULL) + texto `recibo`.
  (Migraciones previas a1b2c3d4e5f6/b2c3d4e5f6a7 quedaron superadas por la reconstrucción.)
- **Endpoints** (`routers/recibos.py`): GET `/recibos` (filtros anio/binder_id/q), GET
  `/binders/{id}/recibos`, GET `/recibos/{id}`, **POST `/binders/{id}/recibos/generar`** {periodo,
  fecha_emision?} (409 si ya existe; 400 si no hay líneas), PUT `/recibos/{id}`, DELETE (desenlaza
  líneas). Verificado end-to-end (binder 12 / 2019-03 → 2026-0001, 6 líneas, 1.141,15 €).
- **Frontend:** nueva página **Recibos** (`RecibosPage.tsx`, nav Negocio, 🧾) — listado con búsqueda,
  total de comisión, y panel de detalle (estado/fechas/notas editables; base/importe/contraparte solo
  lectura). En la ficha del binder, **pestaña Datos**: columna **Comisión** (Σ brokerage del mes) y
  acción **«＋ Generar recibo»** por periodo (o muestra `🧾 nº` si ya existe). `recibosApi` en api.ts.
- **Emisión NO automática (17/06):** «＋ Generar recibo» abre un **formulario precalculado**
  (endpoint `GET .../recibos/preview`, calcula sin guardar: nº provisional, base, importe,
  contraparte, fecha) y el recibo se crea al pulsar **«Emitir recibo»** (campos editables:
  importe/contraparte/fecha/estado/notas; la base la recalcula el servidor). Pestaña **Recibos**
  dentro del binder (entre Cálculos y Siniestros) con la tabla filtrada por ese UMR. Menú lateral con
  bloques separados (Negocio/Facturación/Configuración).
- **AUTO-RELLENO COMPLETO desde el Risk BDX (17/06):** al generar, el recibo se cumplimenta entero
  agregando las líneas del periodo (`_campos_emision` en routers/recibos.py), **sobre our line**:
  `prima_neta_recibo`=Σ total_gwp_our_line · `impuestos_recibo`=Σ total_taxes_levies ·
  `prima_bruta_recibo`=neta+impuestos · `comision_cedida`=Σ commission_coverholder_amount ·
  `comision_retenida`=Σ brokerage_amount · `honorarios`=Σ fees · `deduccion_total`=cedida+retenida+hon
  · los `%` = importe/prima_neta · **Pagador=Agencia de Suscripción** → `prima_adeudada`=prima_bruta−cedida
  · `liquidar`=adeudada−retenida · `participacion`=our_line/100% · `recibo_num`/`recibos_totales`="X de N"
  = nº de Risk BDX del año según `risk_bdx_intervalo` (Mensual→12, Trimestral→4, Semestral→2, Anual→1)
  · `cuenta`=cuenta bancaria del binder · `corredor`=coverholder · `ramo`=secciones · fechas del
  recibo = mes del periodo · cobrado/liquidado/traspasado=0 (llegan con los Premium BDX). El formulario
  de emisión sale ya entero; se puede ajustar antes de «Emitir recibo». Verificado e2e (binder 12/2019-03).
- **Modal estilo Access (`ReciboModal.tsx`):** emisión y edición usan el MISMO modal ancho que replica
  el de Access — columna izquierda (nº, recibo X de Y, fechas, prima neta/impuestos/prima total
  bordereau, deducción, comisión cedida/retenida, honorarios, pagador, cuenta + desplegable "Más datos")
  y 3 cajas a la derecha: **Cobro de primas · Liquidación a la Cía · Comisiones** (con sus pendientes
  derivados). Usado por `RecibosPage` (editar) y por la emisión desde el binder (`preview` → modal →
  «Emitir recibo»).
- **Cobro PARCIAL:** la emisión se basa en el **Risk BDX**, pero el **cobro/liquidación llega con los
  Premium BDX**, que **rara vez coinciden** con el Risk BDX → cobro parcial. Estado de cobro derivado
  (`estadoCobro` en format.ts): Pendiente / Parcial / Cobrado / Anulado (pills de color), sobre
  comision_retenida vs comision_retenida_cobrada. `estado` manual = Emitido/Anulado.
- **Cobro vía Premium BDX (AUTOMATIZADO, 17/06):** el cobro del recibo se **deriva** de sus líneas
  pagadas. Flujo: (1) **machear** un Premium con el Risk — en BDX → «Subir Excel» se abre `PremiumMatch`
  (lee el Excel de cualquier formato, mapeas columna Certificado + Importe + mes, casa por Certificate
  Ref con el importe como comprobación, recuerda el mapeo en la agencia `productores.premium_col_*`), al
  aplicar marca `incluido_en_premium` + `premium_bdx` (día 1 del mes). (2) Pestaña **Premium** del
  binder: lista los Premium por mes y «Cobrado» con la fecha real → marca las líneas pagadas y
  **recalcula el cobro de los recibos afectados** (prima/comisión retenida/a liquidar cobrados = Σ
  líneas pagadas; pendientes recalculados). Backend: `_recalcular_cobro_recibo`, endpoints
  `/bdx/lineas/premium`, `/binders/{id}/premium`, `.../premium/cobrar|descobrar|excel-preview|match-excel`.
  Verificado e2e con el Premium real de Dale (6/6 match). openpyxl en requirements.
- **Pendiente:** rellenar el resto de campos contables del recibo; el paso de **traspaso** de comisión;
  enlazar a Contabilidad; soportar `.xls` (hoy solo `.xlsx`).

## Estrategia BI / reporting (decidido 2026-06-17)
Dos capas **separadas**, no Power BI como motor de toda la app:
- **Gráficos operativos del día a día → nativos en la app** (React, con librería ligera tipo
  Recharts/Chart.js), alimentados por la API FastAPI. Rápidos, integrados con la lógica de negocio
  (cálculos de PC, comisiones, primas) y sin licencias extra.
- **Cuadro(s) de mando analíticos → Power BI**, conectado a los **datos de nuestra app**
  (PostgreSQL de Azure, base `mayrit`). Empezar **standalone** (Power BI Desktop/Service); embeber
  con *Power BI Embedded* dentro de una sección "Cuadros de mando" solo cuando justifique el coste
  de la capacidad.

Motivos de NO usar Power BI como motor único: es solo lectura (la app necesita escrituras/formularios/
flujos), evita acoplar un sistema crítico a una licencia BI + Azure AD, y evita duplicar los cálculos
en DAX (la fuente de verdad de los cálculos es la API).

Para la conexión de Power BI a Postgres (cuando se haga): **rol de solo lectura dedicado** (p.ej.
`mayrit_bi`, NUNCA `mayrit_app`/`aleaadmin`), **vistas de reporting** en la BD que entreguen los datos
ya aplanados/calculados (desacoplar el esquema interno de los informes), abrir firewall de Azure a las
IPs de Power BI, y para refresco automático en Power BI Service un On-premises Data Gateway.

## Sesión 17/06/2026 (tarde) — listado de binders: GWP, semáforo de notificación y migraciones
- **Columna GWP en el listado de binders** = **Σ `total_gwp_our_line`** del Risk BDX (our line, siempre),
  calculada al vuelo en una sola consulta (`_metricas_binders` en `routers/binders.py`, evita N+1). No
  se persiste: se mantiene al día sola tras cada Risk BDX. Expuesta como `gwp_our_line` en `BinderRead`
  (tipo **float**, no Decimal, para evitar la cola de coma flotante al serializar).
- **Columna Notificación = semáforo de consumo de primas** vs el umbral de notificación del **límite más
  crítico** del binder. Regla (decisión 17/06): umbral = `notificacion`% del límite; 🟢 verde si consumo <
  umbral−10 puntos · 🟡 ámbar a <10 puntos del umbral (p.ej. 65–75% si umbral 75%) · 🔴 rojo al alcanzar el
  umbral. `MARGEN_AVISO_PUNTOS = 10`. Multi-límite: cada línea se asigna a su límite por **`section_no`**
  (línea con section_no=N → N-ésima sección del binder → su límite); si hay un único límite efectivo, todo
  el GWP suma a ese límite. **Binder cerrado** (estado empieza por "Cerrado") → **sin semáforo** (el GWP se
  mantiene como histórico). Serializado: `notif_estado`/`notif_consumo_pct` (agregado) y por cada límite
  `estado`/`consumo_pct` (en `BinderLimiteOut`).
- **Fecha de notificación POR LÍMITE.** Campo `fecha_notificacion` (Date) en **`binder_limites`** (no en el
  binder): es la fecha en que se notificó al mercado el exceso de ESE límite. Dato operativo (no es término;
  pero como los límites se reescriben en cada guardado, viaja en el payload y se conserva). Migración
  `c0d1e2f3a4b5` (añade la col al límite y **elimina** la `binders.fecha_notificacion` que se había añadido
  antes en `b9c0d1e2f3a4`). UI: input **"Notificado (fecha)"** en la sección **Límite de Primas** del
  formulario (en los 3 ámbitos). Al editar el binder, si un límite está en 🔴 y sin fecha, su campo se
  **DESTACA** (recuadro rojo + badge "⚠ a notificar" + "Consumo X% — supera el umbral"); `campoNotificado(gi)`
  en `BindersPage.tsx`. Como dijo el usuario, a veces toca hacer suplemento y otras corregir → el realce sale
  en ambos modos. `Renovar` limpia fecha/estado de los límites clonados.
- **Binder cerrado: no se emiten suplementos ni se corrige.** Botones "+ Suplemento" y "Corregir" **visibles
  pero desactivados** (semitransparentes, `.btn-secondary:disabled`) cuando el estado empieza por "Cerrado".
  Refuerzo backend: `POST /binders/{id}/suplementos` devuelve **409** si el binder está cerrado.
- **Importador de BDX por Excel — alias nuevo.** Algunas plantillas no traen "Gross Written Premium" (100%);
  usan **"Gross Premium paid this time"** (cuando la línea suscrita es el 100%, coincide con Our Line). Se
  añadió como **alias de respaldo** de `gross_written_premium` en `sharepoint.py` (se prueba solo si falta el
  principal; no afecta a los demás binders). Esos Excel tampoco traen "Written Line (%)" (línea 100%).

**Migraciones de Risk BDX hechas y verificadas esta sesión** (vía `tools.migrar_bdx_excel`, conciliación
GWP origen=bd OK; comprobación columna a columna + recibos por periodo):
- CY0118ALE (93), MYTCCY2017 (25, tras borrar 1 línea Ayto. Toledo), CY0118ALE ya estaba.
- **CY0118ALE 93 · MYTCCY2017 25 · PI0119CRO 401 · PI0219CRO 30 · PI0319IBE 377 · PA0119VAM 37 · GL0219ALE 23**.
- Conciliación recibos↔brokerage **al céntimo en 2019**; los periodos **2020-2022** de varios binders tienen
  BDX pero aún **sin recibo** (esperado: solo se han migrado recibos hasta 2019). GL0219ALE queda **100%
  cuadrado** (11 periodos = 11 recibos, todo 2019). Líneas a 0 detectadas = **Endorsements/compensaciones**
  legítimos (sin prima), no errores.
- **Recibos 2019 completados:** tras cargar los binders PI/PA, re-ejecutado `migrar_recibos_excel --anios 2019`
  → **+20 recibos** (binders 24/25/26/27). Total recibos: **51**, **0 colgados**; 2017-2019 (tipo Binder)
  enlazados. Quedan 14 recibos tipo **Póliza (OM)** sin migrar (esperan el módulo de Pólizas).

**Pendiente relacionado:** migrar recibos **2020-2022** para cuadrar los periodos de run-off; módulo de
Pólizas (OM) para los 14 recibos de póliza.

## Decisión abierta (para más adelante)
Hay `TLiquidaciones` (4330) y `TLiquidaciones1` (4018): decidir cuál es la buena. Relevante en
la Fase 3 (Liquidaciones+LPAN), no ahora.
