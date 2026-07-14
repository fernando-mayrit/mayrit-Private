# PROYECTO MAYRIT — Contexto

## ⏳ TAREAS PENDIENTES (reconstruido 2026-06-22)

> Reconstruido revisando el **código de este equipo** (no de memoria). Si se apuntaron tareas en
> otro equipo y no se commitearon, **se perdieron** (la memoria de Claude es local de cada equipo).
> **REGLA: las tareas compartidas van SIEMPRE aquí, en CONTEXTO.md + commit & push.**

### 📌 AL DÍA (2026-07-12) — lista viva de pendientes y mejoras

**Pendientes ahora:**
- **⚠ PRIORITARIO — Triangulación: doble conteo del `to_pay`.** La siniestralidad de Triangulación sale
  INFLADA (los snapshots cuentan pagado+reservas sin restar `to_pay`) y no cuadra con el módulo de
  Siniestros. Decidir con Fernando si aplicar `− to_pay` (afecta IBNR/Ultimate de TODA la app).
- **Triangulación por programa** — hoy básico, ampliar.
- **LPAN en Pólizas OM** — el LPAN solo existe por binder/BDX; falta el flujo para pólizas Open Market
  (Lpan ya tiene `poliza_id`, 64 ligados; falta decidir alcance ver/generar/asociar).
- **Helix MA0222HEL** — snapshots de Claims en pausa por un cambio de esquema de columnas que no reconcilia.
- **Power BI — Ingresos** — pipeline montado (tabla `ppto_ingresos` + vista + Excel sembrado + cargador);
  falta que Fernando rellene/cargue y crear el usuario de BD `mayrit_bi`.
- **Paginación** de `GET /recibos` y `/siniestros` — mejora de rendimiento NO urgente (cuando crezcan).
- **Afinar conciliación bancaria** (analizado 2026-07-13 — RETOMAR mañana; DECISIÓN pendiente de Fernando:
  ¿empezamos por categorización o por emparejamiento?). **Cómo funciona hoy** (`contabilidad.py`):
  - *Fase A (importar Norma 43):* categoría PROPUESTA aprendida del histórico. `_firma_desc` saca la "firma
    del pagador" de la descripción (quita máscara de tarjeta + prefijos de operación, solo letras, 25 chars);
    `_historial_categorias` mapea firma→(concepto,grupo,tipo) más frecuente de la cuenta; `_sugerir_categoria`
    propone SOLO con match fuerte (firma exacta o prefijo común ≥10) — conservador, deja en blanco si duda.
  - *Fase B (conciliar):* `_preseleccion` empareja apuntes de seguros↔transferencias del ledger por SUMA de
    importes (una exacta / todas / misma fecha / subconjunto-suma hasta 16 candidatas / fuzzy→revisar);
    ventana `dias=7`, tolerancia `0.01`. Estados: exacta/revisar/sin_candidatas. Nunca inventa.
  - **Puntos flojos a afinar (2 frentes):** (1) *Categorización* — no hay REGLA explícita editable estilo
    `bdx_alias` ("si descripción contiene X → concepto Y"), ni categorización masiva en el preview, ni botón
    "recordar esta categoría como regla"; pagadores nuevos/variables quedan en blanco → trabajo manual los
    viernes. Plan: tabla `conta_alias` + aplicar-a-todos-del-mismo-pagador + recordar-como-regla.
    (2) *Emparejamiento (Fase B)* — ventana de días y tolerancia fijas (hacerlas ajustables en la UI), tope de
    16 candidatas en el subconjunto-suma (subirlo/optimizar). Recomendación: empezar por (1), que es lo que
    más ahorra en la rutina semanal.
- **Operativo:** renovar el **secreto de Entra** (~jun 2028) o el login dejará de funcionar.
- **Azure (dimensionamiento/coste): CERRADO 2026-07-13** — BD B1ms y App Service Básico B1 bien dimensionados
  (CPU ~10%, mem ~63%), retención backup 35d hecha, nada que reservar (Basic/Burstable no reservables), las 3
  recomendaciones de Advisor (read replica / HA zona / geo-backup) descartadas. Ver [[seguridad-azure]].

**Cerrado recientemente (2026-07):** **justificante contable** — (a) desglose por recibo también para
**Comisiones/Honorarios** (los traspasos/liquidaciones de comisión ya no salen con recibo "en blanco",
p. ej. Bankinter 103.06) y (b) **justificante ESPEJO** (`espejo_mid`): justificar un apunte como la otra
pata de un traspaso entre cuentas propias (Sabadell 262.06 "Ingreso Comisiones" = Bankinter 103.06
"Traspaso Comisiones"); columna **Premium Bdx** + **líneas de ajuste manual** para cuadrar Bankinter ·
conciliación bancaria **Fase A** (importar extracto Norma 43, validado Sabadell+Bankinter) **y Fase B**
(conciliar apuntes de seguros con transferencias: proponer→revisar→confirmar) · **mapeo editable de
columnas de BDX** por programa (Risk) · arreglos del **módulo Tareas** (desfase de periodo, orden
secuencial, pasos en paralelo, arranque rodante 01/07/2026) · **backup a NAS** · **5 recibos duplicados**
resueltos · **reconciliación de Alembic** (repo↔prod, un solo head) · fix del **Manual** (cursor saltaba
al título al editar) · **CI** con `concurrency: cancel-in-progress` (no encolar despliegues).

**Mejoras / módulos propuestos (brainstorm 2026-07-11) — para valorar:**
- **Verifactu / SII (facturación electrónica)** — le interesó a Fernando. Paso 0: confirmar con la asesoría
  QUÉ obliga y sobre qué documentos (ojo: la mediación de seguros está exenta de IVA y las primas van por
  recibos, no facturas → Verifactu pega sobre todo en las **facturas de Consultoría/Fees**).
- **Renovaciones (pipeline de binders a renovar):** aviso 90/60/30 días, comparativa de términos año a año
  (capacidad/comisión/GWP/siniestralidad), estado (en negociación/renovado/no renovado), enlace binder↔
  sucesor. Aparcado; se puede montar como vista ligera sobre lo que ya hay.
- **Gestión documental por binder/póliza:** repositorio central y buscable (slip, contrato, wordings,
  LPANs, endosos, correspondencia) con versión. El gran "quality of life".
- **Búsqueda global** y **alertas más inteligentes** (renovaciones, límites, vencimientos regulatorios).
- **Descartados:** CRM/directorio; **cribado de sanciones** (solo aplica a agencias de suscripción, no a
  Mayrit como corredor — sí planificado en Alea).

---

**Despliegue (HECHO):** app en **Azure App Service** con **despliegue automático por push**
(`.github/workflows/main_mayrit.yml`; el backend sirve el frontend desde `backend/static`).
URLs: `https://app.mayritbroker.com` (dominio propio; DNS en **DonDominio** → pestaña *Zona DNS*) y
`https://mayrit-…spaincentral-01.azurewebsites.net`. **Login Microsoft (Entra ID)** activo, con
**usuarios autorizados añadidos**. Certificado SharePoint en la nube y redirect del dominio: hechos.
Desarrollo en local: backend `uvicorn --reload` (8000) + `npm run dev` (5173), sin login Entra.

**Pendiente REAL (revisado y verificado 2026-07-13 — lo demás de este bloque estaba stale y se ha limpiado):**
- **Blindar la importación de BDX frente a periodos bloqueados** (opcional-menor): `_bloqueantes` en
  `bdx_import.py` valida columnas/periodos pero NO comprueba si el mes está CERRADO. Solo aporta si de
  verdad reimportáis meses cerrados; si no, no merece la pena.
- **Soporte `.xls`** en la app (hoy solo `.xlsx`; el `.xls` solo lo lee el migrador VAMMOS con xlrd). Menor.
- **Módulo placeholder** (EnConstruccion): solo **UCR**. (Transferencias · Contabilidad · Consultoría · Comisiones YA son páginas reales.)
- **Paginación** de `/recibos` y `/siniestros` — solo cuando crezcan. Menor.

**Operativo:** renovar el **secreto de Entra** (~junio 2028) o el login dejará de funcionar.

**YA HECHO (se quitó de "pendiente" el 2026-07-13, estaba stale):** Subir **Risk BDX por Excel**
(`bdx.py` risk_excel_preview/import) · **Cancellation Reason + Turnover** mapeados (commit e3e48b3) ·
páginas reales de **Transferencias/Consultoría/Comisiones** · **recibos 2020-2022 migrados**
(93/98/134) · decisión **TLiquidaciones** resuelta · módulo **LPAN** con router+página · «mostrar cuenta
usada» (los `cuenta_*_id` ya fluyen en Recibos) · Programas + **triangulación** (binder y programa) ·
**Siniestros** + ratios · **Pólizas (OM)** · **Pagador** · **cuentas bancarias por movimiento** · **cierre
anual** · **despliegue + login**.

---

## Seguridad (resumen) — estado actual (2026-07-14)
Resumen canónico del estado de seguridad (detalle de implementación en la sesión 13/07 más abajo).
- **Acceso:** Entra **Easy Auth + MFA** — solo usuarios autorizados (asignación requerida = Sí).
- **Base de datos cerrada:** firewall con **solo IPs permitidas** + servicios de Azure; **no abierta a
  Internet**.
- **App:** solo **HTTPS**, **TLS 1.2**, **cabeceras de seguridad** (HSTS, nosniff, X-Frame-Options,
  Referrer-Policy, Permissions-Policy — en `main.py`).
- **Backups:** automáticos de **Azure (35 días)** + **copia propia al NAS** de la oficina. *(Resuelto lo
  que en la revisión del 21-22/06 quedaba PENDIENTE.)*
- **Dependencias:** vigiladas por **Dependabot** (pip/npm/actions, PR agrupado semanal).

---

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

## Pólizas (Open Market) — datos + cuadre de recibos (17/06/2026)
Negocio directo de Mayrit (no de binder). Arrancado para **cuadrar los recibos OM** (decisión:
"datos + cuadre primero"; la pantalla de Pólizas, después).
- **Modelo `polizas`** (`models/maestras.py`, sobre `Mayrit - TPolizas`): numero_poliza (clave de
  casado), referencia, asegurado, corredor, ramo, mercado, produccion, tipo_documento, estado,
  **seguro** (1=Seguro Directo / 2=Reaseguro), pago, moneda, fechas, yoa, renovacion_automatica,
  coaseguro, limite, franquicia, capacidad, prima_neta, impuestos_porc/impuestos, recargos,
  prima_total, comision_porc/comision_total, prima_participacion, sp_old_id. Migración `e4f5a6b7c8d9`.
- **Recibo**: `binder_id` pasa a **opcional** y se añade **`poliza_id`** (un recibo es de Binder O de
  Póliza). La API (`ReciboRead`) expone `poliza_id` + `poliza_numero`.
- **Importadores (en vivo de SharePoint, idempotentes):** `tools/migrar_polizas.py` (TPolizas → 115
  pólizas; % ×100) y `tools/migrar_recibos_om.py` (TRecibos, tipo Póliza/Slip → enlaza por
  NumeroPoliza). El lector `app/sharepoint.py` se generalizó (`leer_lista(mapeo, date_fields)` +
  `MAPEO_POLIZAS`/`leer_lista_polizas`).
- **Resultado:** 115 pólizas migradas; **209 recibos OM** creados (2017-2026, todos casados a su
  póliza), **0 colgados**. Total recibos en BD: **260** (51 Binder + 209 OM). Los recibos de tipo
  **Consultoría/Comisiones** quedan fuera (no tienen póliza; son otras fuentes de negocio, módulos aparte).
- **⏳ Pendiente:** **pantalla de Pólizas** (listado + alta/edición CRUD según el formulario de Access:
  Referencia[auto] · Asegurado · Corredor · Ramo · Mercado · Límite 100% · Franquicia · Prima Neta ·
  Seguro Directo/Reaseguro · Producción · Nº Póliza · F.Efecto/Vto · Ren.Automática · Capacidad ·
  Coaseguro · Pago · Moneda · Prima Part.[calc] · Impuestos %+importe · Recargos · Prima Total[calc] ·
  Comisión %+importe[calc]); mostrar los recibos OM en `RecibosPage`/ficha de póliza.

## Decisión abierta (para más adelante)
Hay `TLiquidaciones` (4330) y `TLiquidaciones1` (4018): decidir cuál es la buena. Relevante en
la Fase 3 (Liquidaciones+LPAN), no ahora.

