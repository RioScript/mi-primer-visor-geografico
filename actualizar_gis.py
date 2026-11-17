"""
Regenera las capas GIS y las sube al bucket "evidencias" de Supabase:
  - zonas_influencia_admin.geojson  (buffers + prioridad de inversión)
  - canchas_analisis_gdal.geojson   (puntos con promedio, eventos e índice de uso)
  - canchas_con_torneos.geojson     (canchas con torneo)

Uso:  python actualizar_gis.py
Requiere: GDAL (osgeo) y requests.
"""
import os
import requests
from osgeo import ogr, osr

SUPABASE_URL = "https://vdltyryvmphxdcxjrgsf.supabase.co"
# OJO: esta es la llave ANON correcta (la anterior tenía "qnon" en vez de "anon")
SUPABASE_KEY = ("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZkbHR5cnl2bXBoeGRjeGpyZ3NmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc3NTU5NTgsImV4cCI6MjEwMzMzMTk1OH0."
                "vxqi58vWcfbWqoRTs9-AhalTOJS5rkOGQKbGrCOb9WA")
BUCKET = "evidencias"
HEADERS = {"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}"}


def leer(tabla, columnas="*"):
    r = requests.get(f"{SUPABASE_URL}/rest/v1/{tabla}?select={columnas}", headers=HEADERS, timeout=30)
    if r.status_code != 200:
        raise SystemExit(f"❌ No se pudo leer '{tabla}' ({r.status_code}): {r.text}")
    return r.json()


def subir(nombre):
    url = f"{SUPABASE_URL}/storage/v1/object/{BUCKET}/{nombre}"
    h = {**HEADERS, "Content-Type": "application/geo+json", "x-upsert": "true", "cache-control": "max-age=0"}
    with open(nombre, "rb") as f:
        # POST + x-upsert reemplaza el archivo si ya existe (requiere políticas INSERT y UPDATE)
        r = requests.post(url, headers=h, data=f, timeout=60)
    if r.status_code in (200, 201):
        print(f"🚀 {nombre} subido/actualizado")
    else:
        print(f"❌ Error subiendo {nombre} ({r.status_code}): {r.text}")


def lng_lat(geom):
    if not geom:
        return None, None
    if geom["type"] == "Point":
        return geom["coordinates"][0], geom["coordinates"][1]
    if geom["type"] == "Polygon":
        pts = geom["coordinates"][0]
        return sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts)
    return None, None


def srs(epsg):
    s = osr.SpatialReference()
    s.ImportFromEPSG(epsg)
    s.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
    return s


def nueva_capa(nombre_archivo, nombre_capa, tipo, campos):
    drv = ogr.GetDriverByName("GeoJSON")
    if os.path.exists(nombre_archivo):
        drv.DeleteDataSource(nombre_archivo)
    ds = drv.CreateDataSource(nombre_archivo)
    capa = ds.CreateLayer(nombre_capa, srs(4326), tipo)
    for n, t in campos:
        capa.CreateField(ogr.FieldDefn(n, t))
    return ds, capa


