# Sincronizaciones automáticas (DGSFP + proyección de ingresos)

Dos tareas que **tienen que correr en local** (Azure no puede) y que antes dependían de un único PC
encendido a una hora fija → si estaba apagado, **fallaban en silencio**. Ahora corren desde
**cualquier PC de la oficina** que esté encendido, sin pisarse.

## Qué se sincroniza

| Job | Qué hace | Cada cuánto | Necesita en el PC |
|-----|----------|-------------|-------------------|
| `dgsfp` | Raspa el Registro de la DGSFP (agencias de suscripción) con Playwright → tablas `dgsfp_*` | ~mensual (corre si hace >28 días) | Playwright instalado |
| `proyeccion` | Lee la celda D42 del `Ppto 2026.xlsx` (OneDrive) → tabla `parametros` (KPIs) | ~diario (corre si hace >20 h) | El Excel del Ppto accesible (OneDrive) |

## Cómo funciona

- Una tarea programada **`MayritSyncs`** en cada PC portador llama a `ejecutar_syncs.ps1`, que ejecuta
  `python -m tools.runner_syncs` desde `backend`.
- El runner, en cada disparo: mira **cuándo salió bien por última vez** cada job (`parametros.actualizado`)
  y, si toca, **coge un candado en la BD** (tabla `sync_estado`) para que **solo un PC** lo ejecute
  aunque haya varios encendidos. El candado caduca solo (`lease_hasta`) por si un run se cuelga.
- Cada PC **solo intenta el job que puede**: si no tiene Playwright, salta `dgsfp`; si no tiene el Excel,
  salta `proyeccion`. Así un PC no marca errores falsos por algo que no le toca.
- **Catch-up:** los disparadores son *al iniciar sesión* + *cada 2 h* con `-StartWhenAvailable`, así que
  si a la hora prevista el PC estaba apagado, en cuanto se enciende ejecuta lo atrasado (no espera a la
  hora fija).
- **Red de seguridad:** si un sync se queda caducado (DGSFP >40 días, proyección >2 días) o el último
  intento dio error, sale una **alerta roja en la app** (aviso `sync_caducado`, en Inicio → Alertas).

## Instalar en un PC portador

Requisitos previos del PC: tener el `venv` en `~/.mayrit/venv` con el backend (como para levantar la app
en local) y, según el job que vaya a cubrir, Playwright y/o el OneDrive del Ppto sincronizado.

Crear una tarea programada **requiere administrador**. El doble clic NO ejecuta un `.ps1` (abre un
editor); lánzalo así: abre **PowerShell** (Inicio → "PowerShell" → Enter) y pega:

```powershell
powershell -ExecutionPolicy Bypass -File "C:\Dev\mayrit\ops\syncs\instalar_tarea.ps1"
```

El script **se auto-eleva** (te saldrá el UAC, acéptalo), registra la tarea, la verifica y deja el
resultado en `~/.mayrit/logs/instalar_tarea.log`. Debe decir `OK: tarea 'MayritSyncs' registrada`.
Repetir en cada PC que quieras que cubra (2-3 basta). Para DGSFP, el PC necesita Playwright:

```powershell
~/.mayrit/venv/Scripts/pip.exe install playwright
~/.mayrit/venv/Scripts/playwright.exe install chromium
```

## Comprobar / operar

```powershell
# Desde la carpeta backend:
cd C:\Dev\mayrit\backend
~/.mayrit/venv/Scripts/python.exe -m tools.runner_syncs --estado      # qué puede este PC, último OK, si toca
~/.mayrit/venv/Scripts/python.exe -m tools.runner_syncs               # ejecutar lo que toque ahora
~/.mayrit/venv/Scripts/python.exe -m tools.runner_syncs --forzar dgsfp  # forzar uno ignorando la cadencia
```

Log de la tarea: `~/.mayrit/logs/syncs.log`.
Quitar la tarea de un PC: `Unregister-ScheduledTask -TaskName MayritSyncs -Confirm:$false`.

## Umbrales (dónde tocarlos)

- Cadencia de ejecución (28 días / 20 h): `backend/tools/runner_syncs.py`, lista `JOBS`.
- Umbral de la alerta de caducado (40 días / 2 días): `backend/app/routers/avisos.py`, `_SYNCS_VIGILADOS`.