## Sesión jun-2026 (LPAN/FDO, avisos, migraciones) — resumen y pendientes

### Migraciones de SharePoint hechas en esta sesión
- **Risk BDX** (vía `POST /binders/{id}/bdx/import`): PI3126DAX (12), MA0326MYR (100, GWP vacío→usar
  GWP our line), PI2926CRO (506), PI3026CRO (101), CY0926ALE (79, línea parcial), PI2825NUV (250).
  Ojo: varios vienen **sin `_OldID`** → reimportar duplicaría (limpiar el BDX antes).
- **Claims (modelo dos fuentes GES40+AULES)** `tools/migrar_claims_dos_fuentes.py` (reutiliza
  `migrar_claims_heca.py`): PI2525CRO (b52), PI1924CRO (b46), PI1523CRO (b41), PI2926CRO (b59).
  Reglas: AULES = ficheros por risk code (E7/E9/D3/CY…, ignora YOA*); si un mes no tiene risk code →
  no hay snapshot AULES; `--periodo-de-carpeta` cuando la celda Reporting Period viene mal; dedup por
  siniestro (gana ref canónica); casado de cabeceras robusto a guiones. PI3026CRO (b58, Crouco-QBE) =
  **una sola fuente** (`migrar_claims_heca.py`). Todos reconcilian incurrido = SharePoint.
- **PENDIENTE**: replicar el modelo dos fuentes en el resto de binders del programa Crouco-Beazley.

### Módulo LPAN / FDO (nuevo) — HECHO
- **Modelo**: tablas `fdos` y `lpans` (enlazables a **binder O póliza**; binder_id/poliza_id
  opcionales; `sp_old_id` para idempotencia). FDO = por **(binder, sección, risk code)** declarado en
  el binder (no del premium). LPAN = por (sección, risk code, periodo), cuelga del FDO. Migraciones
  a7c1e3f5b9d2 → b8d2f4a6c0e3 → c9e3a5b7d1f4 → d1f5b7c9e3a6 → e2a4c6d8f0b1.
- **Router `lpan.py`**: `GET /binders/{id}/lpan`, `GET /lpans`, crear/editar FDO, generar/borrar LPAN,
  `GET /elegir-carpeta` (explorador Windows con tkinter, solo en local).
- **Pestaña LPAN del binder**: cuadro de FDO (Broker Reference = `{parte UMR} FDO-S{secc}-{risk}`,
  Signing number formato `21285*18/06/2026`, Work Package, Fecha proceso, WP Status [Work in
  Progress/Queried/Completed/Rejected]); se repliega al completarse; FDO Completed = no editable.
  Botón **Generar FDO** (gris) crea el **documento Word** copiando `Plantilla LPAN.dotx` (formulario de
  TOKENS) en la carpeta elegida. Bloques por periodo (más reciente arriba; pendientes abiertos;
  completos plegados con ✓; prima 0€→"Sin prima"), columnas GWP our line, Brokerage %, IPT, Net to UW
  + del LPAN: WP, Procesado, SDD, WP Status, Liberado, Pagado; nombre LPAN = Broker Ref 2; Borrar con
  confirmación; bloques con scroll y cabeceras sticky.
- **Listado general** en el menú (opción **LPAN** de Facturación): `LpanPage`. Misma tabla `lpans`.
- **Migración TLPAN** (`tools/migrar_lpan.py`): `Mayrit - TLPAN` (3078) → 224 FDO + 2854 LPAN,
  **0 colgados** (3014 a binder + 64 a póliza OM). Idempotente por sp_old_id.
- **PENDIENTE LPAN fase 2**: generar el **Excel** del Premium BDX por risk code junto con sus LPAN por
  sección y risk code; afinar el documento Word. Definiciones de campos:
  `…\Xchanging\Application 2020\LPAN Template Definitions.xlsx`. Plantilla:
  `…\Documentacion\Plantillas\Plantilla LPAN.dotx`.

### Premium ↔ Recibo (regla añadida)
No se puede **cobrar/liquidar/traspasar** un periodo de Premium sin **Recibo generado** (la pestaña
Premium muestra "Falta recibo"). El recibo se indexa por `reporting_period_start` de las líneas Risk.

### Sistema de avisos (nuevo, ARRANCADO)
- `app/routers/avisos.py` → `GET /avisos` (al vuelo, sin tabla). Frontend: **campana 🔔** en cabecera +
  **chip sutil** en Inicio que abre la campana.
- Generadores: **`risk_sin_recibo`** (hay Risk BDX en un mes sin Recibo; excluye
  `PRODUCTORES_SIN_RECIBO={"insurart"}` — honorarios → Consultoría) y **`vencimientos_sin_renovar`**
  (binders En Vigor último de su programa, y pólizas anuales En Vigor, que vencen en ≤1 mes sin
  renovación).
- **PENDIENTE avisos**: más generadores (premium sin LPAN, FDO sin signing, límites cerca del umbral,
  snapshots de Claims que faltan, secreto Entra por caducar); refrescar al instante tras generar un
  recibo; sustituir el `{"insurart"}` hardcodeado por un **flag "factura por honorarios"** al hacer
  Consultoría.

### Otros cambios de UI
- Menú: opciones **UCR** (placeholder, bajo Triangulaciones) y **LPAN** (Facturación); menú lateral
  compacto con encabezados en caja naranja; ítem activo en naranja sólido; "Pólizas (OM)"→"Pólizas".
- Binders: limpiador 🧹 a la izquierda, búsqueda por **Mercado**, sumatorios (nº + Σ GWP our line);
  filas "En Vigor" en blanco; pestaña Triangulación restaurada en Contingencias.
- Siniestros: botón **Editar** en la pestaña del binder → **SiniestroModal** (abre bloqueado; oculta
  Reference y Moneda; Periodo como fecha). Endpoint `PUT /siniestros/{id}`.

### Avisos reales abiertos a revisar (a fecha de la sesión)
- Recibo pendiente: PI1924CRO 2025-02, PI2224HEC 2026-04, PI2825NUV 2025-11/2026-05.
- Vencimiento sin renovar: **MA0222HEL** (En Vigor pero venció 31/12/2022 — revisar estado),
  PI2625HEC (vence 30/06/2026).
- TLPAN: ~141 "Premium sin LPAN" (98 desfase de mes, 43 reales/pendientes).

## Sesión 21-22/06/2026 (equipo "ferna") — triangulación, rendimiento, seguridad, importaciones

> Trabajo hecho en ESTE equipo en paralelo a la sesión LPAN/FDO; ya integrado por git pull.

### Decisión transversal: siniestralidad = **pagado + reservas** (incurrido real)
La pestaña Siniestros (binder y listado global) sumaba `total_indemnity + total_fees` del maestro,
que incluyen el **"a pagar este mes" (to_pay)** ya contenido en el pagado acumulado → **doble conteo**
(inflaba ~3%). Corregido: contador y columnas Total ind./fees/Total usan **pagado + reservas**, igual
que la Triangulación y el cálculo de Profit Commission. Ej. PI2324IBE: 554.495,74 (antes 572.021,75).

### Triangulación — AMPLIADA (binder COMPLETO; programa básico)
Módulo en `backend/app/routers/triangulacion.py` + pestaña del binder + página `TriangulacionPage`
(menú lateral). Calcula **en vivo** (sin caché) desde `claims_presentaciones`+`siniestros`+Risk; se
actualiza al presentar un snapshot (recargando).
- **Por binder** (`GET /binders/{id}/triangulacion`): filas = mes de apertura (`date_opened`);
  columnas = mes de valuación (calendario, reciente→antiguo) con conmutador **Calendario / Por
  antigüedad**. Métricas conmutables: Incurrido / Pagado / Nº / **% Siniestralidad** (incurrido/Net
  to UWs). Columna izquierda = **Net to UWs por mes**. **IBNR sugerido** (chain-ladder volumen-
  ponderado) + Ultimate con %. **Ámbito**: Total / por Código de riesgo / por Sección (filtra claims
  y prima). **Export a Excel** (`/binders/{id}/triangulacion/excel`).
- **Por programa** (`GET /programas/{id}/triangulacion`): filas = binders/YOA, columnas = antigüedad;
  los **factores de desarrollo se calculan con TODO el programa** (los años maduros proyectan el IBNR
  de los jóvenes). Hoy: resumen por año (GWP/Net/Incurrido/Ultimate/IBNR + %) + triángulo conmutable.
- **PENDIENTE (tarea principal próxima):** ampliar el de **programa** — llevarle lo del binder
  (métrica %, vista calendario/antigüedad, ámbito por código/sección, export Excel, layout) y valorar
  **realimentar los factores del programa al IBNR de cada binder** (hoy el binder usa solo su año).

### Rendimiento (revisión general, todo verificado equivalente)
- **Índices** (migración `e3f4a5b6c7d8`, aditiva/reversible): `bdx(binder_id,tipo)`,
  `bdx_lineas.premium_bdx`, `recibos.fecha_contable`, `claims_presentaciones(binder_id,periodo_ord)`.
- **Cierre**: `extract(year/mes)` → filtros de rango (usa el índice; idéntico verificado).
- **`siniestros/ratios`**: agrega en SQL (antes traía ~31k líneas) — 0,72s→0,23s, JSON idéntico.
- **`listar_premium`**: `load_only` de las columnas usadas.
- **Listado de binders**: era N+1 (6,8s) → eager-loading `joinedload/selectinload` (~0,2s); quitado
  `response_model` redundante. **Frontend dev → `127.0.0.1`** (evita el penalti IPv6 de "localhost").
- **Frontend memoización** (`useMemo`) en `TablaDatos`, `BdxTabla`, `RecibosPage`, `BinderDetalle`
  (+ `cargar()` en paralelo con `Promise.all`), `BindersPage`.