def main():
    print("📡 Descargando datos...")
    canchas = leer("canchas")
    eventos = leer("eventos")
    participantes = leer("participantes_evento", "evento_id")
    califs = leer("calificaciones_cancha", "cancha_id,puntuacion")

    por_evento = {}
    for p in participantes:
        por_evento[p["evento_id"]] = por_evento.get(p["evento_id"], 0) + 1
    personas, n_eventos = {}, {}
    for e in eventos:
        personas[e["cancha_id"]] = personas.get(e["cancha_id"], 0) + por_evento.get(e["id"], 0)
        n_eventos[e["cancha_id"]] = n_eventos.get(e["cancha_id"], 0) + 1
    cal = {}
    for c in califs:
        s, n = cal.get(c["cancha_id"], (0, 0))
        cal[c["cancha_id"]] = (s + c["puntuacion"], n + 1)

    a_metros = osr.CoordinateTransformation(srs(4326), srs(3857))
    a_grados = osr.CoordinateTransformation(srs(3857), srs(4326))

    # --- Zonas de influencia ---
    ds, capa = nueva_capa("zonas_influencia_admin.geojson", "zonas_admin", ogr.wkbPolygon, [
        ("cancha_id", ogr.OFTInteger), ("nombre", ogr.OFTString), ("total_eventos", ogr.OFTInteger),
        ("prioridad_inversion", ogr.OFTString), ("radio_buffer_m", ogr.OFTReal)])
    ds2, capa2 = nueva_capa("canchas_analisis_gdal.geojson", "analisis", ogr.wkbPoint, [
        ("cancha_id", ogr.OFTInteger), ("nombre", ogr.OFTString), ("promedio_est", ogr.OFTReal),
        ("num_opiniones", ogr.OFTInteger), ("num_eventos", ogr.OFTInteger), ("indice_uso", ogr.OFTString)])

    for c in canchas:
        lng, lat = lng_lat(c.get("geometry"))
        if lng is None:
            continue
        cid = c["id"]
        pers, nev = personas.get(cid, 0), n_eventos.get(cid, 0)
        if pers >= 20 or nev >= 5:
            nivel, indice = "ALTA_INVERSION", "Alto"
        elif pers >= 5 or nev >= 2:
            nivel, indice = "MANTENIMIENTO", "Medio"
        else:
            nivel, indice = "ZONA_TRANQUILA", "Bajo"

        # Buffer
        p = ogr.Geometry(ogr.wkbPoint)
        p.AddPoint(lng, lat)
        p.Transform(a_metros)
        radio = float(max(pers * 3, 25))
        b = p.Buffer(radio)
        b.Transform(a_grados)
        f = ogr.Feature(capa.GetLayerDefn())
        f.SetField("cancha_id", cid); f.SetField("nombre", c.get("nombre", "Cancha"))
        f.SetField("total_eventos", nev); f.SetField("prioridad_inversion", nivel)
        f.SetField("radio_buffer_m", radio); f.SetGeometry(b)
        capa.CreateFeature(f)

        # Punto de análisis
        s, n = cal.get(cid, (0, 0))
        pt = ogr.Geometry(ogr.wkbPoint)
        pt.AddPoint(lng, lat)
        f2 = ogr.Feature(capa2.GetLayerDefn())
        f2.SetField("cancha_id", cid); f2.SetField("nombre", c.get("nombre", "Cancha"))
        f2.SetField("promedio_est", round(s / n, 1) if n else 0.0)
        f2.SetField("num_opiniones", n); f2.SetField("num_eventos", nev)
        f2.SetField("indice_uso", indice); f2.SetGeometry(pt)
        capa2.CreateFeature(f2)
    ds = ds2 = None

    # --- Torneos ---
    torneos = {e["cancha_id"]: e for e in eventos if e.get("tipo_evento") == "Torneo"}
    ds3, capa3 = nueva_capa("canchas_con_torneos.geojson", "torneos_activos", ogr.wkbPoint, [
        ("cancha_id", ogr.OFTInteger), ("nombre_cancha", ogr.OFTString),
        ("titulo_torneo", ogr.OFTString), ("cupos", ogr.OFTInteger)])
    for c in canchas:
        t = torneos.get(c["id"])
        lng, lat = lng_lat(c.get("geometry"))
        if not t or lng is None:
            continue
        pt = ogr.Geometry(ogr.wkbPoint)
        pt.AddPoint(lng, lat)
        f = ogr.Feature(capa3.GetLayerDefn())
        f.SetField("cancha_id", c["id"]); f.SetField("nombre_cancha", c.get("nombre", ""))
        f.SetField("titulo_torneo", t.get("titulo", "Torneo")); f.SetField("cupos", t.get("cupos_equipos", 0) or 0)
        f.SetGeometry(pt)
        capa3.CreateFeature(f)
    ds3 = None

    for archivo in ("zonas_influencia_admin.geojson", "canchas_analisis_gdal.geojson", "canchas_con_torneos.geojson"):
        subir(archivo)


if __name__ == "__main__":
    main()
