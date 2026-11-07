import json
import os
import requests
from osgeo import ogr, osr

# --- CONFIGURACIÓN DE SUPABASE ---
SUPABASE_URL = "https://vdltyryvmphxdcxjrgsf.supabase.co"
SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZkbHR5cnl2bXBoeGRjeGpyZ3NmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc3NTU5NTgsImV4cCI6MjEwMzMzMTk1OH0.vxqi58vWcfbWqoRTs9-AhalTOJS5rkOGQKbGrCOb9WA"
HEADERS = {"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}"}

def obtener_lat_lng(geom):
    """Extrae el centroide (longitud, latitud) de cualquier geometría GeoJSON o JSONB"""
    if not geom: return None, None
    if isinstance(geom, str):
        try:
            geom = json.loads(geom)
        except Exception:
            return None, None
            
    if not isinstance(geom, dict):
        return None, None
            
    g_type = geom.get('type')
    coords = geom.get('coordinates')
    if not coords: return None, None

    if g_type == 'Point':
        return coords[0], coords[1]
    elif g_type == 'Polygon':
        ring = coords[0]
        return sum(c[0] for c in ring) / len(ring), sum(c[1] for c in ring) / len(ring)
    elif g_type == 'MultiPolygon':
        ring = coords[0][0]
        return sum(c[0] for c in ring) / len(ring), sum(c[1] for c in ring) / len(ring)
    return None, None

def calcular_accesibilidad_transporte():
    print("🚌 Analizando la distancia de las canchas al transporte público...")
    
    # Habilitar excepciones en GDAL
    osr.UseExceptions()
    
    # Descargar canchas y paraderos desde Supabase
    canchas = requests.get(f"{SUPABASE_URL}/rest/v1/canchas?select=*", headers=HEADERS).json()
    paraderos = requests.get(f"{SUPABASE_URL}/rest/v1/paraderos_buses_sabaneta?select=geometry", headers=HEADERS).json()
    
    if not isinstance(paraderos, list):
        print(f"❌ Error al consultar paraderos: {paraderos}")
        return

    # 1. Configurar SRS para grados (EPSG:4326) y metros (EPSG:3857)
    source_sr = osr.SpatialReference()
    source_sr.ImportFromEPSG(4326)
    source_sr.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
    
    target_sr = osr.SpatialReference()
    target_sr.ImportFromEPSG(3857)
    target_sr.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
    
    transform_to_meters = osr.CoordinateTransformation(source_sr, target_sr)

    # 2. Procesar geometrías de paraderos y proyectarlas a metros
    geometrias_paraderos = []
    for p in paraderos:
        if isinstance(p, str):
            try:
                p = json.loads(p)
            except Exception:
                continue
        if not isinstance(p, dict):
            continue

        g = p.get("geometry")
        if g:
            if isinstance(g, str):
                try:
                    g = json.loads(g)
                except Exception:
                    continue
            
            if isinstance(g, dict):
                p_geom = ogr.CreateGeometryFromJson(json.dumps(g))
                if p_geom:
                    p_geom.Transform(transform_to_meters)
                    geometrias_paraderos.append(p_geom)

    # 3. Configurar salida GeoJSON resultante
    driver = ogr.GetDriverByName("GeoJSON")
    output_filename = "accesibilidad_transporte.geojson"
    if os.path.exists(output_filename):
        driver.DeleteDataSource(output_filename)

    ds = driver.CreateDataSource(output_filename)
    layer = ds.CreateLayer("accesibilidad", source_sr, ogr.wkbPoint)

    layer.CreateField(ogr.FieldDefn("cancha_id", ogr.OFTInteger))
    layer.CreateField(ogr.FieldDefn("nombre", ogr.OFTString))
    layer.CreateField(ogr.FieldDefn("distancia_paradero_m", ogr.OFTReal))
    layer.CreateField(ogr.FieldDefn("nivel_conectividad", ogr.OFTString))

    defn = layer.GetLayerDefn()

    # 4. Calcular la distancia mínima de cada cancha al paradero más cercano
    for c in canchas:
        if not isinstance(c, dict):
            continue
        lng, lat = obtener_lat_lng(c.get("geometry"))
        if lng is not None and lat is not None:
            pt = ogr.Geometry(ogr.wkbPoint)
            pt.AddPoint(lng, lat)
            pt.Transform(transform_to_meters)

            min_dist = float('inf')
            for paradero in geometrias_paraderos:
                d = pt.Distance(paradero)
                if d < min_dist:
                    min_dist = d

            # Clasificación analítica de conectividad para la Alcaldía
            if min_dist <= 200:
                conectividad = "🟢 Excelente Conectividad (<200m)"
            elif min_dist <= 500:
                conectividad = "🟡 Conectividad Moderada (200m - 500m)"
            else:
                conectividad = "🔴 Zona Aislada / Sin Transporte Cercano (>500m)"

            # Volver a WGS84 (lat/lng) para exportar el punto final
            pt.Transform(osr.CoordinateTransformation(target_sr, source_sr))

            feature = ogr.Feature(defn)
            feature.SetField("cancha_id", c.get("id", 0))
            feature.SetField("nombre", c.get("nombre", "Cancha"))
            feature.SetField("distancia_paradero_m", round(min_dist, 2))
            feature.SetField("nivel_conectividad", conectividad)
            feature.SetGeometry(pt)

            layer.CreateFeature(feature)
            feature = None

    ds = None
    print(f"✅ Análisis de transporte exportado con éxito: {output_filename}")

if __name__ == "__main__":
    calcular_accesibilidad_transporte()