### Seguridad (revisado)
Acceso protegido por **Entra Easy Auth** (Require authentication, 302). Enterprise App "mayrit"
(client id `ff43376f-…`): puesto **"¿Asignación requerida? = Sí"** y asignados **3 usuarios** (los
grupos no van por el plan). La API FastAPI no valida identidad propia (va detrás de Easy Auth) —
refinamiento futuro de defensa en profundidad. `alea-db` = Flexible Server **Burstable** (sin geo-
redundancia ni HA por nivel). **Backup: RESUELTO** — retención **Azure a 35 días** + copia propia al **NAS**
de la oficina. Ver el resumen canónico en [Seguridad (resumen)](#seguridad-resumen--estado-actual-2026-07-14).

### UI varios
- Menú lateral: grupo **Contabilidad** + opción **Transferencias** (Financiero); **Configuración**
  desplegable.
- Listado de binders: columna **Mercado** muestra todos separados por " / ".
- Ratios Frecuencia/Siniestralidad con mismo formato, en sub-cuadro amarillo.
- Reglas de cierre de binder: no cerrar si Risk sin machear con Premium; no pasar a "Cerrado" con
  siniestros abiertos. Binder NUNCA borrable (DELETE→409).

### Importaciones de SharePoint hechas esta sesión (Risk + Claims + snapshots)
Risk+Claims+snapshots: **PI1422IBE, PI1222CRO, PI1122CRO** (sin snapshot), **CY0522ALE, CY0623ALE,
CY0724ALE, CY0825ALE** (+2 huérfanos creados), **PI1823IBE, PI1723HEC, PI1623CRO** (huérfano 119262 de
otro binder omitido), **PI2324IBE, PI2224HEC** (+1 huérfano), **PI2024CRO** (typo periodo 2021→2024
con `--periodo-override`), **PI1924CRO** (sin snapshot), **MA0222HEL** (Risk+claims; **snapshots NO**).
**LMIEITOO -23/-24/-26**: Risk leído a mano de listas `Mayrit - BLMIEITOO-23/-24/001-26` (el UMR del
binder NO casa con el nombre de la lista; -25 vacío/no existe). Mejoras al importador
`migrar_claims_heca.py`: periodo por carpeta, `--anio-defecto`, matching insensible a espacios,
`--alias-ref`, `--periodo-override`, unión combinado+secciones, saltar refs vacías.

### PENDIENTES de este equipo (además de lo de arriba)
- **Snapshots de Claims de MA0222HEL** (Helix/TME): en pausa por **cambio de esquema de columnas**
  (viejo "Payment Indemnity" col33 vs nuevo "Paid Indemnity" col36 + "this month"); decidir
  interpretación o usar lectura por nombre de cabecera (quizá adaptable de `migrar_claims_dos_fuentes`).
- **5 recibos duplicados** a decidir entre dos personas: PI1924CRO 2025-02 (2025-0031/0032/0066),
  PI2825NUV 2025-11 (2025-0195/0196). Regla: 1 recibo por binder+periodo.
- **Paginación** de GET /recibos y /siniestros (no urgente, cuando crezcan).
- **Limpieza de código muerto** (CRUD BDX sin uso, `BdxTabla` duplica `TablaDatos`, helpers/CSS) — no
  hecha (lo de más riesgo).

---

## Sesión 22-23/06/2026 (equipo "ferna") — Avisos, Consultoría/Facturas, Siniestros, LPAN

### Avisos: semáforo de importancia (3 niveles)
- `Aviso` lleva `nivel` (alto/medio/bajo). Tabla nueva `aviso_niveles` (override por TIPO; si no hay
  fila, nivel por defecto del catálogo `TIPOS_AVISO` en `avisos.py`). Endpoints `GET /avisos/niveles`
  y `PUT /avisos/niveles/{tipo}`. La campana pinta un punto de color y tiene "⚙️ Importancia" para
  editar el nivel por tipo. La lista de avisos se ordena por importancia.
- Nuevo generador `factura_consultoria`: contratos activos cuyo próximo cobro toca facturar pronto
  (≤ `aviso_dias_antes`, def. 5) y aún sin recibo.

### Consultoría: facturación + factura Word
- `consultoria_contratos`: nuevas columnas `dia_facturacion` y `aviso_dias_antes`.
- `POST /consultoria/{id}/cobros/generar-factura`: crea el recibo si falta y genera el **Word de la
  factura** desde `Plantilla Factura.dotx` (tokens del usuario: NumeroRecibo, Cliente, CIFCliente,
  Banco, Cuenta…), guardado en `<facturas_dir>\<año>\Facturas Emitidas\<Cliente>\<numero> <Cliente>
  <Mes>.docx`. Config nueva en `config.py`: `factura_plantilla`, `facturas_dir`. Botón "📄 Factura"
  en el panel de Cobros. Cuenta bancaria del contrato o, si no, primera de Gastos activa.
- NOTA: `python-docx` no estaba instalado en el venv (la generación de LPAN también habría fallado);
  instalado (1.2.0).

### Siniestros: rediseño del modal (SiniestroModal.tsx)
- Referencia del título en naranja. Bloque "Información" reorganizado (Asegurado arriba; Certificate
  + Sección/Risk Code centrados + Inicio/Fin riesgo en una línea; YOA oculto). **El bloque Información
  NO es editable** (los campos de IDENT quedan siempre de solo lectura aunque se pulse Editar).
- Estado = desplegable **Open/Closed**; "Cerrado" sólo visible si Closed. Bajo Estado: 1er aviso;
  bajo Cerrado: Abierto. Descripción a ancho completo dentro de Siniestro. Refer/Denial = radio Sí/No
  (normaliza 1/2/YES/N heredados → Sí/No). Importes "ind."→"indemnización"; totales (incurrido =
  pagado+reservas) Total indemnización/Total fees y TOTAL. Bloque "Información" inferior renombrado a
  **Notas**, bajo Importes, estirado hasta igualar el borde del bloque Siniestro.

### LPAN: Generar LPAN ahora produce documento + seguimiento (lpan.py, LpanRow.tsx)
- `generar_lpan`: nombra el LPAN (Broker Ref 2, patrón histórico
  `<UMR> <MM> BDX-S<sec>-<rc>-<MMAA>`, el MM medio = mes del periodo), abre selector de carpeta y
  **genera el Word** desde `Plantilla LPAN.dotx` **con cifras reales** (`_generar_lpan_docx`), y deja
  el LPAN en estado **"Work in Progress"** con WP/Procesado/SDD por rellenar.
- `PUT /lpan/{id}`: edita work_package, fecha (Procesado), sdd, estado, liberado, pagado.
- `GET /binders/{id}/lpan/bdx-excel?periodo=`: descarga el "BDX a procesar" del mes (botón "⬇️ Excel
  BDX" junto a cada mes). **PROVISIONAL**: hoy descarga las líneas de Premium del periodo; el formato
  final está PENDIENTE de especificación del usuario.

### Insurart consultoría (datos)
- 2 contratos: id=3 (1.500, feb–may 2024, Finalizado, 3 recibos) e id=4 (2.000, jun 2024 indefinido,
  Activo, 24 recibos). Borrado el contrato redundante id=2 vacío. 4 recibos anómalos sin enlazar.

### PENDIENTES nuevos
- **Excel "BDX a procesar"**: definir cómo se construye (ahora es placeholder con líneas de Premium).
- Migración Alembic de esta sesión: `a7c9e1f3b5d2_facturas_avisos`.

---

## Sesión 26/06/2026 — Caución Iberian/Hamilton (reaseguro): BDX, recibos y macheo

Importados los binders de **reaseguro de caución** del programa **"Iberian-Caución"** (id 13):
**B1634SB0125IBE** (id 62, YOA 2025) y **B1634SB0226IBE** (id 63, YOA 2026). Participación 30%.

### BDX no estándar → importador propio + columna `extra`
- Sus Risk BDX vienen en Excel con **encabezados NO estándar** (campos de caución: bondNumber,
  registrationName, sector, beneficiaryName, maxTotalLiability…) y **una hoja por mes**. Se mapea por
  **NOMBRE de columna** (no posición), con `backend/tools/importar_caucion_risk.py` (dry-run + `--commit`).
- Nueva columna **`bdx_lineas.extra` (JSONB)** (migración `b1c3d5e7f9a2`): guarda la **fila original
  íntegra** de cada línea → cero pérdida de datos aunque no exista columna estándar donde mapear.
- Importadas: B0125IBE **392 líneas**, B0226IBE **338 líneas**. Marzo-2026 de B0125IBE vacío.
- **1 BDX por binder** (la app asume eso; el mes lo da `reporting_period_start`). El importador creaba
  uno por hoja → la pestaña solo mostraba 1 mes; corregido + `tools/consolidar_bdx.py`.
- **"Prima a Mayrit"** (`net_premium_to_broker`) = col **"Net Premium to pay to Reinsurance Broker by
  Reinsured"** (se mapeó tarde; backfill `tools/backfill_prima_mayrit_caucion.py`).

### Economía de RECIBO en reaseguro (importante)
- En reaseguro hay una **capa extra** (comisión del reasegurado), así que el recibo NO se calcula como
  un binder normal. Flag **`Programa.reaseguro`** (migración `c2d4e6f8a1b3`; activado en Iberian-Caución).
- En `recibos._campos_emision`, si el binder es de reaseguro:
  - **Cobro** (`prima_adeudada`) = Σ `net_premium_to_broker` (Net Premium to pay to Reinsurance Broker).
  - **A Liquidar** (`liquidar`) = Σ `final_net_premium_uw` (Final Net Premium to UW/Hamilton).
  - **Comisión Mayrit** = Σ brokerage = Cobro − Liquidar.
  - NO usar la fórmula GWP−comisión cedida (inflaba el cobro y dejaba "A liquidar" = col45).

### Recibos macheados (cada línea → su recibo del binder+mes)
- `tools/enlazar_lineas_recibos.py`: 392/392 y 338/338 líneas enlazadas.
- Recibos preexistentes (B0125IBE 2025-06..12, B0226IBE 2026-03) ya tenían la economía correcta.
- Generados los meses que faltaban y **regenerados** los de B0226IBE que estaban inflados (incluían
  importes del B0125IBE de cuando los datos estaban juntos). Todos los meses cuadran Cobro=col45 y
  Liquidar=col48.
- Renumeración para no dejar huecos: los recibos nuevos 2026 quedan **0104–0108** (B0125IBE
  ene/feb/abr/may = 0104–0107; B0226IBE may = 0108); B0226IBE conserva 0027/0045/0063/0078.

### PENDIENTE
- El **Premium** de ambos binders de caución.

---

## Sesión 26/06/2026 (tarde, equipo "ferna") — Recibos: fechas, tipos, Word; Binder notif.; backup NAS

### Recibos — ficha (`ReciboModal.tsx`)
- **Fechas en las 3 cajas:** Cobro → `prima_fecha_cobro`, Liquidación → `liquidar_fecha_liquidacion`,
  Comisión retenida → `comision_fecha_traspaso`. Ya estaban en el form/payload; solo faltaba pintarlas.
- **Recibos de Comisiones** (`tipo_poliza="Comisiones"`, Iberian): no hay prima ni liquidación. La caja
  "Cobro de la comisión" muestra lo que nos pagan = **`deduccion_total`** (con Cobrada/Pendiente/Fecha),
  y "Liquidación a la Cía" + Traspaso salen como **"No aplica"** (caja atenuada). Backend: la acción
  *Cobrar* de un recibo de Comisiones registra `prima_cobrada = deduccion_total` (la prima es 0).
- **Recibos de Consultoría:** Liquidación, Traspaso y Pago de comisión cedida → **"No aplica"**.

---

## Sesión 30/06/2026 (equipo "ferna") — LPAN/FDO a descarga de navegador, emojis de UI, y recuperación de datos perdidos en el importador

### Incidencias operativas resueltas
- **Subir Risk BDX se quedaba "Guardando…"** (`RiskExcelImport.tsx`): `importar()` no limpiaba `busy`
  en el caso de éxito (solo en el `catch`) → botón pegado. Arreglado con `finally`.
- **"Generar LPAN"/"Cobrar Premium" no hacían nada**: la causa real era un **pile de backends de
  Mayrit duplicados** en el puerto 8000 (la trampa del `--reload`): los **GET caían en el proceso sano
  y funcionaban, pero los POST se iban a un worker viejo/huérfano que no los atendía**, sin error en
  pantalla. Síntoma engañoso. Fix: dejar **un único** `uvicorn app.main` en el 8000 y rearrancar. OJO:
  el backend de **Alea** también es `uvicorn app.main` pero en `C:\Dev\alea\backend` y **puerto 8010**
  (tiene supervisor que lo respawnea) — NO tocarlo.

### Correcciones de datos (binder 61 = MA0326MYR / B1634MA0326MYR)
- **Reporting date** de la línea id=40916 (cert 04CGCR2600129): `2026-04-21` → `2026-04-01` (siempre día 1).
- **Fees**: en este binder los fees **NO se suman** a `net_premium_to_broker`/`final_net_premium_uw`.
  Abril los sumaba (mal), mayo no. Corregidas 8 líneas de abril restando `fees` (−29.632,06 €):
  Prima a Mayrit 771.649,28 → **742.017,22**; A liquidar 743.017,05 → **713.384,99**. Ahora cuadra
  `Prima a Mayrit = GWP − comisión + impuestos`. **El tratamiento de fees es PROPIO DE CADA BINDER**
  (no generalizar; ver memoria `mayrit-fees-por-binder`).
- **gross_written_premium**: estaba vacío en las 111 líneas → puesto = `total_gwp_our_line` (binder 100%
  participación, GWP 100% = our line).

### UI — botones de acción como emojis (todos los listados)
- `.btn-icono` (estilo) en `styles.css`. Patrón: emoji + `title` + `aria-label`.
- **Binders**: 📂 Abrir · ✏️ Editar. **Pólizas/Recibos/Transferencias/Contabilidad/Consultoría
  (✏️+💰 Cobros)/Comisiones/Tareas/Siniestros**: ✏️ Editar (los CTA "Generar/Preparar/Reparto" siguen texto).
- **Pestaña BDX del binder** (`BdxTabla.tsx`): se quita el clic en toda la fila; **botón ✏️/👁 por línea**
  a la derecha. **Modal de línea** (`BdxLineaPanel.tsx`): abre **bloqueado** con botón **✏️ Corregir**
  (como Recibo/Movimiento/Consultoría).
- **Binders — cajitas de contadores** apiladas (nº binders sobre primas, mismo ancho). **Orden de
  filtros**: Binders → YOA·Coverholder·Estado·genérico; Contabilidad → Año·Tipo·Grupo·Concepto·genérico.
- **Siniestros (binder)**: el cuadro de totales se recalcula con los **filtros de la tabla** (capta
  `onFiltrar` de `TablaDatos` en `sinVisibles`).
- **LPAN/FDO**: botones de acción 💾 Guardar · ⬇️ Descargar Word; primera columna sin el prefijo "com.".

### LPAN/FDO — generar Word como descarga del navegador (funciona en Azure)
- Antes: el botón abría un **selector de carpeta del backend (tkinter)** y escribía el `.docx` en disco
  → solo en local; en Azure no hay escritorio. Migrado a **descarga por el navegador**.
- Backend (`routers/lpan.py`): se separa la construcción del Word (`_construir_lpan_docx`/`_fdo`) del
  guardado; nuevos `GET /lpans/{id}/word` y `GET /fdo/{id}/word` (regeneran desde el registro). Se
  **elimina** todo el camino viejo: `/elegir-carpeta`, `_generar_*_docx`, bloques `if payload.carpeta`,
  campo `carpeta` de los schemas y `bdxApi.bdxExcelUrl`/`lpanApi.elegirCarpeta`.
- Frontend (`download.ts`, `LpanRow.tsx`, `LpanFdoRow.tsx`, `BinderDetalle.tsx`): util `pedirDestino`
  (se llama **DENTRO del gesto del clic**, antes de la red, si no `showSaveFilePicker` caduca en Azure
  por la latencia) + `guardarEn`. **Memoria de carpeta**: `id:"mayrit-docs"` compartido → el navegador
  reabre en la última carpeta usada (LPAN, FDO y **Excel BDX**, que también pasó a descarga con selector).
  El nombre sugerido es el del LPAN (`r.nombre_lpan`, nuevo en la vista) / FDO. Errores con `alert`.

### Recuperación de datos perdidos por encabezados con paréntesis (importante)
- **Causa**: el `MAPEO` espera `Sum insured Our Line` pero el BDX de origen trae **`Sum insured
  (Our Line)`** (con paréntesis). `_resolver_columnas` (que casa con `sharepoint._norm`, sin quitar
  paréntesis) **descartaba el dato en silencio**. La serie **CY** (14-19) y dos **HEL** (34, 36) tenían
  `sum_insured_our_line` vacío (por eso el Excel BDX salía con Sum Insured en blanco).
- **Fix importador** (`bdx_import.py`): nuevo `_norm_col` que ignora paréntesis al comparar → cualquier
  variante con `()` casa con su alias. Desplegado.
- **Audit de cobertura**: de 52 binders, mapa de qué campos de ORIGEN quedaron a 0% (excluyendo los que
  gestiona la app). Patrón claro = serie CY+HEL sin suma asegurada.
- **Backfill desde SharePoint** (conecta OK por certificado, listas `Mayrit - <UMR>`; col `Sum insured
  (Our Line)`): **929 líneas** rellenadas casando por Certificate Ref, y las dudosas por Cert+GWP our
  line con tolerancia de céntimos. CY+HEL al 100% salvo 5 de MA0222HEL que **en SharePoint también
  están vacías**.
- **DESCARTADO con el usuario** (pérdidas aceptables, no se tocan): `fees` (GL 21/22, CY0118 20),
  `deductible` (PA 24/30), `class_of_business` (PI2825 56), `risk_code` de MA0326MYR, y **LMIEITOO
  45/49/57**.
- **Cauciones IBE 62/63**: el dato NO se perdió, vive en `extra` (JSONB) con su estructura nativa de
  caución (bondNumber, Hamilton line, etc.); las columnas estándar en blanco son campos Lloyd's que no
  aplican. Volcados desde `extra` a columna: **yoa, umr, total_taxes_levies** (730 líneas).
- **gross_written_premium** de MA0326MYR (61): vacío en 111 líneas → puesto = `total_gwp_our_line`.
- **Localización/asegurado (detectado por el usuario en CY0825)**: los 5 campos `insured_province`,
  `insured_postcode`, `insured_country`, `location_risk_province/country` seguían parciales (la FASE 1
  de junio los dejó al ~57-59%; muchos binders sin cubrir). El audit de cobertura NO lo señaló porque
  su umbral era "≥90% global a 0% en un binder" y estos están al ~58% (parciales). Backfill masivo
  desde SharePoint (por Certificate Ref; la localización es por certificado) + IBE 62/63 desde `extra`
  (region→provincia, zipCode→CP, país inferido ESP): **global 57-59% → 97-98%** (~18k líneas; incluye
  PI…HEC 40/43/48/54 con ~16k líneas). Sin cubrir: LMIEITOO 45/49/57 (no tienen lista en SharePoint),
  CY0118/MYTCCY2017 (listas viejas sin esas columnas), y `location_risk_*` de MA/HEL/PA (sus listas SP
  no traen "Location of Risk"). Script reutilizable de la lógica en `scratchpad/.../loc_batch.py`.
- Detalle vivo en la memoria `mayrit-perdida-datos-importador`.

### LPAN — plantilla Word en el repo (Azure)
- `lpan_plantilla` apuntaba a una ruta local de OneDrive que en Azure no existe → "No se encuentra la
  plantilla LPAN". Ahora usa el mismo resolver que las facturas (local si existe, si no la copia del
  repo): se incluyó `backend/app/plantillas/Plantilla LPAN.dotx` y `lpan_plantilla` pasó a propiedad
  con `_resolver_plantilla`. OJO: si se edita la plantilla, actualizar también la copia del repo.

### Navegación — quitado "Volver a Binders"
- Se vuelve a la lista pulsando **Binders** en el menú lateral. Para que funcione estando ya dentro de
  un binder (mismo `page`, el detalle es estado interno de `BindersPage`), `ir()` en `App.tsx` ahora
  incrementa un `navKey` que es la `key` del `<main>` → re-pulsar un ítem del menú REMONTA la página
  (resetea su estado). Quitada la prop `onBack` de `BinderDetalle`.

---

## Sesión 01/07/2026 (equipo "ferna") — Lloyd's vs Compañía en LPAN, ciclo Liberado→Liquidado, correcciones de LPAN y más recuperación de datos

### Lloyd's vs Compañía (regla de negocio nueva; ver memoria `mayrit-lloyds-vs-compania`)
- Un binder es **Lloyd's** si algún mercado de sus secciones tiene `mercados.tipo_mercado='Lloyds'`
  (`Binder.secciones → SeccionMercado.mercado.tipo_mercado`). Los NO-Lloyd's (Compañía: LMIEITOO
  45/49/57, MA0121HEL 34, MA0222HEL 36, MA0326MYR 61, SB0226IBE 63) **no tienen FDO ni signing
  number**; el LPAN se hace solo como **control de pago**.
