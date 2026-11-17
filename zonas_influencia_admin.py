import json
import os
from osgeo import ogr, osr
import requests
from supabase import create_client

# --- CONFIGURACIÓN DE SUPABASE ---
SUPABASE_URL = "https://vdltyryvmphxdcxjrgsf.supabase.co"
SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZkbHR5cnl2bXBoeGRjeGpyZ3NmIiwicm9sZSI6InFub24iLCJpYXQiOjE3ODc3NTU5NTgsImV4cCI6MjEwMzMzMTk1OH0.vxqi58vWcfbWqoRTs9-AhalTOJS5rkOGQKbGrCOb9WA"

# Inicializar el cliente oficial de Supabase
supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
HEADERS = {"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}"}

# ==========================================
# FUNCIÓN DE SUBIDA AUTOMÁTICA CON EL CLIENTE OFICIAL
# ==========================================
def subir_a_supabase_storage(nombre_archivo):
    print(f"🚀 Subiendo {nombre_archivo} a Supabase Storage...")
    try:
        with open(nombre_archivo, "rb") as f:
            file_bytes = f.read()

        # Intentamos actualizar el archivo con upsert habilitado
        response = supabase.storage.from_("evidencias").upload(
            path=nombre_archivo,
            file=file_bytes,
            file_options={"upsert": "true", "content-type": "application/geo+json"}
        )
        print(f"✅ ¡{nombre_archivo} subido y actualizado con éxito en Supabase Storage!")
    except Exception as e:
        # Si ya existe y upload lanza conflicto, usamos update
        try:
            with open(nombre_archivo, "rb") as f:
                file_bytes = f.read()
            supabase.storage.from_("evidencias").update(
                path=nombre_archivo,
                file=file_bytes,
                file_options={"upsert": "true", "content-type": "application/geo+json"}
            )
            print(f"✅ ¡{nombre_archivo} actualizado (via update) con éxito!")
        except Exception as err:
            print(f"❌ Error crítico al subir {nombre_archivo}: {err}")

# ==========================================
# FUNCIONES AYUDANTES
# ==========================================
def obtener_datos_supabase():
    """Descarga las canchas, calificaciones y eventos desde la API de Supabase"""
    print("📡 Descargando datos desde Supabase...")
    res_canchas = requests.get(f"{SUPABASE_URL}/rest/v1/canchas?select=*", headers=HEADERS)
    res_calif = requests.get(f"{SUPABASE_URL}/rest/v1/calificaciones_cancha?select=*", headers=HEADERS)
    res_eventos = requests.get(f"{SUPABASE_URL}/rest/v1/eventos?select=*", headers=HEADERS)

    canchas = res_canchas.json() if res_canchas.status_code == 200 else []
    calificaciones = res_calif.json() if res_calif.status_code == 200 else []
    eventos = res_eventos.json() if res_eventos.status_code == 200 else []
    
    return canchas, calificaciones, eventos

def obtener_lat_lng(geom):
    """Extrae el centroide (longitud, latitud) de cualquier geometría GeoJSON"""
    if not geom: 
        return None, None
        
    if geom['type'] == 'Point':
        return geom['coordinates'][0], geom['coordinates'][1]
    elif geom['type'] == 'Polygon':
        coords = geom['coordinates'][0]
        lng = sum(c[0] for c in coords) / len(coords)
        lat = sum(c[1] for c in coords) / len(coords)
        return lng, lat
    return None, None

