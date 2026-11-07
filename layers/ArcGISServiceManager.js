class ArcGISServiceManager {
    constructor(map, supabaseClient) {
        this.map = map;
        this.supabase = supabaseClient;
        this.capasActivas = new Map();
    }

    // Método para transformar una URL de ArcGIS FeatureServer a GeoJSON
    async cargarCapaFeatureServer(nombreCapa, baseUrl, estiloPersonalizado = {}) {
        try {
            // El endpoint nativo /query de ArcGIS permite exportar a GeoJSON con f=geojson
            const queryUrl = `${baseUrl}/query?where=1%3D1&outFields=*&f=geojson`;
            
            const response = await fetch(queryUrl);
            if (!response.ok) throw new Error(`Error al conectar con el servicio ArcGIS de ${nombreCapa}`);
            
            const geojsondata = await response.json();

            // Crear capa Leaflet optimizada con GeoJSON
            const capaLayer = L.geoJSON(geojsondata, {
                style: {
                    color: estiloPersonalizado.color || '#38bdf8',
                    weight: estiloPersonalizado.weight || 2,
                    fillOpacity: estiloPersonalizado.fillOpacity || 0.4
                },
                onEachFeature: (feature, layer) => {
                    const props = feature.properties;
                    // Construir un popup dinámico con los atributos devueltos por ArcGIS
                    let popupContent = `<div style="font-size: 0.85rem;"><b>📍 ${nombreCapa}</b><br>`;
                    for (let key in props) {
                        if (props[key] !== null && key !== 'geometry') {
                            popupContent += `<b>${key}:</b> ${props[key]}<br>`;
                        }
                    }
                    popupContent += `</div>`;
                    layer.bindPopup(popupContent);
                }
            });

            capaLayer.addTo(this.map);
            this.capasActivas.set(nombreCapa, capaLayer);

            console.log(`✅ Capa ArcGIS "${nombreCapa}" montada exitosamente.`);
            return capaLayer;

        } catch (error) {
            console.error(`❌ Error cargando la capa ${nombreCapa}:`, error);
        }
    }

    // Sincronizar capas activas desde Supabase
    async sincronizarCapasDesdeSupabase() {
        const { data, error } = await this.supabase
            .from('capas_arcgis_config')
            .select('*')
            .eq('activa', true);

        if (error) {
            console.error('Error al obtener la configuración de capas desde Supabase:', error);
            return;
        }

        for (const config of data) {
            await this.cargarCapaFeatureServer(config.nombre_capa, config.url_servicio, {
                color: config.estilo_color
            });
        }
    }
}