- Backend (`routers/lpan.py`): helper `_binder_es_lloyds`. `generar_lpan` solo exige FDO+signing si
  es Lloyd's (si no, `fdo_id=None`; unicidad por binder+sección+risk_code+periodo+tipo+comisión). La
  vista LPAN expone `es_lloyds`.
- Frontend: en no-Lloyd's se **oculta el panel FDO** y "Generar LPAN" no exige signing; además en
  no-Lloyd's "Generar LPAN" **solo crea el registro** (sin Word ni selector de carpeta) y se oculta el
  botón ⬇️ de descargar Word.
- **Reencuadra pérdidas**: muchos campos vacíos en esos 7 binders (`pct_for_lloyds`, `risk_code`,
  jurisdicciones fiscales, FDO/signing) NO son pérdidas, es que no aplican a Compañía.

### Liquidar Premium ↔ LPAN (Liberado → Liquidado)
- `liquidar_premium` (`routers/recibos.py`): antes de liquidar, exige que **todos los LPAN** de ese
  (binder, periodo) tengan fecha de **Liberado**; si alguno no, 409 con la lista. Al liquidar, sella
  su **fecha de pago** (`Lpan.pagado`, que es la "fecha de liquidación") en los que no la tuvieran.
- El campo `pagado` del LPAN = **"fecha de liquidación"** (columna renombrada de "Pagado" a
  "Liquidado" en la tabla LPAN; solo etiqueta).
- El error de las acciones del Premium (cobrar/liquidar/traspasar) sale también como **alert** (el
  banner superior se pierde si la pestaña Premium está scrolleada → parecía que "dejaba" liquidar).

### Corregir LPAN desde la línea de BDX
- Nuevo bloque **LPAN** en el modal de la línea (`LineaLpan.tsx`): carga el LPAN al que pertenece la
  línea (`GET /bdx-lineas/{id}/lpan`; por binder+sección+risk_code+mes Premium+comisión, o el único
  del grupo) y permite corregir Signing, WP, Procesado, SDD, WP Status, Liberado y Liquidado (afecta
  al LPAN completo). `LpanUpdate` acepta ahora `signing_number`.
- Pestaña LPAN (`LpanRow`): Liberado y Liquidado **editables aunque ya tengan fecha** (para corregir).

### UI del modal de línea de BDX y tabla
- Modal **ancho** (`wide`) y layout por defecto a **3 columnas** en los grupos grandes (clave
  `mayrit.bdxlinea.layout.v3`) → menos scroll. "✎ Diseñar formulario" ahora visible también en modo
  consulta.
- **Clic en una fila del BDX** la deja **sombreada** (`fila-sel`, azul) sin abrir el modal (el modal
  se abre con ✏️) → no se pierde la fila al scrollear a la derecha.

### Recuperación de datos (continuación)
- **section_no** perdido en subidas recientes por Excel (encabezado no mapeado): recuperado deduciendo
  la sección del **risk code** con el propio mapa del binder — PI2625HEC (54) +190, PI2124DAX (51),
  PI3126DAX (60). MA0121HEL (34) no se puede (sus líneas tienen también risk_code vacío).
- Auditoría completa de cobertura hecha; los huecos que quedan son en su mayoría campos que no aplican
  (Compañía) o decididos como descartables (ver `mayrit-perdida-datos-importador`).

### Financiero
- Cuadro **"LPAN Procesados"** (`FinancieroPage.tsx`): ahora muestra los LPAN **con fecha SDD** que
  aún no se han liquidado (antes exigía estar liberados). SDD en columnas, Neto a UW por celda.

### IBNR Bornhuetter-Ferguson — arreglo del %desarrollado (`triangulacion.py`)
- El PI1723HEC (binder 43) daba **IBNR y ultimate NEGATIVOS**: su `%desarrollado` salía **186%**
  porque la cola del triángulo por antigüedad tiene factores de desarrollo **< 1** (el incurrido baja
  al liberar reservas) → `1/CDF` se disparaba > 100% → `(1 − %desar)` negativo.
- Fix: `_pct_desarrollado` ahora **acota el resultado a [0, 1]** (en BF el patrón de desarrollo es por
  definición ∈[0,1] y el IBNR nunca es negativo). Un binder sobre-desarrollado da IBNR 0 y
  ultimate = incurrido. Corrige cualquier programa con ese efecto de cola decreciente.

### Recibos — listado (`RecibosPage.tsx`)
- Pastillas por tipo: helper `tipoEs` + `baseCobro` (en Comisiones el "Cobro" se mide sobre
  `deduccion_total`, no `prima_adeudada`=0, que falseaba un "Cobrado" verde). `noAplica` por fase:
  Liquidación (Comisiones+Consultoría), Traspaso (Comisiones+Consultoría), Pago Comi. (binders+Consultoría).
- Los **botones de gestión** (Liquidar/Traspasar/Pagar) se ocultan según esa misma lógica `noAplica`.
- **Orden por defecto = fecha de efecto descendente** (antes YOA desc); YOA como desempate.

### Transferencias — cierre del ciclo completo (`transferencias_auto.py`, `recibos.py`)
Toda operación sobre recibos genera/actualiza su transferencia. Ya estaban cubiertas la gestión por
acción (listado) y el Premium del binder; faltaban dos del listado:
- **Editar recibo** (PUT `/recibos/{id}`): re-sincroniza las 4 fases (`sync_recibo_todas`), solo
  recibos no-binder (los de binder van por Premium/`sync_binder`).
- **Borrar recibo**: borra sus movimientos automáticos (`borrar_recibo`); los manuales no se tocan.

### Binder — fecha de notificación de límite editable al entrar (`BindersPage.tsx`)
Si un límite de primas está en 🔴 (excedido sin notificar), al abrir la ficha aparece un **aviso
editable FUERA del fieldset de solo-estado** con la fecha de notificación → no hace falta pulsar
"Corregir". Al Guardar, si esa fecha cambió, el guardado parcial cede al **completo** (el backend
reconstruye los límites solo si recibe `secciones`).