# ==========================================
# FUNCIÓN 1: ZONAS DE INFLUENCIA (BUFFERS)
# ==========================================
def generar_zonas_influencia_admin():
    print("⚙️ Generando Zonas de Influencia (Buffers) para Administradores...")
    canchas, calificaciones, eventos = obtener_datos_supabase()
    
    res_participantes = requests.get(f"{SUPABASE_URL}/rest/v1/participantes_evento?select=*", headers=HEADERS)
    participantes = res_participantes.json() if res_participantes.status_code == 200 else []

    personas_por_evento = {}
    for p in participantes:
        ev_id = p["evento_id"]
        personas_por_evento[ev_id] = personas_por_evento.get(ev_id, 0) + 1

    personas_por_cancha = {}
    for ev in eventos:
        c_id = ev["cancha_id"]
        ev_id = ev["id"]
        personas_por_cancha[c_id] = personas_por_cancha.get(c_id, 0) + personas_por_evento.get(ev_id, 0)

    driver = ogr.GetDriverByName("GeoJSON")
    output_filename = "zonas_influencia_admin.geojson"
    if os.path.exists(output_filename):
        driver.DeleteDataSource(output_filename)

    source_sr = osr.SpatialReference()
    source_sr.ImportFromEPSG(4326)
    source_sr.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
    
    target_sr = osr.SpatialReference()
    target_sr.ImportFromEPSG(3857)
    target_sr.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)

    transform_to_meters = osr.CoordinateTransformation(source_sr, target_sr)
    transform_to_latlng = osr.CoordinateTransformation(target_sr, source_sr)

    data_source = driver.CreateDataSource(output_filename)
    layer = data_source.CreateLayer("zonas_admin", source_sr, ogr.wkbPolygon)
    
    layer.CreateField(ogr.FieldDefn("cancha_id", ogr.OFTInteger))
    layer.CreateField(ogr.FieldDefn("nombre", ogr.OFTString))
    layer.CreateField(ogr.FieldDefn("total_eventos", ogr.OFTInteger))
    layer.CreateField(ogr.FieldDefn("prioridad_inversion", ogr.OFTString))
    layer.CreateField(ogr.FieldDefn("radio_buffer_m", ogr.OFTReal))

    feature_defn = layer.GetLayerDefn()
    
    for c in canchas:
        c_id = c["id"]
        total_personas = personas_por_cancha.get(c_id, 0)
        
        eventos_de_cancha = [e for e in eventos if e["cancha_id"] == c_id]
        num_eventos = len(eventos_de_cancha)
        
        if total_personas >= 20 or num_eventos >= 5:
            nivel = "ALTA_INVERSION"
        elif total_personas >= 5 or num_eventos >= 2:
            nivel = "MANTENIMIENTO"
        else:
            nivel = "ZONA_TRANQUILA"

        lng, lat = obtener_lat_lng(c.get("geometry"))
        
        if lng is not None and lat is not None:
            point = ogr.Geometry(ogr.wkbPoint)
            point.AddPoint(lng, lat)
            
            point.Transform(transform_to_meters)
            radio_metros = max(total_personas * 3, 25)
            buffer_geom = point.Buffer(radio_metros)
            buffer_geom.Transform(transform_to_latlng)

            feature = ogr.Feature(feature_defn)
            feature.SetField("cancha_id", c_id)
            feature.SetField("nombre", c.get("nombre", "Cancha"))
            feature.SetField("total_eventos", num_eventos)
            feature.SetField("prioridad_inversion", nivel)
            feature.SetField("radio_buffer_m", float(radio_metros))
            feature.SetGeometry(buffer_geom)
            
            layer.CreateFeature(feature)
            feature = None

    data_source = None
    print(f"✅ Buffers de Administrador exportados: {output_filename}")
    
    # 🚀 Subir automáticamente a Supabase Storage
    subir_a_supabase_storage(output_filename)


# ==========================================
# FUNCIÓN 2: TORNEOS ACTIVOS
# ==========================================
def generar_capa_torneos_activos():
    print("⚙️ Generando capa de Torneos Activos...")
    canchas, _, eventos = obtener_datos_supabase()

    canchas_con_torneo = {}
    for ev in eventos:
        if ev.get("tipo_evento") == "Torneo":
            c_id = ev["cancha_id"]
            canchas_con_torneo[c_id] = ev

    driver = ogr.GetDriverByName("GeoJSON")
    output_filename = "canchas_con_torneos.geojson"
    if os.path.exists(output_filename):
        driver.DeleteDataSource(output_filename)

    spatial_ref = osr.SpatialReference()
    spatial_ref.ImportFromEPSG(4326)

    data_source = driver.CreateDataSource(output_filename)
    layer = data_source.CreateLayer("torneos_activos", spatial_ref, ogr.wkbPoint)
    
    layer.CreateField(ogr.FieldDefn("cancha_id", ogr.OFTInteger))
    layer.CreateField(ogr.FieldDefn("nombre_cancha", ogr.OFTString))
    layer.CreateField(ogr.FieldDefn("titulo_torneo", ogr.OFTString))
    layer.CreateField(ogr.FieldDefn("cupos", ogr.OFTInteger))
    
    feature_defn = layer.GetLayerDefn()

    for c in canchas:
        c_id = c["id"]
        if c_id in canchas_con_torneo:
            torneo = canchas_con_torneo[c_id]
            lng, lat = obtener_lat_lng(c.get("geometry"))
            
            if lng is not None and lat is not None:
                feature = ogr.Feature(feature_defn)
                feature.SetField("cancha_id", c_id)
                feature.SetField("nombre_cancha", c.get("nombre", ""))
                feature.SetField("titulo_torneo", torneo.get("titulo", "Torneo"))
                feature.SetField("cupos", torneo.get("cupos_equipos", 0))

                point = ogr.Geometry(ogr.wkbPoint)
                point.AddPoint(lng, lat)
                feature.SetGeometry(point)
                
                layer.CreateFeature(feature)
                feature = None

    data_source = None
    print(f"✅ Capa de torneos exportada: {output_filename}")
    
    # 🚀 Subir automáticamente a Supabase Storage
    subir_a_supabase_storage(output_filename)


# ==========================================
# BLOQUE DE EJECUCIÓN PRINCIPAL
# ==========================================
if __name__ == "__main__":
    generar_zonas_influencia_admin()
    generar_capa_torneos_activos()