import json
import os
from osgeo import ogr, osr
import requests

# Credenciales de Supabase
SUPABASE_URL = "https://vdltyryvmphxdcxjrgsf.supabase.co"
SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZkbHR5cnl2bXBoeGRjeGpyZ3NmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc3NTU5NTgsImV4cCI6MjEwMzMzMTk1OH0.vxqi58vWcfbWqoRTs9-AhalTOJS5rkOGQKbGrCOb9WA"


def obtener_datos_supabase():
  headers = {
      "apikey": SUPABASE_KEY,
      "Authorization": f"Bearer {SUPABASE_KEY}",
  }

  print("📥 Extrayendo capas vectoriales y relacionales desde Supabase...")

  res_canchas = requests.get(
      f"{SUPABASE_URL}/rest/v1/canchas?select=*", headers=headers
  )
  canchas = res_canchas.json() if res_canchas.status_code == 200 else []

  res_calif = requests.get(
      f"{SUPABASE_URL}/rest/v1/calificaciones_cancha?select=*", headers=headers
  )
  calificaciones = res_calif.json() if res_calif.status_code == 200 else []

  res_eventos = requests.get(
      f"{SUPABASE_URL}/rest/v1/eventos?select=*", headers=headers
  )
  eventos = res_eventos.json() if res_eventos.status_code == 200 else []

  return canchas, calificaciones, eventos


def obtener_lat_lng(geom_json):
  """Extrae las coordenadas (lng, lat) manejando Point, Polygon y MultiPolygon."""
  if not geom_json:
    return None, None
  g_type = geom_json.get("type")
  coords = geom_json.get("coordinates")
  if not coords:
    return None, None

  if g_type == "Point":
    return coords[0], coords[1]
  elif g_type == "Polygon":
    ring = coords[0]
    s_lng = sum(pt[0] for pt in ring)
    s_lat = sum(pt[1] for pt in ring)
    return s_lng / len(ring), s_lat / len(ring)
  elif g_type == "MultiPolygon":
    ring = coords[0][0]
    s_lng = sum(pt[0] for pt in ring)
    s_lat = sum(pt[1] for pt in ring)
    return s_lng / len(ring), s_lat / len(ring)

  return None, None


def procesar_capas_gdal():
  canchas, calificaciones, eventos = obtener_datos_supabase()
  print(f"🏟️ Canchas totales obtenidas de la BD: {len(canchas)}")

  metricas = {}
  for c in canchas:
    c_id = c["id"]
    metricas[c_id] = {
        "nombre": c.get("nombre", "Cancha de Sabaneta"),
        "surface": c.get("surface", "N/A"),
        "barrio_id": c.get("barrio_id", 0),
        "total_opiniones": 0,
        "suma_puntuacion": 0,
        "total_eventos": 0,
    }

  for cal in calificaciones:
    c_id = cal["cancha_id"]
    if c_id in metricas:
      metricas[c_id]["total_opiniones"] += 1
      metricas[c_id]["suma_puntuacion"] += cal.get("puntuacion", 0)

  for ev in eventos:
    c_id = ev["cancha_id"]
    if c_id in metricas:
      metricas[c_id]["total_eventos"] += 1

  driver_name = "GeoJSON"
  output_filename = "canchas_analisis_gdal.geojson"

  driver = ogr.GetDriverByName(driver_name)
  if os.path.exists(output_filename):
    driver.DeleteDataSource(output_filename)

  spatial_ref = osr.SpatialReference()
  spatial_ref.ImportFromEPSG(4326)

  data_source = driver.CreateDataSource(output_filename)
  layer = data_source.CreateLayer(
      "canchas_enriquecidas_gdal", spatial_ref, ogr.wkbPoint
  )

  layer.CreateField(ogr.FieldDefn("cancha_id", ogr.OFTInteger))
  layer.CreateField(ogr.FieldDefn("nombre", ogr.OFTString))
  layer.CreateField(ogr.FieldDefn("superficie", ogr.OFTString))
  layer.CreateField(ogr.FieldDefn("num_opiniones", ogr.OFTInteger))
  layer.CreateField(ogr.FieldDefn("promedio_est", ogr.OFTReal))
  layer.CreateField(ogr.FieldDefn("num_eventos", ogr.OFTInteger))
  layer.CreateField(ogr.FieldDefn("indice_uso", ogr.OFTString))

  feature_defn = layer.GetLayerDefn()

  print("⚙️ Procesando geometrías y calculando métricas espaciales con GDAL/OGR...")

  contador = 0
  for c in canchas:
    c_id = c["id"]
    geom_json = c.get("geometry")
    lng, lat = obtener_lat_lng(geom_json)

    if lng is not None and lat is not None:
      m = metricas.get(c_id, {})
      total_ops = m.get("total_opiniones", 0)
      suma_p = m.get("suma_puntuacion", 0)
      promedio = (suma_p / total_ops) if total_ops > 0 else 0.0
      total_ev = m.get("total_eventos", 0)

      indice = (
          "Alto Tráfico" if total_ev >= 2 or total_ops >= 3 else "Uso Estándar"
      )

      feature = ogr.Feature(feature_defn)
      feature.SetField("cancha_id", c_id)
      feature.SetField("nombre", m.get("nombre", ""))
      feature.SetField("superficie", m.get("surface", ""))
      feature.SetField("num_opiniones", total_ops)
      feature.SetField("promedio_est", round(promedio, 2))
      feature.SetField("num_eventos", total_ev)
      feature.SetField("indice_uso", indice)

      point = ogr.Geometry(ogr.wkbPoint)
      point.AddPoint(lng, lat)
      feature.SetGeometry(point)

      layer.CreateFeature(feature)
      feature = None
      contador += 1

  data_source = None
  print(
      f"✅ Capa procesada y exportada con éxito: {output_filename} (Features"
      f" generados: {contador})"
  )


if __name__ == "__main__":
  procesar_capas_gdal()