### Recibos — botón "Word" en la ficha (factura por tipo de recibo)
- **Idea:** una plantilla Word por tipo de recibo. Empezado por **Consultoría** (= su factura).
- Las plantillas ya existen en `…\Documentacion\Plantillas\` (`Plantilla Factura.dotx` para
  Consultoría; también `Plantilla Factura Comisiones.dotx`, `…Nota de Debito Binder/OM.dotx`,
  `…Recibo Cliente OM.dotx` para los siguientes).
- Backend: `GET /recibos/{id}/word` despacha por `tipo_poliza` y **descarga** el .docx (stream).
  `consultoria.py`: `_construir_factura_doc` parametrizado + **`factura_docx_para_recibo`** que genera
  desde el **PROPIO recibo** (cliente=asegurado, base=`comision_retenida`, IVA=`impuestos_recibo`,
  nº de pago, moneda…), usando contrato/productor solo para enriquecer CIF/cuenta → **funciona también
  con los 46/81 recibos históricos sin `consultoria_id`**. Probado con el recibo 2025-0199.
- Frontend: `recibosApi.word()` (blob + nombre del servidor); botón "📄 Word" en `ReciboModal`
  (solo Consultoría por ahora). **PENDIENTE:** mapear los demás tipos (Comisiones, OM, Binder) a su
  plantilla + tokens.

### Backup en NAS (Capa 2) — avance de planificación (`ops/backup/`)
- **NAS confirmado: Synology DS420+ (Intel x86) · DSM 7.3.2-86009** → soporta Container Manager
  (Docker) y Snapshot Replication (snapshots WORM). Todo compatible.
- `PGSSLMODE=require` añadido al script (Azure exige TLS) — commit `269602b`.
- **IP de la oficina = DINÁMICA** (el proveedor no da IP fija). Solución elegida: **firewall
  auto-actualizable** — el script del NAS detecta su IP pública, crea/actualiza la regla del firewall
  de Azure vía **Azure CLI con un service principal de permisos mínimos** (solo reglas de ese servidor),
  hace el dump y borra la regla. **PENDIENTE:** crear ese SP limitado + bloque `az` en `backup_mayrit.sh`,
  y los pasos 1-5 en el Synology (usuario solo-lectura → firewall → Container Manager → tarea → snapshots).
- **NOTA importante:** el intento de "Synology Cloud Sync → Azure Blob" NO procede: no existe ninguna
  cuenta de Azure Blob Storage (en Azure solo hay PostgreSQL+App Service); el backup de DATOS sale de la
  BD con `pg_dump`, no de GitHub (GitHub solo guarda el CÓDIGO).

### Operativa de esta sesión
- Servidores locales arrancados **ocultos** (`pythonw` backend + `node vite` sin ventana); logs en
  `logs/` (ya en `.gitignore`).

---

## Sesión 29/06/2026 (equipo "ferna") — Justificante contable y subida de Risk BDX por Excel

### Contabilidad — Justificante: que aparezcan los recibos en el modal del apunte
- **Causa raíz del "no aparecía nada":** la autoselección había asignado por error **TODAS** las
  transferencias de Cobro a un apunte (094.06 → 1.500; 095.06 → 215) porque el endpoint, **sin filtro
  de fecha, devolvía hasta el límite (1.500)**. Al quedar "usadas", se excluían del resto de apuntes.
  Limpieza de esas 2 asignaciones erróneas (puesto `transferencia_ids = NULL`).
- **Blindaje:** `GET /contabilidad/transferencias-justificante` **sin `fecha` devuelve `[]`** (nunca
  todas) → la autoselección no puede volver a agarrarlas en bloque. El justificante siempre se cuadra
  por la **fecha del apunte**.
- **Deducción del recibo más robusta** (`_recibos_de` en `contabilidad.py`): combina (binder + mes del
  `premium_bdx` de las líneas ↔ `periodo`) con (binder + **fecha de pago/liquidación/traspaso** de las
  líneas ↔ `fecha`, según subtipo). Cubre las transferencias automáticas y las sueltas. Quedan sin
  recibo solo los apuntes **manuales sin líneas de premium detrás** (p. ej. una transferencia Iberian
  suelta), donde no hay recibo que deducir. Commits `0c31222`.
- **NOTA:** el usuario reportó que "sigue sin funcionar" en su modal; lo más probable es **caché /
  refresco** (verificado en el endpoint en vivo: las transferencias del día salen con sus recibos).
  **Pendiente:** confirmar con un apunte concreto (identificador + fecha) en su pantalla.

### BDX Risk — subida por Excel como el Premium (elegir hoja + mapeo + sin pérdida de datos)
Antes la subida de Risk leía **siempre la primera hoja** y hacía dedup silencioso por clave natural,
**descartando** todas las columnas no reconocidas. Reescrito (`bdx_import.py`, `routers/bdx.py`,
`RiskExcelImport.tsx`, `api.ts`):
- **Preguntar la HOJA** del Excel (igual que Premium): el preview devuelve `hojas`+`hoja` y se puede
  cambiar (recarga el preview). `parse_risk_excel(content, hoja)`.
- **Mapeo contra el Risk existente:** reparto por **sección asignando la sección por risk code** cuando
  falta (`_rc2sec`/`_seccion_de`), con **aviso** de las líneas que no casan ninguna sección.
- **CERO pérdida de datos (clave, lo exigió el usuario):** se captura **TODA la fila** (todas las
  celdas con cabecera); lo no reconocido por el MAPEO se guarda íntegro en **`bdx_lineas.extra`**
  (JSONB), no se descarta. `_extra_no_mapeadas` + `_json_safe`. El preview lista TODAS las columnas no
  reconocidas y las marca como "se guardan en Extra".
- **Dedup repensado** (el usuario avisó: en un Risk hay **duplicados legítimos** por pagos fraccionados,
  y el Reporting siempre es un mes nuevo): se quitó el dedup por línea (conservaba mal). Única
  protección, **a nivel de mes**: si un Reporting ya estaba cargado en el Risk, ese mes se **omite
  entero** para no recargarlo (`periodos_omitidos`).
- **Alias añadido:** `total_gwp_our_line` ← "**Annual Premium Total GWP**" (caso MA0326).
- **Formato Mes Año** reutilizable: `mesAnyo` en `frontend/src/format.ts` (periodos "Marzo 2026").
- Commits `9ac1d36`, `e15d6eb`.

### PENDIENTE de esta sesión
- **MA0326:** faltan alias de columnas clave de ese fichero (sobre todo el **Certificado**, que no
  mapea → necesario para casar luego con el Premium) y posiblemente comisión/fechas. Pedida al usuario
  la **ruta del Excel** (o la lista de "No reconocidas") para añadir los alias exactos. Mientras, los
  datos NO se pierden (van a `extra`).
- Confirmar en pantalla el **Justificante** con un apunte concreto ≥10/06/2026.

---

## Sesión 03/07/2026 (equipo "ferna") — Fecha contable siempre día 1, mercado en recibos de Comisiones y de Myrtea

### Fecha contable = SIEMPRE día 1 del mes (regla de negocio)
La `fecha_contable` **imputa el recibo a un MES** (cierre contable): el día debe ser **siempre 1**. El
mes se elige libre (el del periodo o, si está cerrado, otro abierto), pero el día no.
- **Validador en el modelo** `Recibo` (`models/maestras.py`): `@validates("fecha_contable")` normaliza
  a `.replace(day=1)` en TODA alta/edición (emisión de binder, póliza OM, comisiones, consultoría y la
  edición manual). Un único punto; no hace falta migración.
- **Editor de recibos** (`ReciboModal.tsx`): **nuevo campo "Fecha Contable"** junto a las fechas del
  periodo del recibo; el input fuerza el día 1 al vuelo (`value.slice(0,8)+"01"`) para que se vea al
  instante. Solo en el editor (no en el listado, por decisión del usuario).
- **Datos corregidos:** 6 recibos con día ≠ 1 → día 1 (mismo mes); y 3 recibos de 2026 con el mes mal
  (0100, 0101 → mayo/abril; 0109 → mayo) reubicados a su **mes de periodo** (mayo 2026 estaba abierto,
  no había motivo para tenerlos en junio). Convención mayoritaria: `fecha_contable` mes = mes del periodo.

### Mercado en los recibos de Comisiones (Iberian)
Los recibos de comisiones de **Iberian** deben llevar `mercado`/`nombre_mercado` = **`Iberian Insurance
Group, S.L.`** (con coma; ojo: en la maestra Mercados figura **sin** coma, `Iberian Insurance Group S.L.`,
tipo *Agencia de Suscripción*). No se genera-ban con mercado → salían vacíos.
- **Código** (`routers/comisiones.py`): constante `MERCADO_IBERIAN` aplicada en los dos `Recibo(...)`
  (endpoints *preparar* y *reparto*).
- **Datos:** backfill de **60** recibos comisiones Iberian sin mercado (incl. 2026-0103). NO se tocan los
  de **Insurart (3)** ni **WiiRe (1)** — son de otra fuente (históricos migrados; WiiRe ya tiene el suyo).
- **PENDIENTE:** decidir el mercado de los **3 recibos de comisiones de Insurart** (siguen sin mercado).

### Mercado del binder Myrtea (id 61 = B1634MA0326MYR)
Sus recibos deben llevar el **nombre canónico** del mercado, no el alias. Estaban descuadrados: uno con
`Axeria` (alias) y otro con `Axeria Iard, S.L.` (nombre). Unificados a **`Axeria Iard, S.L.`** (el helper
`_mercado_nombre` resuelve alias→nombre).

### Tools nuevos (mantenimiento, DRY-RUN por defecto, respetan `Contabilizado`)
- `tools/normalizar_fecha_contable_dia1.py` — fecha_contable → día 1.
- `tools/unificar_mercado_recibos_binder.py --binder <UMR>` — mercado de recibos → nombre canónico.
- `tools/backfill_mercado_comisiones_iberian.py` — mercado de comisiones Iberian.

> Nota: las correcciones de datos se aplicaron **directo a producción** (no son migraciones). Los cambios
> de código (validador + mercado Iberian) requieren **reiniciar el backend** para emisiones/ediciones nuevas.

---

## Sesión 07/07/2026 (equipo "ferna") — Liquidar Premium exige LPAN que cuadren + sella su fecha

### Liquidar un Premium: los LPAN son obligatorios y sus cantidades tienen que coincidir
Al liquidar un Premium (`POST /binders/{id}/premium/liquidar`, `routers/recibos.py`), además de lo que ya
hacía (sella `pagado` = fecha de liquidación en los LPAN del periodo), ahora **exige**, EN ESTE ORDEN:
1. **Que existan LPAN que cubran el neto** — para TODOS los binders (Lloyd's **y Compañía**): los LPAN
   controlan la liquidación al mercado. Compara el **neto a pagar al mercado del Premium** (Σ `final_net_premium_uw`
   de sus líneas) con la **suma del neto de los LPAN** (Σ `net_premium`, que es justo con lo que se
   construye el LPAN). Si no hay LPAN → *"genera primero el/los LPAN"*; si hay pero no cuadran → *"las
   cantidades no coinciden"* (con ambos importes y la diferencia). Tolerancia = 1 cént. × nº LPAN (solo redondeo).
   Periodos con **neto 0** no exigen LPAN (no hay pago que controlar).
2. **Que todos estén Liberados** (sello de Xchanging) — **solo en binders Lloyd's** (`_es_lloyds`, por
   `tipo_mercado='Lloyds'`). Los de Compañía NO pasan por Xchanging, así que no se les exige 'Liberado'.
3. Sella la **fecha de liquidación** (`pagado`) en los LPAN que aún no la tengan.

**Regla de negocio (aclarada por el usuario):** los LPAN son obligatorios para liquidar en Lloyd's **y**
Compañía. La ÚNICA diferencia es que **solo los Lloyd's exigen FDO** previo al LPAN (ya validado en
`generar_lpan`: `_binder_es_lloyds` → FDO+signing; los no-Lloyd's generan LPAN sin FDO). Cadena completa
que queda blindada: **Cobrar → Generar LPAN → Liberar → Liquidar** (cada paso bloquea el siguiente; el
LPAN además no se genera hasta que TODAS las líneas del grupo están cobradas — `generar_lpan`).

**Impacto:** binders de Compañía (MA0121HEL, MA0222HEL, SB0226IBE, Myrtea) con periodos de Premium **sin
LPAN** ahora **no se pueden liquidar** hasta generarlos. Los ya liquidados no se rompen (el guard solo
actúa al liquidar). Sin cambios de frontend (el 409 se muestra como el resto). **Verificado** con datos
reales (sin ejecutar liquidaciones): los periodos sin LPAN bloquean, Myrtea 2026-05 (LPAN cuadra) pasa.

**Resuelto:** el paso **"Liberado"** es **solo de Lloyd's** (Xchanging); en Compañía NO se exige (helper
`_es_lloyds` en `routers/recibos.py`).

### Módulo "📖 Manual" (instrucciones de uso dentro de la app)
Nueva página `pages/ManualPage.tsx` + botón **"📖 Manual"** en la **barra superior** (junto a Configuración, `App.tsx`). Es un
manual **FIJO en el repo** (v1, versionado con la app), estructurado para migrarse a **editable** (BD)
más adelante sin rehacer la parte visual. Índice lateral pegajoso + secciones en tarjetas, con recuadros
📌 (regla) y ⚠️ (ojo); estilos `.manual-*` en `styles.css`. Responsive.
- **Decisión del usuario:** «fijo ahora, editable después» + alcance «reglas y flujos clave» (conciso).
- **Contenido v1:** Conceptos base · BDX Risk/Premium · Recibos (fecha contable día 1) · **El ciclo de
  liquidación** (Cobrar→Generar LPAN→Liberar→Liquidar) · LPAN y FDO (tabla Lloyd's vs Compañía) ·
  Comisiones Iberian · Mercados (nombre vs alias) · Cierre contable.
### Módulo Manual v2 — EDITABLE desde la app (07/07/2026)
El manual pasó de fijo a **editable en la app** (decisión: editable por **cualquier** usuario).
- **BD:** tabla `manual_secciones` (`orden`, `emoji`, `titulo`, `cuerpo` Markdown, `updated_at`).
  Migración `manual_secciones_0001` (crea + **siembra** el contenido v1). Nota: las migraciones **SÍ**
  se aplican solas en el deploy (`backend/startup.sh` corre `alembic upgrade head` antes de gunicorn);
  también se puede correr a mano en local (apunta a la BD de Azure). [corrección 08/07: antes puse que no]
- **Backend:** `models.ManualSeccion`, schemas `ManualSeccion*`, `routers/manual.py` (GET/POST/PUT/DELETE
  `/manual` + `PUT /manual/reordenar`; registrado en `main.py`). Verificado e2e contra la BD real.
- **Frontend:** `ManualPage.tsx` reescrita — carga de la API, render **Markdown** (`react-markdown` +
  `remark-gfm`, nuevas deps) con convención de recuadros (párrafo que empieza por 📌=regla, ⚠️=aviso),
  y **modo edición** (✏️ Editar): añadir/editar/borrar/reordenar (▲▼) con vista previa. `manualApi` en api.ts.
- **Convención de contenido:** Markdown estándar + tablas GFM; recuadros con 📌/⚠️ al inicio del párrafo.

### BUG GRAVE del importador de Risk Excel — fechas dd/mm/aaaa como texto (07/07/2026)
Al subir el Risk de **junio del PI2725** (hoja `June 2026` de un Excel de 11 hojas, una por mes),
**314 líneas entraron SIN periodo** y con varias columnas sin mapear. Causa raíz (dos bugs de
`bdx_import.py` / `sharepoint.py`):
1. **Fechas como TEXTO `dd/mm/aaaa`:** esa hoja trae `Reporting Period` como texto `01/06/2026`, y
   `_fecha()` solo parseaba **ISO** (`aaaa-mm-dd`) → devolvía `None` en silencio. Las otras hojas traían
   la fecha como datetime real, por eso no fallaban. **Fix:** `_fecha()` ahora acepta date/datetime, ISO
   y europeo `dd/mm/aaaa`/`dd-mm-aaaa`.
2. **Encabezados estándar largos:** esa hoja usa `"Risk Code (see list)"`, `"Insured Country (ISO code
   list)"`, `"Tax N - Jurisdiction: Country, State, Province, Territory"`, etc., que no casaban con el
   MAPEO → iban a `extra`. **Fix:** añadidos esos alias en `sharepoint.MAPEO` (risk_code, insured_country/
   province/id, location_risk_*, tax1/2_jurisdiction, risk_transaction_type, transaction_type).
