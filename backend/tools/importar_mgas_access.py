"""Importación ÚNICA del Access de MGAs (MGAs 250525.accdb) al módulo de Agencias de Suscripción.

Fusiona con lo ya sincronizado del DGSFP:
  - dgsfp_agencias: rellena la FICHA MANUAL (CIF, dirección, contacto, web, notas, fechas, flags
    activo/dudoso/revisado) desde TMGA. El nombre oficial del DGSFP se conserva si ya existe.
  - dgsfp_aseguradoras: crea las que referencian los vínculos y aún no existen (aseguradoras de
    vínculos históricos/inactivos que no salen en el DGSFP actual).
  - dgsfp_vinculos: importa TBinders (267, con su Activo). El `activo` lo manda el Access (curación
    del usuario); `revisar` se levanta donde discrepa con la presencia en DGSFP (en_dgsfp).

Se lee de los JSON exportados del Access (por PowerShell). Uso:
    ~/.mayrit/venv/Scripts/python.exe -m tools.importar_mgas_access [carpeta_json]
"""
import datetime as dt
import json
import sys
from pathlib import Path

from app.db import SessionLocal
from app.models.maestras import DgsfpAgencia, DgsfpAseguradora, DgsfpVinculo

DIR = Path(r"C:\Dev\dgsfp\access_export")


def _n(s):
    return (str(s).strip() or None) if s not in (None, "") else None


def _fecha(s):
    return dt.date.fromisoformat(s) if s else None


def main(carpeta: Path = DIR):
    tmga = json.loads((carpeta / "tmga.json").read_text(encoding="utf-8-sig"))
    tbinders = json.loads((carpeta / "tbinders.json").read_text(encoding="utf-8-sig"))
    tase = json.loads((carpeta / "taseguradoras.json").read_text(encoding="utf-8-sig"))
    db = SessionLocal()
    try:
        # 1) Agencias (ficha manual desde TMGA)
        n_ag_new = 0
        for m in tmga:
            clave = _n(m.get("Clave"))
            if not clave:
                continue
            a = db.get(DgsfpAgencia, clave)
            if a is None:
                a = DgsfpAgencia(clave=clave, nombre=_n(m.get("Nombre")) or clave)
                db.add(a); n_ag_new += 1
            elif not a.nombre:
                a.nombre = _n(m.get("Nombre")) or clave
            a.cif = _n(m.get("CIF")); a.fecha_constitucion = _fecha(m.get("FechaConstitucion"))
            a.direccion = _n(m.get("Direccion")); a.cp = _n(m.get("CP")); a.localidad = _n(m.get("Localidad"))
            a.provincia = _n(m.get("Provincia")); a.pais = _n(m.get("Pais")); a.contacto = _n(m.get("Contacto"))
            a.telefono = _n(m.get("Telefono")); a.web = _n(m.get("Web")); a.notas = _n(m.get("Notas"))
            a.activo = bool(m.get("Activo")); a.dudoso = bool(m.get("Dudoso")); a.revisado = bool(m.get("Revisado"))
        db.flush()

        # 2) Aseguradoras referenciadas por los vínculos y que aún no existen
        ase_info = {_n(t.get("Clave")): (_n(t.get("Nombre")), _n(t.get("CIF"))) for t in tase if _n(t.get("Clave"))}
        n_ase_new = 0
        for clave in {_n(b.get("ClaveAsegurador")) for b in tbinders if _n(b.get("ClaveAsegurador"))}:
            if db.get(DgsfpAseguradora, clave):
                continue
            nombre, cif = ase_info.get(clave, (None, None))
            if not nombre:
                nombre = next((_n(b.get("NombreAsegurador")) for b in tbinders
                               if _n(b.get("ClaveAsegurador")) == clave and _n(b.get("NombreAsegurador"))), clave)
            db.add(DgsfpAseguradora(clave=clave, nombre=nombre or clave, nif=cif)); n_ase_new += 1
        db.flush()

        # 3) Vínculos (TBinders). Activo = Access; revisar donde discrepa con en_dgsfp.
        existentes = {(v.aseguradora_clave, v.agencia_clave): v for v in db.query(DgsfpVinculo).all()}
        n_vin_new = 0
        for b in tbinders:
            ag = _n(b.get("ClaveMGA")); ase = _n(b.get("ClaveAsegurador"))
            if not ag or not ase:
                continue
            if db.get(DgsfpAgencia, ag) is None:      # AS referenciada que no estaba en TMGA ni DGSFP
                db.add(DgsfpAgencia(clave=ag, nombre=ag)); db.flush()
            activo = bool(b.get("Activo"))
            v = existentes.get((ase, ag))
            if v is None:
                v = DgsfpVinculo(aseguradora_clave=ase, agencia_clave=ag, activo=activo, en_dgsfp=False)
                db.add(v); existentes[(ase, ag)] = v; n_vin_new += 1
            else:
                v.activo = activo
            en = bool(v.en_dgsfp)
            v.revisar = en != activo
            v.revisar_motivo = ("en DGSFP, marcado inactivo" if (en and not activo)
                                else ("activo, no en DGSFP" if (activo and not en) else None))
        db.commit()

        na = db.query(DgsfpAgencia).count()
        nas = db.query(DgsfpAseguradora).count()
        nv = db.query(DgsfpVinculo).count()
        nrev = db.query(DgsfpVinculo).filter(DgsfpVinculo.revisar.is_(True)).count()
        print(f"Agencias: {na} (nuevas {n_ag_new}) · Aseguradoras: {nas} (nuevas {n_ase_new}) · "
              f"Vínculos: {nv} (nuevos {n_vin_new}, a revisar {nrev})")
    finally:
        db.close()


if __name__ == "__main__":
    main(Path(sys.argv[1]) if len(sys.argv) > 1 else DIR)