3. **Guardarraíl:** `importar_risk_excel` ahora **ABORTA** (ValueError, no importa nada) si alguna línea
   queda sin `reporting_period_start` reconocible; `preview_risk_excel` devuelve `sin_periodo` para avisar.
   Antes, sin periodo se saltaba la protección de "mes ya cargado" y podía duplicar.
- **NO se perdió dato:** lo no mapeado siempre se guardaba en `bdx_lineas.extra`. Solo el periodo se caía.
- **Remediación en producción (a mano):** se borraron las 314 líneas rotas y se **re-importó** la hoja
  `June 2026` con el código corregido → 314 líneas OK (periodo 2026-06, risk code E7/E9, país, etc.),
  total del binder intacto (2406), 0 líneas sin periodo.
- **Verificado:** tras la remediación, **0 binders** con líneas de `reporting_period_start` nulo.

### Red de seguridad del importador de Risk (principio: NUNCA importar a medias en silencio)
A raíz del susto anterior, el importador **valida y avisa** en vez de tragar en silencio:
- **Backend** (`bdx_import.py`): helper `_bloqueantes(meta, coerced)` con **columnas CLAVE** que un Risk
  DEBE traer (Reporting Period, Certificate Ref, Total GWP Our Line, Commission Coverholder Amount,
  Brokerage Amount, Final Net Premium to UW) + fuente de sección (Section No o Risk Code). Si falta
  alguna, o hay líneas sin periodo, `importar_risk_excel` **ABORTA con ValueError** (no importa nada).
  `preview_risk_excel` devuelve `problemas` (bloqueante/aviso) y `bloqueado`.
- **Router** (`routers/bdx.py`): el ValueError del guardarraíl → **422** con el mensaje (y `rollback`).
- **Frontend** (`RiskExcelImport.tsx`): panel de **problemas** — recuadro rojo (bloqueante, con lista) y
  ámbar (avisos: columnas no reconocidas, sin sección, meses ya cargados). Si `bloqueado`, el botón
  **«Importar» queda deshabilitado** (`saveDisabled`). Las filas de la muestra sin periodo se marcan (⛔).
  Estilos `.import-bloqueo` / `.import-aviso` en `styles.css`.

---

## Sesión 08/07/2026 (equipo "ferna") — retoques de UI

### Machear Premium: auto-rellenar "Mes del Premium" desde el nombre del fichero
El `<input type="month">` arrancaba vacío y el navegador pintaba un feo "-------- de ----". Ahora
`PremiumMatch.tsx` **deduce el `AAAA-MM` del nombre del fichero** (`periodoDeNombre`, meses español
completo/abreviado; coge el año pegado al mes → ignora el YOA). Ej.: "Premium Bordereaux **abril 2026**
YOA 2024.xlsx" → `2026-04`. Editable a mano; si el nombre no trae mes, queda vacío como antes.

### Cajas de los diálogos Excel se salían (desborde de grid)
En «Machear Premium» y «Subir Risk», los `<select>` con texto largo (p. ej. "Gross Premium including
tax (Our Line)") desbordaban su celda y, con el panel en `overflow:hidden`, se **cortaban**. Causa: los
`.field` de `.campos-grid` no encogían (`min-width:0`) y los `<select>` no tenían `width:100%`. Se amplió
el modificador **`.campos-fill`** para cubrir también `select`/`textarea`, y se aplicó (`campos-grid
campos-fill`) en `PremiumMatch.tsx` y `RiskExcelImport.tsx`.

### Machear Premium: mostrar también las LÍNEAS de la hoja
El preview solo decía "N columnas detectadas". Ahora el endpoint `premium/excel-preview`
(`routers/recibos.py`) devuelve **`n_filas`** (cuenta todas las filas de datos no vacías tras la
cabecera, no solo la muestra de 3) y el diálogo muestra "N columnas y **M líneas** detectadas en «hoja»".

### Machear Premium: mostrar el periodo como "Junio 2026" (no "2026-06")
El resultado mostraba el periodo en ISO `2026-06` (induce a error). Ahora usa el helper `mesAnyo`
(formato único de la app) → **"Junio 2026"** en el resumen y en la caja del Premium. El `input
type=month` sigue con el valor ISO internamente (el navegador ya lo muestra localizado).

### Machear Premium: comparar contra Net Premium to Lloyd's Broker (no "el mejor de 3 columnas")
Antes `match_excel` (`routers/recibos.py`) comparaba el importe del Excel contra el **más cercano** entre
`total_gwp_our_line` / `gross_written_premium` / `net_premium_to_broker` y mostraba el our line → confuso.
Ahora la comprobación es SIEMPRE contra **`net_premium_to_broker`** (Net Premium to Lloyd's Broker), que
es el importe que cuenta para conciliar el Premium; la columna «Importe Risk» pasa a **«Net Prem. Lloyd's
(Risk)»**. La sugerencia automática de la columna Importe del Excel prioriza esa columna
(`_sugerir` con keywords "net premium to lloyd/broker/pay" primero). El macheo de líneas sigue siendo por
Certificate Ref; el importe es solo comprobación.
- **Corrección (mismo día):** la columna Importe del Excel se **sugiere SIEMPRE** la de Net Premium
  (ignora la recordada, que en Iberian era "Gross ... Our Line" → comparaba gross-Excel vs net-Risk y
  nunca cuadraba, con 0 macheadas → A Cobrar/Traspasar/Liquidar a 0). El resultado ahora muestra
  explícitamente «columna Excel ↔ Net Premium to Lloyd's Broker (Risk)» y avisa si ninguna cuadra.

### Macheo del Premium: acelerar (subir el fichero una sola vez)
El flujo subía y parseaba el Excel **en cada paso** (preview inicial, cambio de hoja, machear). Medido:
openpyxl ~84 ms/parseo + BD ~50 ms; el coste real es re-subir el fichero por la red 2-3 veces.
- **`load_only`** en la carga de líneas Risk del macheo (`match_excel`): solo ~8 columnas en vez de ~90.
- **Caché del fichero en el backend** (`recibos.py`): se sube UNA vez, el backend lo guarda por `token`
  (10 min, en memoria; el backend corre **1 worker** gunicorn → `startup.sh` sin `--workers`) y lo
  reutiliza en cambio de hoja y en machear. `excel_preview`/`match_excel` aceptan `file` **o** `token`;
  el front (`PremiumMatch`, `api.ts`) guarda el token y reintenta subiendo el fichero si caduca (409).

### Dos descargas de bordereau por mes: LPAN Bdx (agrupado) y Premium Bdx (plano)
Un solo endpoint `GET /binders/{id}/lpan/bdx-excel?periodo=&agrupar=` (formato Lloyd's, 61 col):
- **`agrupar=true` → LPAN Bdx** (fichero "LPAN Bdx {UMR} {mes}.xlsx"): agrupado por (Sección, Risk Code)
  con subtotales, como los bloques LPAN. Botón **"⬇️ LPAN Bdx (Excel)"** en el bloque LPAN de cada mes,
  visible **solo cuando los LPAN están preparados** (`lpanPreparado`: todo risk code con prima tiene su
  LPAN generado / o exento / histórico). Nunca antes.
- **`agrupar=false` → Premium Bdx** (fichero "Premium Bdx {UMR} {mes}.xlsx"): las mismas líneas pero
  PLANAS, sin agrupar ni subtotales. Botón **"⬇️ Excel"** en una **columna propia a la derecha del todo
  (tras Nota)** en la tabla **Premium BDX (cobro)**.
`lpanApi.bdxExcel(binderId, periodo, agrupar)` y `descargarBdxExcel(periodo, agrupar)` en `BinderDetalle`.
(Antes había un único botón "Excel BDX"/"Premium" mal ubicado; esto lo separa en las dos descargas reales.)
- El botón "⬇️ Excel" del Premium Bdx va en **columna propia a la derecha del todo (tras Nota)** en la
  tabla Premium BDX (cobro).

### Macheo Premium: filtrar lo que no cuadra + encabezado fijo
En el modal de resultado (`PremiumMatch.tsx`): si el macheo **no es exacto** (hay importe_distinto o
no_encontrada), el listado muestra **solo las filas que NO cuadran** y los totales añaden la **Δ =
Σ Excel − Σ Risk**. Si todo cuadra, se muestra igual que antes. Además el **encabezado (y el pie de
totales) quedan fijos** al hacer scroll del listado (`.match-tabla thead/tfoot` sticky en `styles.css`,
mismo patrón que `.tabla-risk-preview`). El resto del modal no cambia.
- **Encabezados y columna Risk Bdx (08/07):** las columnas de importe pasan a llamarse **Premium**
  (lo que se sube) y **Risk** (para saber de dónde viene cada cantidad), y se añade una columna
  **Risk Bdx** a la derecha del Certificado con el periodo del Risk de la línea macheada (para localizar
  en qué Risk está la que descuadra). Backend: `MatchRow.risk_bdx` (de `reporting_period_start` de la
  línea; añadido a `load_only`).
- **Macheo por SUBCONJUNTO de líneas del Risk (08/07):** un único apunte del Premium puede liquidar
  VARIAS líneas del Risk con el mismo Certificate (endosos/ajustes, alguno **negativo**), o solo
  **algunas** (no siempre todas). `match_excel` hace **subset-sum**: prueba todas las combinaciones de
  las líneas del certificado (hasta 16 líneas; por encima, línea más cercana vs suma total) y se queda
  con la que sume ~ el importe del Premium (a igualdad de diferencia, la de más líneas). Si cuadra,
  machea ese subconjunto (todas sus líneas van a `matched_ids`). `MatchRow.risk_lineas` (nº de líneas)
  y `risk_bdx` con los periodos ('a / b' si varias); el frontend muestra "· N líneas" y formatea cada
  periodo con `mesAnyo`. **Verificado con datos reales del PI2725**: 3 de 4 certificados que antes salían
  "Importe ≠" ahora machean por combinación (p. ej. 469,11 = 121,49+347,62; 1.138,71 = 1.323,29−184,57);
  el 4º (899,65) no casa ninguna combinación → diferencia real, se sigue marcando.

### Listados (TablaDatos): redimensionar columnas iba lentísimo — arreglado
Causa: (1) la tabla usaba `table-layout: auto` → el navegador re-medía TODO el contenido en cada cambio;
(2) al arrastrar el borde, cada `mousemove` hacía `setAnchos` → **re-render de TODAS las filas** (los
listados pintan miles sin virtualizar). Arreglo en `TablaDatos.tsx` + `styles.css`:
- **`<colgroup>` con un `<col>` por columna** (ancho por `anchoDe`: `anchos ?? c.width ?? 90/140`).
- **`table-layout: fixed`** SOLO en el listado genérico (clase nueva **`.tabla-datos`**, no en `.bdx-tabla`
  que la usan muchas tablas): `width: max-content` (scroll horizontal) + `min-width: 100%`.
- **Redimensionar por DOM:** durante el arrastre solo se cambia `col.style.width` (0 re-renders); el
  estado (`setAnchos`) se guarda **al soltar**. Se quitaron los anchos inline de `th`/`td`.
- Prop nuevo **`rowActionWidth`** (la columna de acción necesita ancho fijo con layout fixed; Recibos en
  modo gestión pasa 220 por los varios botones; por defecto 76).
- **Estrechar columnas (fit sin scroll):** con `min-width:100%` el hueco liberado se redistribuía a las
  demás → "no dejaba" estrechar. Ahora `.tabla-datos { width: 100% }` + una **columna spacer** al final
  (auto, absorbe el sobrante) → cada columna mantiene su ancho exacto y estrechar se queda estrecho (el
  hueco va al spacer). Mínimo de ancho bajado de 60 a **32 px**. Si las columnas superan el ancho, hay
  scroll horizontal. (El objetivo del usuario: que los listados quepan sin scroll; ahora se puede
  compactar a mano y se guarda en localStorage. Falta, si se quiere, afinar los anchos por defecto por listado.)

### Tareas — auto-marcado "antes de tiempo": desfase de periodo (bug de anclaje doble)
Una entrega auto (Risk/Premium/Claims) se daba por hecha con el dato de un mes equivocado (p. ej. una
entrega de julio auto-marcada con el Risk de **febrero**). Causa: la FECHA de cada entrega salía de
`fecha_inicio` de la tarea, pero el PERIODO que comprobaba `_periodo_de` salía del **efecto** del binder;
cuando `fecha_inicio` se desviaba de `efecto+intervalo+plazo`, las dos series se desincronizaban.
- **Fix definitivo (`tareas.py`):** `_ocurrencias` deriva SIEMPRE la fecha de inicio de las tareas AUTO
  del binder (`efecto + intervalo + plazo`), nunca del `fecha_inicio` guardado (que se desfasa o lo
  reescribe cualquiera al regenerar). Con las entregas ancladas al efecto, `_periodo_de(binder, k, paso)`
  vuelve a la forma exacta `efecto + k·intervalo` (por índice) — que además evita el colapso de dos
  entregas en el mismo periodo al restar días de plazo cerca de febrero. El desfase real de presentación
  (fin de periodo + plazo) sigue en la FECHA de la entrega, no en el periodo. Robusto: da igual lo que le
  pase al `fecha_inicio` en la BD.

### Tareas secuenciales — los pasos auto respetan el orden
En una tarea secuencial, un paso con regla auto se marcaba en cuanto existía su dato, **saltándose** pasos
manuales anteriores pendientes (quedaba "hecho" y bloqueado a la vez). Ahora un paso no cuenta como hecho
hasta que le llega el turno (gate `hecho` con `bloqueado` en `_pasos_de_ocurrencia`). Solo visualización;
una entrega sigue siendo completa solo con TODOS los pasos.

### Tareas — pasos en PARALELO dentro de una tarea secuencial (grupos por `orden`)
El `secuencial` era todo-o-nada por tarea. Ahora el bloqueo es por **grupos**: los pasos con el MISMO
`orden` forman un grupo paralelo (no se bloquean entre sí) y el siguiente grupo espera a que TODO el grupo
anterior esté hecho. **Sin cambio de esquema** (se reutiliza `orden`; duplicado = grupo). Backend:
`_pasos_de_ocurrencia` bloquea por "grupo anterior con algún paso sin hacer" (el endpoint de marcar hereda
la validación). Frontend (`TareasBinder.tsx`): toggle **"⇄ en paralelo con el anterior"** por paso (solo
en tareas secuenciales); el `orden` se calcula de los flags al guardar y se deriva de la igualdad de
`orden` al cargar. Retrocompatible (pasos con orden distinto → siguen estrictamente en fila). Ej.: los tres
"Envío a Dale/Cincinatti/Ana" en el mismo grupo → cualquier orden entre ellos, y "Cobro" espera a los tres.

### Tareas — "Procesar Premium" pasa a manual; periodo como "Mayo 2026"
- Los pasos "Procesar Premium"/"Procesar en Mayrit" (regla `premium`) se pasaron a **manual** (a petición):
  se auto-marcaban en cuanto el Premium del periodo estaba cargado, y las cargas en bloque de varios meses
  los daban por procesados antes de tiempo. Reversible (volver a poner la regla).
- La etiqueta del paso auto y la cabecera de la vista "Por mes" muestran el periodo como **"Mayo 2026"**
  (helper `mesAnyo`), nunca `2026-05` (se confunde con un recibo).

### Gráfico de evolución del binder (Resumen) — tooltip por mes
Al pasar el cursor por un mes: guía vertical + recuadro con la **prima acumulada de cada año visible** en
ese mes (resalta el punto de cada línea y el año actual en negrita). Respeta la selección de años. Todo en
SVG con bandas de hover invisibles por mes (`EvolucionProgramaChart` en `BinderDetalle.tsx`).

## Sesión 12/07/2026 (equipo "ferna") — Justificante contable: desglose de Comisiones + justificante ESPEJO

Continuación del justificante (para el gestor contable). Todo verificado contra los PDF hechos a mano en
`Mayrit Insurance Broker/…/Cuenta Bankinter` y `…/Cuenta Sabadell General`. Commits `c813d7a` y `056f6c5`.

### 1) Desglose por recibo también para Comisiones/Honorarios (arregla "recibos en blanco")
- **Síntoma:** en Bankinter 103.06 ("Traspaso Comisiones a Mayrit") los recibos salían en blanco. El
  desglose por recibo (`_desglose_recibos` en `contabilidad.py`) solo se aplicaba a **Primas**; para
  Comisiones/Honorarios devolvía una fila sin recibo.
- **Causa/dato:** al traspasar comisiones, cada línea del Premium guarda `traspasado = brokerage_amount` y
  `fecha_traspaso` (ver `recibos.py::traspasar_premium` → `sync_binder`), y el importe de la transferencia
  del binder es la Σ de esa columna. El desglose por recibo ES recuperable.
- **Fix:** `_desglose_recibos` ahora es PRECISO por **(subtipo, binder, mes de premium, recibo)**: importe
  por recibo = Σ de la columna del subtipo (`ingresado`/`liquidado_uw`/`traspasado`) de las líneas de ese
  recibo en ese mes de premium **que participaron en el flujo** (su fecha de cobro/liq./traspaso puesta).
  Como el importe de la transferencia es esa misma Σ, **cuadra** (Σ recibos = importe transferencia). Vale
  para Primas Y Comisiones/Honorarios; reproduce el PDF a mano (una fila por **recibo × mes de premium**).
  Respaldo por (binder,mes)/fecha SOLO para Primas antiguas (2018-19 sin fecha de flujo por línea).
- **Verificado:** 103.06 pasó de mayoría en blanco → **71 filas, 0 en blanco, Σ=60.460,15** (= importe).
  Sin regresión en Primas (Σfilas==Σtransferencias siempre). El `func.to_char(premium_bdx,'YYYY-MM')` debe
  ser UNA sola expresión reutilizada en SELECT y GROUP BY (si no, Postgres da GroupingError).

### 2) Justificante ESPEJO — otra pata de un traspaso entre cuentas propias
- **Caso:** el "**Ingreso Comisiones**" que ENTRA en la cuenta de la sociedad (Sabadell General **262.06**,
  +60.460,15) es el MISMO dinero que el "**Traspaso Comisiones**" que SALE de la cuenta de clientes
  (Bankinter **103.06**, −60.460,15): mismas 24 transferencias, mismo desglose (PDF idéntico, confirmado
  con `208.05`≡`076.05`). No se podía justificar porque: (a) "Ingreso Comisiones" es **ambiguo** — de 101
  apuntes, la mayoría son **cobros directos** (subtipo Cobro) y solo ~7 son traspaso → no se puede deducir
  el subtipo del concepto ni de la cuenta; (b) las 24 transferencias ya estaban usadas en el 103.06.
- **Solución (elegida por Fernando):** campo `movimientos_bancarios.**espejo_mid**` (migración
  `conta_espejo_mid_0001`). Un apunte se justifica como **espejo** de otro ya justificado, heredando sus
  transferencias/ajustes/clase; el PDF sale idéntico. En el modal aparece un **selector** con los apuntes
  candidatos (otra cuenta, mismo importe abs, fecha cercana, ya justificado) y una **vista previa** de las
  filas heredadas. Espejo y justificante propio son **excluyentes**; un apunte no puede espejarse a sí mismo.
- **Backend:** `_filas_justificante(db, m)` resuelve el espejo; endpoints `GET /contabilidad/{mid}/justificante`
  (filas JSON) y `/{mid}/espejo-candidatos`; `_build_justificante_pdf` parametriza `ajustes`;
  `_read.conciliado` incluye `espejo_mid`; `actualizar` persiste `espejo_mid` (excluyente con
  `transferencia_ids`). **Front:** `AltaMovimiento.tsx` muestra el justificante aunque el concepto no
  reconozca clase, con el selector de espejo y la vista previa; `api.ts` +`EspejoCandidato`,
  `espejoCandidatos`, `justificanteFilas`. **El 262.06 ya quedó enlazado al 103.06 en producción.**

### 3) Revisión 094.06 y 107.07 (NO tocados — Fernando mete los ajustes)
El desglose está bien (Σfilas==Σtransferencias). No cuadran con el banco por falta de **ajuste manual**:
- **094.06** (Cobro Primas, Bankinter 24/06): 2 cobros OM (Atca 64.669,44 + MDABNZ1J009 60.450,00 =
  125.119,44); el banco ingresó **+414,40** de más sin cobro que lo explique → ajuste **+414,40**.
- **107.07** (Liquidación Primas, Bankinter 07/07): 10 liquidaciones = 445.190,13; el banco pagó **−1.178,88**
  menos (algo se netea al liquidar al UW; cerca hay un siniestro B1634PI0620IBE de 1.179,00 ya justificado
  en 109.07, difiere 0,12) → ajuste **−1.178,88**. Fernando los mete a mano con el concepto correcto.

### Nota migraciones (recordatorio): el deploy NO ejecuta Alembic (`startup.sh` solo arranca gunicorn).
Las migraciones se aplican **a mano** con `alembic upgrade head` (usuario `mayrit_app`, que SÍ tiene DDL).
Ya aplicadas a prod: `conta_ajustes_justif_0001` y `conta_espejo_mid_0001`. Head del repo = `conta_espejo_mid_0001`.

---

## Sesión 11-12/07/2026 (equipo "ferna") — Conciliación bancaria (Norma 43), mapeo editable BDX, Tareas y reconciliación Alembic

### Conciliación bancaria — módulo nuevo (automatiza la contabilidad de los viernes)
Objetivo: dejar de teclear el extracto a mano cada semana. Dos fases, principio "NADA silencioso"
(proponer → revisar → confirmar).
- **Fase A — Importar extracto Norma 43 (Cuaderno 43 AEB).** Parser `backend/app/norma43.py` (registros
  11/22/23/33/88; varias cuentas por fichero; importe con signo debe/haber; descripción de los conceptos
  complementarios). Posiciones validadas contra extractos REALES de **Sabadell** y **Bankinter** con triple
  cuadre (saldo_ini+Σmov=saldo_fin, totales debe/haber del footer, nº apuntes). Botón "⬆️ Importar extracto"
  en Contabilidad → `ImportarExtracto.tsx`: preview (parsea, propone categoría en **cascada Grupo→Concepto**,
  marca Nuevo/Ya importado/Posible duplicado) → alta en bloque. Dedup por **huella** (`movimientos_bancarios.
  ref_extracto`, hash del apunte) para lo importado con el sistema nuevo; heurístico fecha+importe para lo
  antiguo sin huella.
- **Fase B — Conciliar** (`GET/POST /contabilidad/conciliar/preview|aplicar`, `ConciliarExtracto.tsx`, botón
  "🔗 Conciliar"). Por cada apunte de SEGUROS sin conciliar propone las Transferencias del ledger que cuadran
  (subtipo+ámbito+ventana ±días, excluyendo ya-usadas), con suma/residual y confianza (exacta/revisar/sin
  candidatas). Persiste SOLO lo confirmado (`transferencia_ids`); `_read.conciliado` ahora = bool(transferencia_ids).
  Realidad: los grupos grandes NO cuadran 1:1 (fees/pagos partidos) → "revisar" con residual, nunca auto-enlace.
  **Corte 2026 (13/07, decisión de negocio):** la conciliación IGNORA todo lo anterior a **2026-01-01** —
  ni apuntes ni transferencias candidatas de antes entran (`_CONCILIACION_DESDE` en `contabilidad.py`;
  aplicado a `conciliar_preview`, tanto al filtro de apuntes como al de transferencias).
- Regla de arquitectura (decidida): **recibos → transferencias (esperado)**, **extracto → banco (real)**,
  **Fase B → confirmar y detectar descuadres**. NO generar transferencias desde el banco (perdería el contexto
  binder/recibo/periodo y el control esperado-vs-real).
- Fix de datos: la cuenta Sabadell 0001407544 tenía 3 nombres (CuentaBancaria "Sabadell Siniestros" vacía vs
  1.447 movimientos bajo "Sabadell Clientes") → el dedup miraba la cuenta equivocada. Renombrada la
  CuentaBancaria a "Sabadell Clientes".

### Mapeo editable de columnas de BDX (Risk) — `bdx_alias`
Tabla `bdx_alias` (por programa + global). En "Subir Risk", cada columna no reconocida trae un desplegable
"→ asignar a campo"; se guarda por programa y las próximas subidas la reconocen solas. Lo no asignado sigue en
`extra` (cero pérdida). Panel para ver/quitar los alias del programa. Endpoints `/bdx/campos` y `/bdx/alias`.
Premium/Claims NO lo necesitan (solo comparan, no ingestan).

### Módulo Tareas — varios arreglos
- Bug de **periodo** (auto-marcado "antes de tiempo") y de **orden** en secuenciales: corregidos.
- **Pasos en paralelo** dentro de una tarea secuencial (grupos por `orden`; toggle "⇄ en paralelo con el
  anterior"), sin cambio de esquema.
- **Arranque rodante 01/07/2026**: las tareas AUTO generan entregas mensuales desde el 01/07/2026 (o su
  arranque natural si es posterior), rodando hacia delante; no se atan a la cobertura del binder ni a
  `fecha_inicio`; nada retroactivo. `_periodo_de` deriva el periodo del mes de la entrega.
- Periodos en UI como "Mayo 2026" (helper `mesAnyo`), nunca "2026-05".

### Reconciliación de Alembic (repo ↔ producción)
El repo tenía DOS heads colgando de `dgsfp_ag_0003` (`manual_secciones_0001`, donde apuntaba prod, y
`conta_ref_extracto_0001` = bdx_alias + ref_extracto). Migración de **merge** `merge_reconcilia_0001` (une
ambas, sin ops) + `alembic stamp` de prod a ese head. Verificado que prod tenía el esquema de ambas ramas.
Ahora repo y prod comparten un único head y `alembic upgrade` vuelve a funcionar limpio.

### Otros
- Gráfico de evolución del binder: **tooltip por mes** (prima acumulada de cada año). Ya estaba, aquí solo se
  menciona por continuidad.
- **Backup a NAS** confirmado hecho (alea+mayrit). **5 recibos duplicados** resueltos (0 duplicados de binder).

## Sesión 13/07/2026 (equipo "ferna") — Tareas (mes correcto), BDX (columnas y periodos), UI

### Tareas — el periodo comprobado ya no resta el plazo (arreglo del "sale mayo en julio")
En julio se carga el Risk de **junio**, pero la tarea decía "Risk cargado **mayo**". `_periodo_de`
(`tareas.py`) calculaba `mes(límite) − (intervalo + round(plazo/30))`. El plazo ya está incorporado en la
fecha límite (fin de periodo + plazo días), así que **restarlo otra vez** retrocedía un mes de más (con
`plazo=30`, el 93% de los binders: `round(30/30)=1` → julio−2 = mayo). Ahora es simplemente
`mes(límite) − intervalo` → julio comprueba junio. El plazo solo coloca la fecha límite/aviso, no el
periodo. Verificado en `/tareas/agenda` y `/tareas/{id}/ocurrencias`.

### Risk BDX — subida: mapear Cancellation Reason y Turnover (no caen en Extra)
Casi todas las plantillas los traen. Dos columnas nuevas en `bdx_lineas` (`cancellation_reason` texto,
`turnover` importe) + alias en el `MAPEO` (`sharepoint.py`), y se vuelcan en el Premium/LPAN Bdx (antes
salían vacías, `_bdx_fila` en `lpan.py`). Migración **`bdx_cancel_turnover_0001`** (aditiva, nulable),
aplicada a prod. Las líneas ya importadas los tienen en `extra`; las nuevas se mapean solas. *(Pendiente
opcional: backfill de `extra` → columnas para el histórico.)*

### Risk BDX — subida: listado de preview reducido a lo útil
Columnas del preview: **Certificado · Asegurado · GWP Our Line · Net Premium to Lloyd's Broker · Comisión a
Traspasar · Prima a Liquidar** (se quitan Secc./RC/Reporting/Com.%). Backend expone `net_premium_broker`
por línea + total (`bdx_import.py`).

### Premium/LPAN Bdx — descarga: Reporting Period = mes del Premium
Las columnas **Reporting Period Start/End Date** ahora son el día 1 y el último día del mes del Premium que
se descarga (igual para todas las filas), no el reporting del Risk de cada línea (`_bdx_fila` recibe
`per_ini`/`per_fin` desde el `periodo`).

### UI varios
- **Recibos · gestión cobros/pagos:** chips invertidos — se RESALTAN los pendientes (borde naranja) y se
  ATENÚAN los hechos; tooltip de los hechos en pasado (Cobrado, Liquidado, Traspasada, Pagada).
- **Nueva Cotización:** buscador de cliente por cualquier parte del nombre (combobox).
- **KPIs:** tooltip en el gráfico "Comisión retenida por año" (año, valor y variación vs año anterior).
- **Machear Premium:** encabezado y línea de totales fijos al hacer scroll (`.match-tabla` necesitaba
  `border-collapse:separate` + `overflow:visible` para que el sticky funcione).

### Justificante ESPEJO / conciliación — sin cambio de código
El apunte 262.06 (Sabadell General) no mostraba justificante y la conciliación daba "Not Found": el backend
LOCAL corría código viejo (procesos huérfanos que heredaban el socket del puerto 8000 y no soltaban el
`--reload`). Reiniciar el backend lo resolvió. **Aviso operativo:** el `--reload` local en Windows no es
fiable; tras cambios de backend hay que reiniciar (y matar workers `multiprocessing-fork` huérfanos si el
socket del puerto 8000 queda pillado por un padre muerto). **Mejor arrancar el backend local SIN `--reload`**
(`uvicorn app.main:app --port 8000`): más estable, sin watcher que se caiga ni sockets heredados; el precio
es reiniciar a mano al tocar backend, que es lo que había que hacer igualmente.

### Seguridad — refuerzo (defensa en profundidad, IMPLEMENTADA)
Cierra el "refinamiento futuro" que quedaba pendiente en la revisión del 21-22/06 (la API va detrás de Entra
Easy Auth, pero no añadía cabeceras propias).
- **Cabeceras HTTP de seguridad** (`backend/app/main.py`, middleware que las pone en toda respuesta):
  `Strict-Transport-Security` (HSTS, `max-age=31536000` → fuerza HTTPS), `X-Content-Type-Options: nosniff`,
  `X-Frame-Options: DENY` (anti-clickjacking, la app no se embebe en iframes),
  `Referrer-Policy: strict-origin-when-cross-origin` (limita fuga de URLs),
  `Permissions-Policy: geolocation=(), microphone=(), camera=()` (desactiva APIs del navegador que no se usan).
  **Sin CSP a propósito** para no romper el SPA (posible refinamiento futuro). Todas con `setdefault` (no
  pisan si ya vinieran puestas).
- **Dependabot** (`.github/dependabot.yml`): vigila **pip** (`/backend`), **npm** (`/frontend`) y
  **github-actions** (`/`); PR **agrupado semanal** por ecosistema (límite 5 PR abiertos). Los AVISOS de
  vulnerabilidad se activan en Settings → Security → "Dependabot alerts". Ya ha abierto/mergeado
  actualizaciones: vite, esbuild, grupo frontend (8 paquetes), y acciones de CI (checkout 4→7, setup-node
  4→6, azure/login 2→3).
- **4 vulnerabilidades de dependencias — RESUELTAS (14/07).** Eran las 4 del dev-server de Vite
  (`scope: development`, cero exposición en producción; 3 específicas de Windows). Se cerraron con un
  **salto mínimo `vite 5.4 → 6.4.3`** (arrastra `esbuild 0.25.12`; `plugin-react` queda en 4.7.0, v4), en
  vez del `vite 8` que proponía Dependabot, para minimizar riesgo. Verificado: `npm audit` 0 + build
  (`tsc && vite build`) OK. *(Los PRs de Dependabot que proponían vite 8 quedan obsoletos; los de
  github-actions —checkout/setup-node/azure-login— son aparte e inofensivos.)*
- Recordatorio de credenciales (sin cambios): las claves (`mayrit_app`, `SP_PFX_PASSWORD`…) viven SOLO en
  `~/.mayrit/.env` (fuera de OneDrive, fuera de git). La BD Azure es **producción compartida**; el backend
  local trabaja contra prod. Migraciones aplicadas a mano (`alembic upgrade head`).
