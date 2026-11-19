// app.js - Visor Territorial e Inteligente de Canchas de Sabaneta (Con Listado Global de Eventos) Octubre 2026

class MapViewer {
    constructor(containerId) {
        // 1. OPTIMIZACIÓN CLAVE: Renderizado Canvas para evitar colapsar el DOM
        this.map = L.map(containerId, {
            zoomControl: false,
            preferCanvas: true // Renderiza polígonos y líneas en GPU Canvas
        }).setView([6.1515, -75.6166], 15);

        L.control.zoom({ position: 'bottomright' }).addTo(this.map);
        // Recalcular Leaflet cuando cambia el tamaño real del contenedor.
        this._mapResizeObserver = null;
        const mapElement = document.getElementById(containerId);
        if (mapElement && 'ResizeObserver' in window) {
            this._mapResizeObserver = new ResizeObserver(() => {
                if (this.map) this.map.invalidateSize({ pan: false, debounceMoveend: true });
            });
            this._mapResizeObserver.observe(mapElement);
        }
        window.addEventListener('resize', () => {
            if (this.map) this.map.invalidateSize({ pan: false, debounceMoveend: true });
        });


        // Capa Base Teselada XYZ de OpenStreetMap
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap contributors',
            maxZoom: 19,
            tileSize: 256
        }).addTo(this.map);

        // --- CLIENTE SUPABASE ---
        this.supabase = window.supabase.createClient(
            "https://vdltyryvmphxdcxjrgsf.supabase.co",
            "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZkbHR5cnl2bXBoeGRjeGpyZ3NmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc3NTU5NTgsImV4cCI6MjEwMzMzMTk1OH0.vxqi58vWcfbWqoRTs9-AhalTOJS5rkOGQKbGrCOb9WA"
        );

        // Crear versión 'debounced' para la función de filtrado (Escudo anti-colapso)
        this.aplicarFiltrosGlobalesDebounced = this.debounce(() => this.aplicarFiltrosGlobales(), 180);

        this.initIntro();
        // La decoración navideña va aparte y protegida: si otro módulo falla, igual se muestra (también a invitados)
        try { this.initNavidad(); } catch (e) { console.warn('Decoración navideña no disponible:', e); }
        this.canchaSeleccionadaId = null;
        this.datosCanchas = [];
        this.listaBarrios = [];
        this.datosParaderos = [];
        this.datosEventos = [];
        this.capaMarcadoresZoom = null;
        this.layerControl = null;
        this.capaRuta = null;
        this.marcadoresRuta = [];
        this.barrioSeleccionadoValor = '';
        this._canchaAdminEditando = null;

        // Variables de estado para capas
        this.modoEnfoqueActivo = false;
        this.capaLimite = null;
        this.geometriaSabaneta = null;
        this.capaMascaraGroup = null;
        this.capaVias = null;
        this.capaMetro = null;
        this.capaParaderos = null;
        this.capaBuffer = null;
        this.capaGdalGroup = null;
        this.capaZonasInfluencia = null;

        this.favoritos = JSON.parse(localStorage.getItem('canchas_favoritas')) || [];

        // El gestor ArcGIS es auxiliar; su ausencia no debe detener el visor.
        if (typeof ArcGISServiceManager !== 'undefined') {
            this.arcgisManager = new ArcGISServiceManager(this.map, this.supabase);
            const urlEjemplo = "";
            this.arcgisManager.cargarCapaFeatureServer("", urlEjemplo, {
                color: "#10b981",
                weight: 3
            });
        } else {
            console.warn('ArcGISServiceManager no está disponible; se omiten únicamente las capas ArcGIS externas.');
            this.arcgisManager = null;
        }

        // Exponer la instancia globalmente
        window.mapApp = this;
        window.mapViewer = this;

        // Inicializar componentes
        this.initCoordinateCapture();
        this.initModalEvents();
        this.initCalificacionesEvents();
        this.initBuscador();
        this.initFiltrosAvanzados();
        this.initFiltrosEventosSidebar();
        this.initSelectModernoBarrio();
        this.initOrdenEstrellas(); // Inicializar el listener del filtro de estrellas
        this.initBuscadorEventosGlobal(); // Inicializar buscador de la sección de eventos

        this.cargarCanchas();
        this.cargarEventosGlobales();
        this.cargarLimiteSabaneta();
        this.cargarEstacionesMetroSupabase();
        this.cargarParaderosSabaneta();
        this.initEnfoqueSabaneta();
        this.cargarViasSabaneta();
        this.initControlCapasUI();
        this.initPanelesFlotantes();
        this.initMenuMovil();
        this.cargarCapaGdalProcesada();
        this.initCargaEfectivaPorViewport();

        setTimeout(() => {
            this.map.invalidateSize();
        }, 200);
    }

    // --- UTILIDAD DE DESREBOTE (DEBOUNCE) ---
    debounce(func, wait = 200) {
        let timeout;
        return (...args) => {
            clearTimeout(timeout);
            timeout = setTimeout(() => func.apply(this, args), wait);
        };
    }

    initCargaEfectivaPorViewport() {
        this.map.on('moveend', this.debounce(() => {
            if (this.modoEnfoqueActivo) {
                this.filtrarVectoresPorViewport();
            }
        }, 250));
    }

    filtrarVectoresPorViewport() {
        const bounds = this.map.getBounds();
        if (!this.datosCanchas || this.datosCanchas.length === 0) return;

        const visibles = this.datosCanchas.filter(c => {
            const coords = this.obtenerCoordenadasGeom(c.geometry);
            return coords && bounds.contains([coords.lat, coords.lng]);
        });

        this.actualizarEstadisticas(visibles);
    }

    initCoordinateCapture() {
        this.map.on('click', (e) => {
            const lat = e.latlng.lat.toFixed(5);
            const lng = e.latlng.lng.toFixed(5);
            const coordEl = document.getElementById('coordenadas');
            if (coordEl) coordEl.innerText = `Lat: ${lat}, Lng: ${lng}`;
        });
    }

    initModalEvents() {
        const btnCerrar = document.getElementById('modal-cerrar');
        if (btnCerrar) {
            btnCerrar.addEventListener('click', () => {
                document.getElementById('modal-overlay').classList.add('oculto');
                this.canchaSeleccionadaId = null;
                document.getElementById('form-evidencia').reset();
                document.getElementById('form-crear-evento').reset();
                document.getElementById('form-crear-evento').classList.add('oculto');
                document.getElementById('seccion-eventos-hub').classList.add('oculto');
                document.getElementById('mensaje-evidencia').innerText = '';
                document.getElementById('mensaje-crear-evento').innerText = '';
                const seccionOpcionesRuta = document.getElementById('seccion-opciones-ruta');
                if (seccionOpcionesRuta) seccionOpcionesRuta.classList.add('oculto');
            });
        }

        const formEvidencia = document.getElementById('form-evidencia');
        if (formEvidencia) {
            formEvidencia.addEventListener('submit', async (e) => {
                e.preventDefault();
                await this.subirEvidencia();
            });
        }

        const btnTrazarRuta = document.getElementById('btn-trazar-ruta');
        if (btnTrazarRuta) {
            btnTrazarRuta.addEventListener('click', () => {
                const seccionOpciones = document.getElementById('seccion-opciones-ruta');
                if (seccionOpciones) seccionOpciones.classList.toggle('oculto');
            });
        }

        const btnRutaVehiculo = document.getElementById('btn-ruta-vehiculo');
        if (btnRutaVehiculo) btnRutaVehiculo.addEventListener('click', () => this.trazarRutaACancha('driving'));

        const btnRutaApie = document.getElementById('btn-ruta-apie');
        if (btnRutaApie) btnRutaApie.addEventListener('click', () => this.trazarRutaACancha('foot'));

        const btnRutaBusPublico = document.getElementById('btn-ruta-bus-publico');
        if (btnRutaBusPublico) btnRutaBusPublico.addEventListener('click', () => this.trazarRutaBusInteligente());

        const btnFav = document.getElementById('btn-favorito-modal');
        if (btnFav) btnFav.addEventListener('click', () => this.toggleFavoritoActual());

        const btnEventosOverlay = document.getElementById('btn-eventos-overlay');
        if (btnEventosOverlay) {
            btnEventosOverlay.addEventListener('click', async () => {
                const seccion = document.getElementById('seccion-eventos-hub');
                if (seccion) {
                    seccion.classList.toggle('oculto');
                    if (!seccion.classList.contains('oculto')) {
                        await this.cargarEventosCancha(this.canchaSeleccionadaId);
                    }
                }
            });
        }

        const btnToggleForm = document.getElementById('btn-toggle-form-evento');
        const btnCerrarForm = document.getElementById('btn-cerrar-form-evento');
        const formCrearEvento = document.getElementById('form-crear-evento');

        if (btnToggleForm && formCrearEvento) {
            btnToggleForm.addEventListener('click', () => formCrearEvento.classList.toggle('oculto'));
        }
        if (btnCerrarForm && formCrearEvento) {
            btnCerrarForm.addEventListener('click', () => {
                formCrearEvento.classList.add('oculto');
                document.getElementById('mensaje-crear-evento').innerText = '';
            });
        }

        const selectTipo = document.getElementById('evento-tipo');
        if (selectTipo) {
            selectTipo.addEventListener('change', (e) => {
                const val = e.target.value;
                const secPartido = document.getElementById('seccion-campos-partido');
                const secTorneo = document.getElementById('seccion-campos-torneo');

                if (val === 'Torneo') {
                    secPartido.style.display = 'none';
                    secTorneo.style.display = 'block';
                } else {
                    secPartido.style.display = 'block';
                    secTorneo.style.display = 'none';

                    const wrapApuesta = document.getElementById('wrap-monto-apuesta');
                    if (wrapApuesta) {
                        wrapApuesta.style.display = (val === 'Reto / Apostado') ? 'block' : 'none';
                    }
                }
            });
        }

        const chkRival = document.getElementById('evento-necesita-rival');
        if (chkRival) {
            chkRival.addEventListener('change', (e) => {
                document.getElementById('wrap-formato').style.display = e.target.checked ? 'block' : 'none';
            });
        }

        const chkFaltan = document.getElementById('evento-faltan-jugadores');
        if (chkFaltan) {
            chkFaltan.addEventListener('change', (e) => {
                document.getElementById('wrap-cant-faltantes').style.display = e.target.checked ? 'block' : 'none';
            });
        }

        const chkCosto = document.getElementById('evento-check-costo');
        if (chkCosto) {
            chkCosto.addEventListener('change', (e) => {
                document.getElementById('wrap-costo-inscripcion').style.display = e.target.checked ? 'block' : 'none';
            });
        }

        const chkPremio = document.getElementById('evento-check-premio');
        if (chkPremio) {
            chkPremio.addEventListener('change', (e) => {
                document.getElementById('wrap-valor-premio').style.display = e.target.checked ? 'block' : 'none';
            });
        }

        const inputFechaHora = document.getElementById('evento-fecha-hora');
        if (inputFechaHora) {
            inputFechaHora.addEventListener('change', (e) => {
                if (e.target.value) {
                    e.target.blur();
                }
            });
        }

        if (formCrearEvento) {
            formCrearEvento.addEventListener('submit', async (e) => {
                e.preventDefault();
                await this.guardarNuevoEvento();
            });
        }
    }

    initIntro() {
        let modoRegistro = false;

        const tabLogin = document.getElementById('tab-login');
        const tabRegister = document.getElementById('tab-register');
        const btnAuthText = document.getElementById('btn-auth-text');
        const formAuth = document.getElementById('form-auth');

        const btnAbrirAuth = document.getElementById('btn-abrir-auth');
        const btnCerrarAuth = document.getElementById('btn-cerrar-auth');
        const modalAuth = document.getElementById('modal-auth');

        const btnInvitado = document.getElementById('btn-invitado');
        const overlay = document.getElementById('intro-overlay');

        const emailInput = document.getElementById('auth-email');
        const passwordInput = document.getElementById('auth-password');
        const msgEl = document.getElementById('auth-mensaje');

        const mostrarMensaje = (mensaje, color = '#1c6ea4') => {
            if (!msgEl) return;
            msgEl.innerText = mensaje;
            msgEl.style.color = color;
        };

        const cambiarModo = (registro) => {
            modoRegistro = registro;
            if (tabLogin) tabLogin.classList.toggle('is-active', !registro);
            if (tabRegister) tabRegister.classList.toggle('is-active', registro);
            if (btnAuthText) btnAuthText.innerText = registro ? 'CREAR CUENTA' : 'INGRESAR AL VISOR';
            mostrarMensaje('');
        };

        const abrirAuth = () => {
            if (modalAuth) modalAuth.classList.remove('oculto');
            cambiarModo(false);
            if (emailInput) emailInput.focus();
        };

        const cerrarAuth = () => {
            if (modalAuth) modalAuth.classList.add('oculto');
            mostrarMensaje('');
            if (formAuth) formAuth.reset();
        };

        if (btnAbrirAuth) btnAbrirAuth.addEventListener('click', () => abrirAuth());
        if (btnCerrarAuth) btnCerrarAuth.addEventListener('click', () => cerrarAuth());

        if (modalAuth) {
            modalAuth.addEventListener('click', (e) => {
                if (e.target === modalAuth) cerrarAuth();
            });
        }

        if (tabLogin) tabLogin.addEventListener('click', () => cambiarModo(false));
        if (tabRegister) tabRegister.addEventListener('click', () => cambiarModo(true));

        if (formAuth) {
            formAuth.addEventListener('submit', async (e) => {
                e.preventDefault();
                const email = emailInput?.value.trim() || '';
                const password = passwordInput?.value || '';

                if (!email || !password) {
                    mostrarMensaje('❌ Debes completar el correo y la contraseña.', '#b3382d');
                    return;
                }

                if (password.length < 6) {
                    mostrarMensaje('❌ La contraseña debe tener mínimo 6 caracteres.', '#b3382d');
                    return;
                }

                const botonSubmit = formAuth.querySelector('button[type="submit"]');
                if (botonSubmit) {
                    botonSubmit.disabled = true;
                    botonSubmit.style.opacity = '0.6';
                    botonSubmit.style.cursor = 'not-allowed';
                }

                try {
                    if (modoRegistro) {
                        mostrarMensaje('Creando cuenta...', '#1c6ea4');
                        const { data, error } = await this.supabase.auth.signUp({ email, password });

                        if (error) {
                            mostrarMensaje(`❌ ${error.message}`, '#b3382d');
                            return;
                        }

                        if (data?.user) {
                            await this.supabase.from('profiles').upsert([{ id: data.user.id, email, role: 'user' }], { onConflict: 'id' });
                        }

                        if (data?.session) {
                            mostrarMensaje('✅ ¡Cuenta creada correctamente!', '#0b7a4f');
                            setTimeout(() => {
                                cerrarAuth();
                                if (overlay) overlay.classList.add('fade-out');
                                if (data.user) this.verificarPermisosAdmin(data.user.id);
                                if (this.map) { this.map.invalidateSize({ pan: false }); setTimeout(() => this.map.invalidateSize({ pan: false }), 250); }
                            }, 700);
                        } else {
                            mostrarMensaje('✅ Cuenta creada. Revisa tu correo para confirmar la cuenta.', '#0b7a4f');
                            cambiarModo(false);
                        }
                    } else {
                        mostrarMensaje('Iniciando sesión...', '#1c6ea4');
                        const { data, error } = await this.supabase.auth.signInWithPassword({ email, password });

                        if (error) {
                            mostrarMensaje(`❌ ${error.message}`, '#b3382d');
                            return;
                        }

                        mostrarMensaje('✅ ¡Bienvenido!', '#0b7a4f');
                        setTimeout(() => {
                            cerrarAuth();
                            if (overlay) overlay.classList.add('fade-out');
                            if (data?.user) this.verificarPermisosAdmin(data.user.id);
                            if (this.map) { this.map.invalidateSize({ pan: false }); setTimeout(() => this.map.invalidateSize({ pan: false }), 250); }
                        }, 600);
                    }
                } catch (err) {
                    mostrarMensaje('❌ Ocurrió un error inesperado. Intenta nuevamente.', '#b3382d');
                } finally {
                    if (botonSubmit) {
                        botonSubmit.disabled = false;
                        botonSubmit.style.opacity = '1';
                        botonSubmit.style.cursor = 'pointer';
                    }
                }
            });
        }

        if (btnInvitado && overlay) {
            btnInvitado.addEventListener('click', () => {
                overlay.classList.add('fade-out');
                setTimeout(() => {
                    if (this.map) {
                        this.map.invalidateSize({ pan: false });
                        requestAnimationFrame(() => this.map.invalidateSize({ pan: false }));
                        setTimeout(() => this.map.invalidateSize({ pan: false }), 250);
                    }
                }, 350);
            });
        }

        this.supabase.auth.getSession().then(({ data }) => {
            const session = data?.session;
            if (session?.user) {
                if (overlay) overlay.classList.add('fade-out');
                this.verificarPermisosAdmin(session.user.id);
                setTimeout(() => {
                    if (this.map) { this.map.invalidateSize({ pan: false }); setTimeout(() => this.map.invalidateSize({ pan: false }), 250); }
                }, 500);
            }
        });
    }

    async verificarPermisosAdmin(userId) {
        const { data, error } = await this.supabase
            .from('profiles')
            .select('role')
            .eq('id', userId)
            .single();

        if (!error && data && data.role === 'admin') {
            const slotAdmin = document.getElementById('header-acciones');
            if (slotAdmin && !document.getElementById('contenedor-btn-admin')) {
                const divAdmin = document.createElement('div');
                divAdmin.id = 'contenedor-btn-admin';
                divAdmin.innerHTML = `
                    <button id="btn-abrir-admin" type="button" class="btn btn--admin btn--sm">
                        <svg class="icon"><use href="#i-shield"/></svg>
                        Administración
                    </button>
                `;
                slotAdmin.appendChild(divAdmin);
                this.initAdminPanelEvents();

                this.cargarZonasInfluenciaAdmin();
            }

            // La tarjeta del motor GIS vive en la pestaña "Análisis GIS" del panel
            const slotGis = document.getElementById('admin-gis-slot');
            if (slotGis && !document.getElementById('btn-recalcular-gdal')) {
                const btnGdalContainer = document.createElement('div');
                btnGdalContainer.className = 'admin-card admin-card--gis';
                btnGdalContainer.innerHTML = `
                    <div class="gis-card__radar" aria-hidden="true"><i></i><i></i><i></i></div>
                    <div class="gis-card__cuerpo">
                        <span class="gis-card__etiqueta">Centro de análisis espacial · PostGIS</span>
                        <h4 class="gis-card__titulo">Zonas de influencia de las canchas</h4>
                        <p class="gis-card__txt">Cada vez que agregues, edites o elimines canchas, recalcula para actualizar los buffers y el análisis en el mapa.</p>
                        <ul class="gis-leyenda">
                            <li><i style="--c:#dc2626"></i>Alta inversión</li>
                            <li><i style="--c:#f59e0b"></i>Mantenimiento</li>
                            <li><i style="--c:#3b82f6"></i>Zona tranquila</li>
                            <li><i style="--c:#a855f7"></i>Punto de análisis</li>
                        </ul>
                        <button id="btn-recalcular-gdal" type="button" onclick="window.mapApp.recalcularAnalisisGdal()" class="btn btn--gis btn--block">
                            <svg class="icon"><use href="#i-refresh"/></svg>
                            Recalcular análisis GIS
                        </button>
                        <small id="gis-ultima-act" class="gis-card__sello">Mide uso, calificaciones y eventos de cada cancha</small>
                    </div>
                `;
                slotGis.appendChild(btnGdalContainer);
            }
        }
    }

    // ------------------------------------------------------------------
    // ANÁLISIS ESPACIAL (reemplaza al script de Python/GDAL)
    // Lee canchas, eventos, participantes y calificaciones de Supabase,
    // calcula buffers y métricas, y sube los GeoJSON al bucket "evidencias".
    // ------------------------------------------------------------------
    crearBufferCirculo(lng, lat, radioM, pasos = 48) {
        const R = 6378137;
        const dLat = (radioM / R) * (180 / Math.PI);
        const dLng = dLat / Math.cos(lat * Math.PI / 180);
        const anillo = [];
        for (let i = 0; i < pasos; i++) {
            const a = (2 * Math.PI * i) / pasos;
            anillo.push([+(lng + dLng * Math.cos(a)).toFixed(7), +(lat + dLat * Math.sin(a)).toFixed(7)]);
        }
        anillo.push(anillo[0]);
        return { type: 'Polygon', coordinates: [anillo] };
    }

    async subirGeoJsonStorage(nombreArchivo, objeto) {
        const blob = new Blob([JSON.stringify(objeto)], { type: 'application/geo+json' });
        const { error } = await this.supabase.storage
            .from('evidencias')
            .upload(nombreArchivo, blob, { upsert: true, contentType: 'application/geo+json', cacheControl: '0' });
        if (error) throw new Error(`No se pudo subir ${nombreArchivo}: ${error.message}`);
    }

    async generarYSubirAnalisisGis(onPaso = () => { }) {
        onPaso(0);
        const [rC, rCal, rEv, rPar] = await Promise.all([
            this.supabase.from('canchas').select('*'),
            this.supabase.from('calificaciones_cancha').select('cancha_id, puntuacion'),
            this.supabase.from('eventos').select('id, cancha_id, tipo_evento'),
            this.supabase.from('participantes_evento').select('evento_id')
        ]);
        const fallo = [rC, rCal, rEv, rPar].find(r => r.error);
        if (fallo) throw new Error('Error leyendo datos: ' + fallo.error.message);

        const canchas = rC.data || [], calificaciones = rCal.data || [];
        const eventos = rEv.data || [], participantes = rPar.data || [];

        const personasPorEvento = {};
        participantes.forEach(p => { personasPorEvento[p.evento_id] = (personasPorEvento[p.evento_id] || 0) + 1; });

        const personasPorCancha = {}, eventosPorCancha = {};
        eventos.forEach(ev => {
            personasPorCancha[ev.cancha_id] = (personasPorCancha[ev.cancha_id] || 0) + (personasPorEvento[ev.id] || 0);
            eventosPorCancha[ev.cancha_id] = (eventosPorCancha[ev.cancha_id] || 0) + 1;
        });

        const califPorCancha = {};
        calificaciones.forEach(c => {
            const a = califPorCancha[c.cancha_id] || (califPorCancha[c.cancha_id] = { suma: 0, n: 0 });
            a.suma += c.puntuacion; a.n += 1;
        });

        onPaso(1);
        const zonas = [], analisis = [];
        const resumen = { canchas: 0, alta: 0, mantenimiento: 0, tranquila: 0 };

        canchas.forEach(c => {
            const centro = this.obtenerCoordenadasGeom(c.geometry);
            if (!centro || isNaN(centro.lat) || isNaN(centro.lng)) return;

            const personas = personasPorCancha[c.id] || 0;
            const nEventos = eventosPorCancha[c.id] || 0;

            let nivel = 'ZONA_TRANQUILA', indice = 'Bajo';
            if (personas >= 20 || nEventos >= 5) { nivel = 'ALTA_INVERSION'; indice = 'Alto'; resumen.alta++; }
            else if (personas >= 5 || nEventos >= 2) { nivel = 'MANTENIMIENTO'; indice = 'Medio'; resumen.mantenimiento++; }
            else resumen.tranquila++;
            resumen.canchas++;

            const radio = Math.max(personas * 3, 25);
            zonas.push({
                type: 'Feature',
                properties: {
                    cancha_id: c.id, nombre: c.nombre || 'Cancha', total_eventos: nEventos,
                    prioridad_inversion: nivel, radio_buffer_m: radio
                },
                geometry: this.crearBufferCirculo(centro.lng, centro.lat, radio)
            });

            const cal = califPorCancha[c.id];
            analisis.push({
                type: 'Feature',
                properties: {
                    cancha_id: c.id, nombre: c.nombre || 'Cancha',
                    promedio_est: cal ? +(cal.suma / cal.n).toFixed(1) : 0,
                    num_opiniones: cal ? cal.n : 0, num_eventos: nEventos, indice_uso: indice
                },
                geometry: { type: 'Point', coordinates: [centro.lng, centro.lat] }
            });
        });

        onPaso(2);
        await this.subirGeoJsonStorage('zonas_influencia_admin.geojson', { type: 'FeatureCollection', features: zonas });
        await this.subirGeoJsonStorage('canchas_analisis_gdal.geojson', { type: 'FeatureCollection', features: analisis });
        return resumen;
    }

    // ------------------------------------------------------------------
    // INTERFAZ TEMÁTICA: toasts, confirmación y pantalla de proceso GIS
    // ------------------------------------------------------------------
    toast(mensaje, tipo) {
        let cont = document.getElementById('toast-stack');
        if (!cont) {
            cont = document.createElement('div');
            cont.id = 'toast-stack';
            cont.setAttribute('aria-live', 'polite');
            document.body.appendChild(cont);
        }
        const texto = String(mensaje);
        if (!tipo) tipo = /^\s*(❌|🚨)/.test(texto) ? 'error' : /^\s*⚠️/.test(texto) ? 'aviso' : 'ok';
        const limpio = texto.replace(/^\s*(✅|❌|⚠️|🚨)\s*/, '');
        const iconos = { ok: '#i-check', error: '#i-x', aviso: '#i-target' };

        const t = document.createElement('div');
        t.className = `toast toast--${tipo}`;
        t.innerHTML = `<span class="toast__ico"><svg class="icon"><use href="${iconos[tipo]}"/></svg></span>
                       <span class="toast__txt"></span><i class="toast__bar"></i>`;
        t.querySelector('.toast__txt').textContent = limpio;
        cont.appendChild(t);
        const quitar = () => { t.classList.add('toast--sale'); setTimeout(() => t.remove(), 300); };
        t.addEventListener('click', quitar);
        setTimeout(quitar, 4200);
    }

    confirmar(titulo, texto, textoBoton = 'Confirmar') {
        return new Promise(resolve => {
            const ov = document.createElement('div');
            ov.className = 'gis-modal';
            ov.innerHTML = `
                <div class="gis-modal__card gis-modal__card--peligro" role="alertdialog" aria-modal="true">
                    <div class="gis-modal__tarjeta"><span></span></div>
                    <h3></h3><p></p>
                    <div class="gis-modal__acciones">
                        <button type="button" class="btn btn--ghost" data-r="0">Cancelar</button>
                        <button type="button" class="btn btn--peligro" data-r="1"></button>
                    </div>
                </div>`;
            ov.querySelector('h3').textContent = titulo;
            ov.querySelector('p').textContent = texto;
            ov.querySelector('[data-r="1"]').textContent = textoBoton;
            const cerrar = (r) => { ov.classList.add('gis-modal--sale'); setTimeout(() => ov.remove(), 220); resolve(r); };
            ov.addEventListener('click', (e) => {
                if (e.target === ov) return cerrar(false);
                const b = e.target.closest('[data-r]');
                if (b) cerrar(b.dataset.r === '1');
            });
            document.body.appendChild(ov);
            ov.querySelector('[data-r="0"]').focus();
        });
    }

    mostrarProcesoGis() {
        const pasos = [
            'Leyendo canchas, eventos y calificaciones',
            'Calculando zonas de influencia (buffers)',
            'Publicando capas en Supabase Storage',
            'Actualizando el mapa'
        ];
        const ov = document.createElement('div');
        ov.className = 'gis-proceso';
        ov.innerHTML = `
            <div class="gis-proceso__card" role="dialog" aria-modal="true" aria-live="polite">
                <svg class="gis-escena" viewBox="0 0 320 150" aria-hidden="true">
                    <g class="gis-escena__cancha" fill="none" stroke="rgba(255,255,255,.35)" stroke-width="1.5">
                        <rect pathLength="1" x="20" y="12" width="280" height="126" rx="6"/>
                        <path pathLength="1" d="M160 12V138"/><circle pathLength="1" cx="160" cy="75" r="22"/>
                        <path pathLength="1" d="M20 45H62V105H20M300 45H258V105H300"/>
                    </g>
                    <g class="gis-escena__radar" fill="none" stroke="#34d399">
                        <circle cx="160" cy="75" r="10"/><circle cx="160" cy="75" r="10"/><circle cx="160" cy="75" r="10"/>
                    </g>
                    <path class="gis-escena__ruta" fill="none" d="M40 118C90 40 130 120 160 75S240 20 282 52"/>
                    <g class="gis-escena__balon"><circle r="9" fill="#fff"/><path d="M0-4 3.8-1.2 2.3 3.2H-2.3L-3.8-1.2Z" fill="#11261f"/></g>
                </svg>
                <h3 class="gis-proceso__titulo">Actualizando análisis espacial</h3>
                <p class="gis-proceso__sub">Estamos recalculando las zonas de influencia de las canchas de Sabaneta.</p>
                <ol class="gis-pasos">${pasos.map((p, i) => `<li data-i="${i}"><span class="gis-pasos__ico"></span><span>${p}</span></li>`).join('')}</ol>
                <div class="gis-barra"><span></span></div>
                <div class="gis-resultado" hidden></div>
            </div>`;
        document.body.appendChild(ov);

        const items = [...ov.querySelectorAll('.gis-pasos li')];
        const barra = ov.querySelector('.gis-barra span');
        const titulo = ov.querySelector('.gis-proceso__titulo');
        const sub = ov.querySelector('.gis-proceso__sub');
        const res = ov.querySelector('.gis-resultado');
        const cerrar = () => { ov.classList.add('gis-proceso--sale'); setTimeout(() => ov.remove(), 260); };

        return {
            paso: (i) => {
                items.forEach((li, k) => {
                    li.classList.toggle('is-done', k < i);
                    li.classList.toggle('is-active', k === i);
                });
                barra.style.width = `${Math.round(((i + .4) / pasos.length) * 100)}%`;
            },
            ok: (r, alVer) => {
                items.forEach(li => { li.classList.remove('is-active'); li.classList.add('is-done'); });
                barra.style.width = '100%';
                ov.classList.add('gis-proceso--ok');
                titulo.textContent = '¡Análisis actualizado!';
                sub.textContent = 'Las capas ya están publicadas y el mapa muestra los datos más recientes.';
                const tarjetas = [
                    ['Canchas analizadas', r.canchas, 'total'],
                    ['Alta inversión', r.alta, 'alta'],
                    ['Mantenimiento', r.mantenimiento, 'media'],
                    ['Zona tranquila', r.tranquila, 'baja']
                ];
                res.innerHTML = `<div class="gis-kpis">${tarjetas.map(([l, v, c], i) =>
                    `<div class="gis-kpi gis-kpi--${c}" style="--d:${i * 90}ms"><b data-n="${v}">0</b><span>${l}</span></div>`).join('')}</div>
                    <div class="gis-resultado__acciones">
                        <button type="button" class="btn btn--ghost" data-a="cerrar">Seguir en el panel</button>
                        <button type="button" class="btn btn--primary" data-a="mapa">Ver en el mapa</button>
                    </div>`;
                res.hidden = false;
                res.querySelectorAll('b[data-n]').forEach(b => {
                    const fin = +b.dataset.n; const t0 = performance.now();
                    const tick = (t) => {
                        const p = Math.min((t - t0) / 700, 1);
                        b.textContent = Math.round(fin * (1 - Math.pow(1 - p, 3)));
                        if (p < 1) requestAnimationFrame(tick);
                    };
                    requestAnimationFrame(tick);
                });
                res.addEventListener('click', (e) => {
                    const a = e.target.closest('[data-a]');
                    if (!a) return;
                    cerrar();
                    if (a.dataset.a === 'mapa') alVer && alVer();
                });
            },
            error: (msg) => {
                ov.classList.add('gis-proceso--error');
                titulo.textContent = 'No se pudo actualizar';
                sub.textContent = msg;
                res.innerHTML = `<div class="gis-resultado__acciones"><button type="button" class="btn btn--primary" data-a="cerrar">Entendido</button></div>`;
                res.hidden = false;
                res.addEventListener('click', (e) => { if (e.target.closest('[data-a]')) cerrar(); });
            }
        };
    }

    async recalcularAnalisisGdal() {
        const btn = document.getElementById('btn-recalcular-gdal');
        if (btn) btn.disabled = true;
        const ui = this.mostrarProcesoGis();
        const pausa = (ms) => new Promise(r => setTimeout(r, ms));

        try {
            // 1-3. Calcular desde la base de datos y publicar en Storage
            const resumen = await this.generarYSubirAnalisisGis((i) => ui.paso(i));
            await pausa(350);

            // 4. Refrescar capas del mapa con los datos nuevos
            ui.paso(3);
            if (this.capaGdalGroup) { this.map.removeLayer(this.capaGdalGroup); this.capaGdalGroup = null; }
            if (this.capaZonasInfluencia) {
                this.map.removeLayer(this.capaZonasInfluencia);
                try { this.layerControl && this.layerControl.removeLayer(this.capaZonasInfluencia); } catch (e) { }
                this.capaZonasInfluencia = null;
            }
            await this.cargarZonasInfluenciaAdmin();
            await this.cargarCapaGdalProcesada();
            await this.cargarAlertasDesgasteAdmin();
            await pausa(450);

            const ahora = new Date().toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' });
            const sello = document.getElementById('gis-ultima-act');
            if (sello) sello.textContent = `Última actualización: ${ahora}`;

            ui.ok(resumen, () => {
                const cerrarAdmin = document.getElementById('admin-modal-cerrar');
                if (cerrarAdmin) cerrarAdmin.click();
                if (this.map) document.getElementById('mapa')?.scrollIntoView({ behavior: 'smooth' });
            });
        } catch (err) {
            console.error("Error al recalcular análisis GIS:", err);
            ui.error(err.message || String(err));
        } finally {
            if (btn) btn.disabled = false;
        }
    }

    initSelectModernoBarrio() {
        const trigger = document.getElementById('select-barrio-trigger');
        const opcionesContainer = document.getElementById('select-barrio-opciones');
        if (!trigger || !opcionesContainer) return;

        trigger.addEventListener('click', (e) => {
            e.stopPropagation();
            opcionesContainer.classList.toggle('open');
        });
        trigger.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                trigger.click();
            }
        });

        document.addEventListener('click', () => {
            opcionesContainer.classList.remove('open');
        });
    }

    // --- Menú hamburguesa de la cabecera (tableta y móvil) ---
    initMenuMovil() {
        const header = document.querySelector('.app-header');
        const boton = document.getElementById('btn-menu');
        const nav = document.getElementById('main-nav');
        if (!header || !boton || !nav) return;

        const fijar = (abrir) => {
            header.classList.toggle('is-menu-open', abrir);
            boton.setAttribute('aria-expanded', String(abrir));
            boton.setAttribute('aria-label', abrir ? 'Cerrar menú' : 'Abrir menú');
        };

        boton.addEventListener('click', (e) => {
            e.stopPropagation();
            fijar(!header.classList.contains('is-menu-open'));
        });

        // Al elegir una opción el menú se cierra (también "Capas GIS", que abre el panel de capas)
        nav.querySelectorAll('.nav-link').forEach(enlace => {
            enlace.addEventListener('click', () => fijar(false));
        });

        document.addEventListener('click', (e) => {
            if (!e.target.closest('.app-header')) fijar(false);
        });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') fijar(false);
        });

        // Si la pantalla pasa a escritorio, el menú vuelve a su estado normal
        const mq = window.matchMedia('(min-width: 901px)');
        const alCambiar = (e) => { if (e.matches) fijar(false); };
        if (mq.addEventListener) mq.addEventListener('change', alCambiar);
        else if (mq.addListener) mq.addListener(alCambiar);
    }

        // --- Decoración navideña (gorro, copo y nieve) ---
    // Para quitarla en enero: pon NAVIDAD_ACTIVA en false (o borra el <link> del CSS)
    initNavidad() {
        iniciarDecoracionNavidad();
    }

    // --- Paneles flotantes del mapa (filtros y capas) ---
    initPanelesFlotantes() {
        const panelFiltros = document.getElementById('panel-filtros');
        const btnFiltros = document.getElementById('btn-toggle-filtros');
        const panelCapas = document.getElementById('panel-capas');
        const btnCapas = document.getElementById('btn-toggle-capas');
        if (!panelFiltros || !btnFiltros || !panelCapas || !btnCapas) return;

        const pares = [[panelFiltros, btnFiltros], [panelCapas, btnCapas]];
        const fijar = (panel, boton, abrir) => {
            panel.classList.toggle('oculto', !abrir);
            boton.setAttribute('aria-expanded', String(abrir));
        };
        const cerrarTodos = () => pares.forEach(([p, b]) => fijar(p, b, false));
        const abrirSolo = (panel, boton) => {
            const abrir = panel.classList.contains('oculto');
            cerrarTodos();
            if (abrir) fijar(panel, boton, true);
        };

        btnFiltros.addEventListener('click', () => abrirSolo(panelFiltros, btnFiltros));
        btnCapas.addEventListener('click', () => abrirSolo(panelCapas, btnCapas));

        document.addEventListener('click', (e) => {
            if (!e.target.closest('#panel-filtros, #btn-toggle-filtros, #panel-capas, #btn-toggle-capas')) {
                cerrarTodos();
            }
        });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') cerrarTodos();
        });

        // Enlaces "Capas GIS": llevan al mapa y abren el panel de capas
        document.querySelectorAll('[data-open="capas"]').forEach(enlace => {
            enlace.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.irAlMapa();
                cerrarTodos();
                fijar(panelCapas, btnCapas, true);
            });
        });

        const btnLimpiar = document.getElementById('btn-limpiar-filtros');
        if (btnLimpiar) btnLimpiar.addEventListener('click', () => this.limpiarFiltros());

        // Resaltar en el menú la sección que se está viendo
        const secciones = ['mapa', 'canchas', 'eventos', 'app-footer'].map(id => document.getElementById(id)).filter(Boolean);
        const enlaces = document.querySelectorAll('.main-nav .nav-link[data-section]');
        const marcarSeccion = () => {
            const y = window.scrollY + 140;
            let actual = secciones[0]?.id;
            secciones.forEach(s => { if (s.offsetTop <= y) actual = s.id; });
            if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4) actual = 'app-footer';
            enlaces.forEach(a => a.classList.toggle('active', a.dataset.section === actual));
        };
        window.addEventListener('scroll', marcarSeccion, { passive: true });
        marcarSeccion();

        this.actualizarContadorFiltros();
    }

    actualizarContadorFiltros() {
        const badge = document.getElementById('filtros-activos-badge');
        if (!badge) return;
        const marcado = (id) => document.getElementById(id)?.checked ? 1 : 0;
        const activos =
            (this.barrioSeleccionadoValor ? 1 : 0) +
            (document.getElementById('select-orden-estrellas')?.value ? 1 : 0) +
            ['filtro-favoritos', 'filtro-retos', 'filtro-recreativos', 'filtro-faltan-jugadores', 'filtro-torneos', 'filtro-modo-espectador']
                .reduce((suma, id) => suma + marcado(id), 0);
        badge.textContent = activos;
        badge.classList.toggle('oculto', activos === 0);
    }

    limpiarFiltros() {
        ['filtro-favoritos', 'filtro-retos', 'filtro-recreativos', 'filtro-faltan-jugadores', 'filtro-torneos', 'filtro-modo-espectador']
            .forEach(id => { const chk = document.getElementById(id); if (chk) chk.checked = false; });

        const orden = document.getElementById('select-orden-estrellas');
        if (orden) orden.value = '';
        const buscador = document.getElementById('buscador-canchas');
        if (buscador) buscador.value = '';

        this.barrioSeleccionadoValor = '';
        const textoBarrio = document.getElementById('select-barrio-texto');
        if (textoBarrio) textoBarrio.textContent = 'Todos los barrios';

        this.aplicarFiltrosGlobales();
    }

    initOrdenEstrellas() {
        const selectOrden = document.getElementById('select-orden-estrellas');
        if (selectOrden) {
            selectOrden.addEventListener('change', () => this.aplicarFiltrosGlobalesDebounced());
        }
    }

    poblarFiltrosDinamicos(data) {
        const opcionesContainer = document.getElementById('select-barrio-opciones');
        const textoSeleccionado = document.getElementById('select-barrio-texto');
        if (!opcionesContainer) return;

        const mapaBarrios = new Map();
        data.forEach(c => {
            const idBarrio = c.barrio_id;
            const nombreBarrio = c.barrio;
            if (idBarrio && nombreBarrio) {
                mapaBarrios.set(idBarrio, nombreBarrio);
            }
        });

        opcionesContainer.innerHTML = `<div class="custom-option" data-value="">Todos los barrios</div>`;
        const barriosOrdenados = Array.from(mapaBarrios.entries()).sort((a, b) => a[1].localeCompare(b[1]));

        barriosOrdenados.forEach(([id, nombre]) => {
            const div = document.createElement('div');
            div.className = 'custom-option';
            div.setAttribute('data-value', id);
            div.textContent = nombre;
            opcionesContainer.appendChild(div);
        });

        opcionesContainer.querySelectorAll('.custom-option').forEach(opt => {
            opt.addEventListener('click', (e) => {
                const val = e.target.getAttribute('data-value');
                const text = e.target.textContent;

                this.barrioSeleccionadoValor = val;
                if (textoSeleccionado) textoSeleccionado.textContent = text;
                opcionesContainer.classList.remove('open');

                this.aplicarFiltrosGlobalesDebounced();
            });
        });
    }

    initBuscador() {
        const input = document.getElementById('buscador-canchas');
        if (!input) return;

        // 1. Crear el contenedor de sugerencias justo debajo de la barra de búsqueda
        const searchbar = input.closest('.searchbar') || input.parentElement;
        searchbar.style.position = 'relative';

        let listaSugerencias = document.getElementById('sugerencias-buscador');
        if (!listaSugerencias) {
            listaSugerencias = document.createElement('ul');
            listaSugerencias.id = 'sugerencias-buscador';
            listaSugerencias.className = 'search-dropdown oculto';
            searchbar.appendChild(listaSugerencias);
        }

        const renderizarSugerencias = (texto) => {
            const query = texto.trim().toLowerCase();
            listaSugerencias.innerHTML = '';

            if (!query) {
                listaSugerencias.classList.add('oculto');
                return;
            }

            const coincidencias = this.datosCanchas
                .filter(c => {
                    const nombre = (c.nombre || '').toLowerCase();
                    const barrio = (c.barrio || '').toLowerCase();
                    return nombre.includes(query) || barrio.includes(query);
                })
                .slice(0, 6); // Mostrar máximo 6 resultados

            if (coincidencias.length === 0) {
                listaSugerencias.innerHTML = `<li class="search-dropdown__empty">No se encontraron canchas para "${this.escaparHtml(texto)}"</li>`;
                listaSugerencias.classList.remove('oculto');
                return;
            }

            coincidencias.forEach(cancha => {
                const sup = this.infoSuperficie(cancha.surface);
                const li = document.createElement('li');
                li.className = 'search-dropdown__item';
                li.innerHTML = `
                <div class="search-dropdown__info">
                    <strong>${this.escaparHtml(cancha.nombre || 'Cancha de fútbol')}</strong>
                    <small>${this.escaparHtml(cancha.barrio || 'Sin barrio')}</small>
                </div>
                <span class="search-dropdown__tag" style="--dot:${sup.color}">${this.escaparHtml(sup.label)}</span>
            `;

                // Al hacer clic: rellenar input, ocultar menú y volar a la cancha en el mapa
                li.addEventListener('click', (e) => {
                    e.stopPropagation();
                    input.value = cancha.nombre || '';
                    listaSugerencias.classList.add('oculto');
                    this.aplicarFiltrosGlobales();
                    this.enfocarCancha(cancha, true);
                });

                listaSugerencias.appendChild(li);
            });

            listaSugerencias.classList.remove('oculto');
        };

        // 2. Escuchar escritura y foco en el buscador
        input.addEventListener('input', (e) => {
            renderizarSugerencias(e.target.value);
            this.aplicarFiltrosGlobalesDebounced();
        });

        input.addEventListener('focus', (e) => {
            if (e.target.value.trim() !== '') {
                renderizarSugerencias(e.target.value);
            }
        });

        // 3. Cerrar desplegable al hacer clic fuera o presionar Escape
        document.addEventListener('click', (e) => {
            if (!searchbar.contains(e.target)) {
                listaSugerencias.classList.add('oculto');
            }
        });

        input.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                listaSugerencias.classList.add('oculto');
            }
        });
    }

    initFiltrosAvanzados() {
        const checkboxFav = document.getElementById('filtro-favoritos');
        if (checkboxFav) {
            checkboxFav.addEventListener('change', () => this.aplicarFiltrosGlobalesDebounced());
        }
    }

    initFiltrosEventosSidebar() {
        ['filtro-retos', 'filtro-recreativos', 'filtro-torneos', 'filtro-modo-espectador', 'filtro-faltan-jugadores'].forEach(id => {
            const chk = document.getElementById(id);
            if (chk) {
                chk.addEventListener('change', () => this.aplicarFiltrosGlobalesDebounced());
            }
        });
    }

    esEventoActivo(ev) {
        const ahora = new Date();
        if (ev.tipo_evento === 'Torneo' && ev.fecha_fin) {
            const fechaFin = new Date(ev.fecha_fin + 'T23:59:59');
            return fechaFin >= ahora;
        } else if (ev.fecha_hora) {
            const fechaHora = new Date(ev.fecha_hora);
            return fechaHora >= ahora;
        }
        return true;
    }

    async cargarEventosGlobales() {
        const { data, error } = await this.supabase.from('eventos').select('*');
        if (!error && data) {
            this.datosEventos = data.filter(ev => this.esEventoActivo(ev));
            this.renderizarListaEventosGlobal(this.datosEventos);
        }
    }

    initBuscadorEventosGlobal() {
        const input = document.getElementById('buscador-eventos');
        if (!input) return;
        input.addEventListener('input', () => {
            const texto = input.value.toLowerCase();
            const filtrados = this.datosEventos.filter(ev => {
                const tipo = (ev.tipo_evento || '').toLowerCase();
                const titulo = (ev.titulo || '').toLowerCase();
                const contacto = (ev.contacto || '').toLowerCase();
                const desc = (ev.descripcion || '').toLowerCase();
                return tipo.includes(texto) || titulo.includes(texto) || contacto.includes(texto) || desc.includes(texto);
            });
            this.renderizarListaEventosGlobal(filtrados);
        });
    }

    renderizarListaEventosGlobal(eventos) {
        const contenedor = document.getElementById('contenedor-lista-eventos-global');
        const contador = document.getElementById('contador-total-eventos');
        if (!contenedor) return;
        if (contador) contador.innerText = (eventos || []).length;
        this.construirTarjetasEventos(contenedor, eventos, 'No hay eventos o torneos que coincidan con la búsqueda.');
    }

    aplicarFiltrosGlobales() {
        this.actualizarContadorFiltros();
        const texto = document.getElementById('buscador-canchas')?.value.toLowerCase() || '';
        const barrioIdSeleccionado = this.barrioSeleccionadoValor;
        const soloFavs = document.getElementById('filtro-favoritos')?.checked || false;
        const ordenEstrellas = document.getElementById('select-orden-estrellas')?.value || '';

        const verRetos = document.getElementById('filtro-retos')?.checked || false;
        const verRecreativos = document.getElementById('filtro-recreativos')?.checked || false;
        const verTorneos = document.getElementById('filtro-torneos')?.checked || false;
        const verFaltanJugadores = document.getElementById('filtro-faltan-jugadores')?.checked || false;
        const modoEspectador = document.getElementById('filtro-modo-espectador')?.checked || false;

        if (modoEspectador) {
            this.renderizarListaEventosEspectador(this.datosEventos);
            return;
        }

        let filtradas = this.datosCanchas.filter(c => {
            const nombre = (c.nombre || 'Cancha de fútbol').toLowerCase();
            const cumpleTexto = nombre.includes(texto);
            const idBarrioCancha = c.barrio_id;
            const cumpleBarrio = barrioIdSeleccionado ? (idBarrioCancha == barrioIdSeleccionado) : true;
            const cumpleFavs = soloFavs ? this.favoritos.includes(c.id) : true;

            let cumpleEventos = true;
            if (verRetos || verRecreativos || verTorneos || verFaltanJugadores) {
                const eventosDeCancha = this.datosEventos.filter(ev => ev.cancha_id === c.id);

                const tieneRetoActivo = verRetos && eventosDeCancha.some(ev => ev.tipo_evento === 'Reto / Apostado' && ev.necesita_rival);
                const tieneRecreativoActivo = verRecreativos && eventosDeCancha.some(ev => ev.tipo_evento === 'Partido Recreativo' && (ev.necesita_rival || ev.faltan_jugadores));
                const tieneTorneoActivo = verTorneos && eventosDeCancha.some(ev => ev.tipo_evento === 'Torneo');
                const tieneFaltanJugadoresActivo = verFaltanJugadores && eventosDeCancha.some(ev => ev.faltan_jugadores === true);

                cumpleEventos = tieneRetoActivo || tieneRecreativoActivo || tieneTorneoActivo || tieneFaltanJugadoresActivo;
            }

            return cumpleTexto && cumpleBarrio && cumpleFavs && cumpleEventos;
        });

        // --- ORDENAMIENTO POR ESTRELLAS ---
        if (ordenEstrellas === 'mayor') {
            filtradas.sort((a, b) => (b.promedio_estrellas || 0) - (a.promedio_estrellas || 0));
        } else if (ordenEstrellas === 'menor') {
            filtradas.sort((a, b) => (a.promedio_estrellas || 0) - (b.promedio_estrellas || 0));
        }

        this.renderizarListaCanchas(filtradas);
        this.actualizarCapasEnMapa(filtradas);
        this.actualizarEstadisticas(filtradas);
    }

    renderizarListaEventosEspectador(eventos) {
        const contenedor = document.getElementById('contenedor-lista-canchas');
        if (!contenedor) return;
        this.construirTarjetasEventos(contenedor, eventos, 'No hay eventos próximos en este momento.');
    }

    // Formatea fechas de eventos (acepta date o datetime)
    formatearFechaEvento(valor) {
        if (!valor) return '';
        // Las fechas sin hora (YYYY-MM-DD) se leen como locales para no restar un día por zona horaria
        const soloFecha = /^\d{4}-\d{2}-\d{2}$/.test(String(valor));
        const d = soloFecha ? new Date(String(valor) + 'T00:00:00') : new Date(valor);
        if (isNaN(d)) return '';
        const conHora = String(valor).includes('T') || String(valor).includes(':');
        const opts = { day: 'numeric', month: 'short' };
        let txt = d.toLocaleDateString('es-CO', opts).replace('.', '');
        if (conHora) txt += ' · ' + d.toLocaleTimeString('es-CO', { hour: 'numeric', minute: '2-digit' });
        return txt;
    }

    // Tarjetas de eventos con el mismo formato de las canchas
    construirTarjetasEventos(contenedor, eventos, textoVacio) {
        contenedor.innerHTML = '';
        if (!eventos || eventos.length === 0) {
            contenedor.innerHTML = `<p class="cargando-texto">${this.escaparHtml(textoVacio)}</p>`;
            return;
        }

        const tipos = {
            'Torneo': { clase: 'evt--torneo', icono: '#i-trophy', etiqueta: 'Torneo' },
            'Partido Recreativo': { clase: 'evt--recreativo', icono: '#i-users', etiqueta: 'Partido recreativo' },
            'Reto / Apostado': { clase: 'evt--reto', icono: '#i-target', etiqueta: 'Reto' }
        };

        const rejilla = document.createElement('div');
        rejilla.className = 'cards-canchas cards-eventos';

        eventos.forEach(ev => {
            const t = tipos[ev.tipo_evento] || { clase: 'evt--recreativo', icono: '#i-users', etiqueta: ev.tipo_evento || 'Evento' };
            const canchaObj = (this.datosCanchas || []).find(c => c.id == ev.cancha_id);
            const nombreCancha = this.escaparHtml(canchaObj?.nombre || 'Escenario deportivo');
            const barrio = this.escaparHtml(canchaObj?.barrio || '');
            const titulo = this.escaparHtml(ev.tipo_evento === 'Torneo' ? (ev.titulo || 'Torneo') : (ev.titulo || t.etiqueta));
            const esTorneo = ev.tipo_evento === 'Torneo';

            let cuando = '';
            if (esTorneo && ev.fecha_inicio) {
                cuando = this.formatearFechaEvento(ev.fecha_inicio);
                if (ev.fecha_fin && ev.fecha_fin !== ev.fecha_inicio) cuando += ' → ' + this.formatearFechaEvento(ev.fecha_fin);
            } else if (ev.fecha_hora) {
                cuando = this.formatearFechaEvento(ev.fecha_hora);
            }

            const chips = [];
            if (esTorneo) {
                if (ev.cupos_equipos) chips.push(`${Number(ev.cupos_equipos)} cupos`);
                if (ev.tiene_costo_inscripcion) chips.push(`Inscripción $${Number(ev.costo_inscripcion || 0).toLocaleString('es-CO')}`);
                else chips.push('Inscripción gratis');
                if (ev.tiene_premio) chips.push('🏆 Con premio' + (ev.valor_premio ? ': ' + ev.valor_premio : ''));
            } else {
                if (ev.formato_partido) chips.push(ev.formato_partido);
                if (ev.necesita_rival) chips.push('Busca rival');
                if (ev.faltan_jugadores) chips.push(`Faltan ${Number(ev.jugadores_faltantes || 0)} jugadores`);
                if (ev.tipo_evento === 'Reto / Apostado' && ev.monto_apuesta) chips.push(`Apuesta $${Number(ev.monto_apuesta).toLocaleString('es-CO')}`);
            }
            const chipsHtml = chips.map(x => `<span class="evt-chip">${this.escaparHtml(x)}</span>`).join('');

            const banner = ev.banner_url
                ? `<img src="${this.escaparHtml(ev.banner_url)}" alt="Banner de ${titulo}" loading="lazy" onerror="this.remove()">`
                : '';

            const card = document.createElement('article');
            card.className = `cancha-card evento-card ${t.clase}`;
            card.tabIndex = 0;
            card.innerHTML = `
                <div class="cancha-card__img">
                    <span class="cancha-card__cancha" aria-hidden="true"></span>
                    <span class="evento-card__icono" aria-hidden="true"><svg class="icon"><use href="${t.icono}"/></svg></span>
                    ${banner}
                    <span class="cancha-card__tag">${this.escaparHtml(t.etiqueta)}</span>
                    ${cuando ? `<span class="evento-card__fecha">${this.escaparHtml(cuando)}</span>` : ''}
                </div>
                <div class="cancha-card__cuerpo">
                    <span class="cancha-card__kicker">${barrio ? barrio : 'Sabaneta'}</span>
                    <h3 class="cancha-card__nombre">${titulo}</h3>
                    <p class="cancha-card__barrio"><svg class="icon"><use href="#i-pin"/></svg>${nombreCancha}</p>
                    ${ev.descripcion ? `<p class="evento-card__desc">${this.escaparHtml(ev.descripcion)}</p>` : ''}
                    ${chipsHtml ? `<div class="evt-chips">${chipsHtml}</div>` : ''}
                    <div class="cancha-card__meta"><span class="sup"><svg class="icon"><use href="#i-users"/></svg>&nbsp;${this.escaparHtml(ev.contacto || 'Sin contacto')}</span></div>
                    <div class="cancha-card__acciones">
                        <button type="button" class="btn btn--primary btn--sm" data-locate><svg class="icon"><use href="#i-pin"/></svg>Ver en el mapa</button>
                    </div>
                </div>`;

            card.addEventListener('click', () => this.enfocarCanchaPorId(ev.cancha_id, true));
            card.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && e.target === card) this.enfocarCanchaPorId(ev.cancha_id, true);
            });
            rejilla.appendChild(card);
        });

        contenedor.appendChild(rejilla);
    }

    // Celebración de gol al publicar un evento
    animacionGol(titulo = '¡GOOOL!', subtitulo = 'Tu evento ya está publicado') {
        document.getElementById('gol-overlay')?.remove();
        const ov = document.createElement('div');
        ov.id = 'gol-overlay';
        ov.setAttribute('role', 'status');
        const confeti = Array.from({ length: 28 }, (_, i) =>
            `<i style="--x:${(i * 37) % 100}%;--d:${(i % 7) * 0.12}s;--c:${['#f0c419', '#1f7a4d', '#ffffff', '#10b981'][i % 4]};--r:${(i * 53) % 360}deg"></i>`).join('');
        ov.innerHTML = `
            <div class="gol-escena">
                <div class="gol-confeti">${confeti}</div>
                <div class="gol-arco"><span class="gol-red"></span></div>
                <span class="gol-balon"></span>
                <span class="gol-sombra"></span>
                <h2 class="gol-titulo">${this.escaparHtml(titulo)}</h2>
                <p class="gol-sub">${this.escaparHtml(subtitulo)}</p>
            </div>`;
        document.body.appendChild(ov);
        const cerrar = () => { ov.classList.add('gol-salida'); setTimeout(() => ov.remove(), 400); };
        ov.addEventListener('click', cerrar);
        setTimeout(cerrar, 3200);
    }

    actualizarEstadisticas(canchasVisibles) {
        const panel = document.getElementById('panel-estadisticas');
        if (!panel) return;

        const total = canchasVisibles.length;
        const sinteticas = canchasVisibles.filter(c => ['artificial_turf', 'grass'].includes(c.surface)).length;
        const pavimentadas = canchasVisibles.filter(c => ['asphalt', 'concrete', 'paving_stones'].includes(c.surface)).length;
        const otras = total - sinteticas - pavimentadas;
        const favoritas = this.datosCanchas.filter(c => this.favoritos.includes(c.id)).length;

        const tramos = [
            { n: sinteticas, color: '#10b981', texto: 'Sintética o grama natural' },
            { n: pavimentadas, color: '#6366f1', texto: 'Pavimentada' },
            { n: otras, color: '#f59e0b', texto: 'Otra o sin dato' }
        ];
        const barra = total > 0
            ? tramos.filter(t => t.n > 0).map(t => `<span style="flex:${t.n};--c:${t.color}" title="${t.texto}: ${t.n}"></span>`).join('')
            : '<span style="flex:1;--c:#d8e1dc"></span>';
        const leyenda = tramos.map(t => `<li><i style="--c:${t.color}"></i>${t.texto}<b>${t.n}</b></li>`).join('');

        panel.innerHTML = `
            <div class="resumen__total"><b>${total}</b><span>${total === 1 ? 'cancha visible' : 'canchas visibles'}</span></div>
            <div class="resumen__detalle">
                <div class="resumen__barra" role="img" aria-label="Distribución de las canchas visibles por tipo de superficie">${barra}</div>
                <ul class="resumen__leyenda">${leyenda}<li class="resumen__fav"><svg class="icon"><use href="#i-star"/></svg>En tus favoritas<b>${favoritas}</b></li></ul>
            </div>
        `;
    }

    async cargarCanchas() {
        const [resCanchas, resBarrios, resCalificaciones] = await Promise.all([
            this.supabase.from('canchas').select('*'),
            this.supabase.from('barrios').select('id, nombre'),
            this.supabase.from('calificaciones_cancha').select('cancha_id, puntuacion')
        ]);

        if (resCanchas.error) {
            const contenedor = document.getElementById('contenedor-lista-canchas');
            if (contenedor) contenedor.innerHTML = '<p class="cargando-texto" style="color: #ef4444;">Error al cargar las canchas.</p>';
            return;
        }

        // Lista de barrios disponible para el formulario de administración
        this.listaBarrios = resBarrios.data || [];

        const mapaBarrios = new Map();
        if (resBarrios.data) {
            resBarrios.data.forEach(b => mapaBarrios.set(b.id, b.nombre));
        }

        // Calcular promedio de estrellas por cancha para habilitar el ordenamiento
        const mapaPromedios = new Map();
        if (resCalificaciones.data) {
            const acumulador = {};
            resCalificaciones.data.forEach(cal => {
                if (!acumulador[cal.cancha_id]) acumulador[cal.cancha_id] = { suma: 0, count: 0 };
                acumulador[cal.cancha_id].suma += cal.puntuacion;
                acumulador[cal.cancha_id].count += 1;
            });
            Object.keys(acumulador).forEach(canchaId => {
                const data = acumulador[canchaId];
                mapaPromedios.set(parseInt(canchaId), parseFloat((data.suma / data.count).toFixed(1)));
            });
        }

        this.datosCanchas = (resCanchas.data || []).map(c => ({
            ...c,
            barrio: mapaBarrios.get(c.barrio_id) || 'Sin barrio',
            promedio_estrellas: mapaPromedios.get(c.id) || 0.0
        }));

        const contadorEl = document.getElementById('contador-total');
        if (contadorEl) contadorEl.innerText = this.datosCanchas.length;

        this.poblarFiltrosDinamicos(this.datosCanchas);
        this.actualizarEstadisticas(this.datosCanchas);

        // Redibuja las capas limpiando las anteriores (evita polígonos duplicados tras editar o eliminar)
        this.actualizarCapasEnMapa(this.datosCanchas);
        this.renderizarListaCanchas(this.datosCanchas);

        // Si el panel de administración está abierto, mantiene su listado al día
        if (document.getElementById('admin-lista-canchas')) this.renderizarListaCanchasAdmin();

        // Los eventos pudieron dibujarse antes que las canchas: se refrescan para resolver nombres
        if (this.datosEventos && this.datosEventos.length) {
            const bus = document.getElementById('buscador-eventos');
            if (!bus || !bus.value.trim()) this.renderizarListaEventosGlobal(this.datosEventos);
        }

        setTimeout(() => this.map.invalidateSize(), 100);
    }

    // --- Utilidades de presentación ---
    escaparHtml(valor) {
        return String(valor ?? '').replace(/[&<>"']/g, (ch) => (
            { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
        ));
    }

    infoSuperficie(surface) {
        const tabla = {
            artificial_turf: { label: 'Sintética', color: '#10b981' },
            grass: { label: 'Grama natural', color: '#10b981' },
            asphalt: { label: 'Asfalto', color: '#6366f1' },
            concrete: { label: 'Concreto', color: '#6366f1' },
            paving_stones: { label: 'Adoquín', color: '#6366f1' }
        };
        return tabla[surface] || { label: surface ? String(surface) : 'Sin dato', color: '#f59e0b' };
    }

    irAlMapa() {
        const mapa = document.getElementById('mapa');
        if (mapa) mapa.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    // Lleva la vista al mapa, vuela hasta la cancha y (opcionalmente) abre su detalle
    enfocarCancha(cancha, abrirDetalle = true) {
        const coords = this.obtenerCoordenadasGeom(cancha?.geometry);
        if (!coords) {
            this.toast('⚠️ Esta cancha no tiene ubicación registrada en el mapa.');
            return;
        }
        this.irAlMapa();
        this.map.flyTo([coords.lat, coords.lng], 18, { duration: 1.2 });
        if (abrirDetalle) setTimeout(() => this.abrirModalCancha(cancha), 600);
    }

    // Busca la cancha en el momento del clic (no al dibujar la lista) para evitar datos desactualizados
    async enfocarCanchaPorId(id, abrirDetalle = true) {
        if (id === null || id === undefined || id === '') {
            this.toast('⚠️ Este evento no tiene una cancha asociada.');
            return;
        }
        try {
            if (!this.datosCanchas || this.datosCanchas.length === 0) await this.cargarCanchas();
        } catch (e) { console.error(e); }
        let cancha = (this.datosCanchas || []).find(c => c.id == id);
        if (!cancha) {
            // Una recarga por si la cancha se creó después de abrir el visor
            try { await this.cargarCanchas(); } catch (e) { console.error(e); }
            cancha = (this.datosCanchas || []).find(c => c.id == id);
        }
        if (!cancha) {
            this.toast('⚠️ La cancha asociada a este evento ya no existe en el visor.');
            return;
        }
        this.enfocarCancha(cancha, abrirDetalle);
    }

    // Miniatura del banner de un torneo (o ícono si no hay imagen)
    miniaturaBanner(ev, icono) {
        const url = ev && ev.banner_url ? this.escaparHtml(ev.banner_url) : '';
        const fallback = `<svg class="icon"><use href="${icono}"/></svg>`;
        if (!url) return fallback;
        return `<span class="banner-mini"><img src="${url}" alt="Banner del torneo" loading="lazy" onerror="this.parentNode.outerHTML='<svg class=&quot;icon&quot;><use href=&quot;${icono}&quot;/></svg>'"></span>`;
    }

    ordenarTabla(campo) {
        const actual = this.ordenTabla || { campo: null, dir: 1 };
        this.ordenTabla = actual.campo === campo ? { campo, dir: -actual.dir } : { campo, dir: 1 };
        this.renderizarListaCanchas(this.ultimaLista || []);
    }

    renderizarListaCanchas(canchas) {
        const contenedor = document.getElementById('contenedor-lista-canchas');
        if (!contenedor) return;
        this.ultimaLista = canchas;
        contenedor.innerHTML = '';

        if (canchas.length === 0) {
            contenedor.innerHTML = '<p class="cargando-texto">Ninguna cancha coincide con los filtros. Quita alguno desde el botón Filtros del mapa.</p>';
            return;
        }

        const rejilla = document.createElement('div');
        rejilla.className = 'cards-canchas';

        canchas.forEach((c, i) => {
            const esFav = this.favoritos.includes(c.id);
            const nombre = this.escaparHtml(c.nombre || 'Cancha de fútbol');
            const barrio = this.escaparHtml(c.barrio || 'Sin barrio');
            const sup = this.infoSuperficie(c.surface);
            const numero = String(i + 1).padStart(2, '0');
            const nEventos = (this.datosEventos || []).filter(ev => ev.cancha_id == c.id).length;
            const imagen = c.imagen_url ? `<img src="${this.escaparHtml(c.imagen_url)}" alt="Foto de ${nombre}" loading="lazy" onerror="this.remove()">` : '';
            const calificacion = c.promedio_estrellas > 0
                ? `<span class="nota"><svg class="icon"><use href="#i-star"/></svg><b>${Number(c.promedio_estrellas).toFixed(1)}</b></span>`
                : '<span class="nota nota--vacia">Sin calificar</span>';
            const insignia = nEventos > 0
                ? `<span class="cancha-card__evt"><svg class="icon"><use href="#i-trophy"/></svg>${nEventos} ${nEventos === 1 ? 'evento' : 'eventos'}</span>`
                : '';

            const card = document.createElement('article');
            card.className = 'cancha-card item-cancha-lista';
            card.tabIndex = 0;
            card.style.setProperty('--acento', sup.color);
            card.innerHTML = `
                <div class="cancha-card__img">
                    <span class="cancha-card__cancha" aria-hidden="true"></span>
                    ${imagen}
                    <span class="cancha-card__tag">${this.escaparHtml(sup.label)}</span>
                    <button type="button" class="cancha-card__fav" data-fav aria-pressed="${esFav}" aria-label="${esFav ? 'Quitar de favoritas' : 'Marcar como favorita'}" title="Favorita"><svg class="icon"><use href="#i-star"/></svg></button>
                </div>
                <div class="cancha-card__cuerpo">
                    <span class="cancha-card__kicker">${numero} / ${barrio}</span>
                    <h3 class="cancha-card__nombre">${nombre}</h3>
                    <p class="cancha-card__barrio"><svg class="icon"><use href="#i-pin"/></svg>${barrio}</p>
                    <div class="cancha-card__meta">
                        <span class="sup"><i style="--dot:${sup.color}"></i>${this.escaparHtml(sup.label)}</span>
                        ${calificacion}
                    </div>
                    ${insignia}
                    <div class="cancha-card__acciones">
                        <button type="button" class="btn btn--primary btn--sm" data-locate><svg class="icon"><use href="#i-pin"/></svg>Ver en el mapa</button>
                        <button type="button" class="btn btn--secondary btn--sm" data-ver>Detalles</button>
                    </div>
                </div>
            `;

            card.addEventListener('click', (e) => {
                if (e.target.closest('[data-fav]')) { this.toggleFavorito(c.id); return; }
                if (e.target.closest('[data-locate]')) { this.enfocarCancha(c, false); return; }
                this.enfocarCancha(c, true);
            });
            card.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && e.target === card) this.enfocarCancha(c, true);
            });
            rejilla.appendChild(card);
        });

        contenedor.appendChild(rejilla);
    }

    obtenerCoordenadasGeom(geom) {
        if (!geom) return null;
        let lat, lng;
        if (geom.type === 'Point') {
            [lng, lat] = geom.coordinates;
        } else if (geom.type === 'Polygon') {
            const coords = geom.coordinates[0];
            let sLat = 0, sLng = 0;
            coords.forEach(c => { sLng += c[0]; sLat += c[1]; });
            lng = sLng / coords.length;
            lat = sLat / coords.length;
        } else if (geom.type === 'MultiPolygon') {
            const coords = geom.coordinates[0][0];
            let sLat = 0, sLng = 0;
            coords.forEach(c => { sLng += c[0]; sLat += c[1]; });
            lng = sLng / coords.length;
            lat = sLat / coords.length;
        }
        return { lat, lng };
    }

    async enfocarAlertaYBuffer(canchaId, distanciaVia) {
        const canchaObj = this.datosCanchas.find(c => c.id == canchaId);
        if (!canchaObj) return;

        const coords = this.obtenerCoordenadasGeom(canchaObj.geometry);
        if (!coords) return;

        this.map.flyTo([coords.lat, coords.lng], 17, { duration: 1.2 });

        const radioBuffer = Math.max(parseFloat(distanciaVia) || 30, 30);
        this.mostrarBufferCancha(coords.lat, coords.lng, radioBuffer, 'Óptimo');
    }

    mostrarBufferCancha(lat, lng, distanciaMetros = 50, nivelAlerta = 'Óptimo') {
        if (this.capaBuffer) {
            this.map.removeLayer(this.capaBuffer);
        }

        let colorBuffer = '#10b981';
        if (nivelAlerta.includes('MODERADO')) colorBuffer = '#f59e0b';
        if (nivelAlerta.includes('CRÍTICO')) colorBuffer = '#ef4444';

        this.capaBuffer = L.circle([lat, lng], {
            radius: distanciaMetros,
            color: colorBuffer,
            fillColor: colorBuffer,
            fillOpacity: 0.25,
            weight: 2,
            dashArray: '5, 5'
        }).addTo(this.map);

        this.capaBuffer.bindPopup(`<b>🛡️ Zona de Influencia / Buffer GIS</b><br>Radio analizado: ${distanciaMetros} metros`);
    }

    dibujarCapas(datosCanchas) {
        const onEachFeature = (feature, layer) => {
            layer.on('click', () => this.abrirModalCancha(feature.properties));
        };

        const opciones = { weight: 2, fillOpacity: 0.5 };

        this.capaSinteticas = L.geoJSON(datosCanchas, {
            filter: (f) => ['artificial_turf', 'grass'].includes(f.properties.surface),
            style: { color: "#059669", fillColor: "#10b981", ...opciones },
            // Canchas tipo Point: no dibujar el marcador por defecto de Leaflet (el pin verde ya se dibuja aparte)
            pointToLayer: (f, latlng) => L.circleMarker(latlng, { radius: 0, opacity: 0, fillOpacity: 0, interactive: false }),
            onEachFeature
        }).addTo(this.map);

        this.capaPavimentadas = L.geoJSON(datosCanchas, {
            filter: (f) => ['asphalt', 'concrete', 'paving_stones'].includes(f.properties.surface),
            style: { color: "#4f46e5", fillColor: "#6366f1", ...opciones },
            pointToLayer: (f, latlng) => L.circleMarker(latlng, { radius: 0, opacity: 0, fillOpacity: 0, interactive: false }),
            onEachFeature
        }).addTo(this.map);

        this.capaOtras = L.geoJSON(datosCanchas, {
            filter: (f) => !f.properties.surface || !['artificial_turf', 'grass', 'asphalt', 'concrete', 'paving_stones'].includes(f.properties.surface),
            style: { color: "#d97706", fillColor: "#f59e0b", ...opciones },
            pointToLayer: (f, latlng) => L.circleMarker(latlng, { radius: 0, opacity: 0, fillOpacity: 0, interactive: false }),
            onEachFeature
        }).addTo(this.map);

        if (this.capaMarcadoresZoom) this.map.removeLayer(this.capaMarcadoresZoom);
        this.dibujarMarcadoresZoom(datosCanchas);

        const controlesCapas = {
            "⚽ Sintéticas / Grama": this.capaSinteticas,
            "🏀 Placas Pavimentadas": this.capaPavimentadas,
            "❓ Sin clasificar": this.capaOtras
        };

        if (!this.layerControl) {
            this.layerControl = L.control.layers(null, controlesCapas, { position: 'topright', collapsed: false }).addTo(this.map);
        }
    }

    dibujarMarcadoresZoom(datosCanchas) {
        this.capaMarcadoresZoom = L.layerGroup();

        datosCanchas.features.forEach(feature => {
            const props = feature.properties;
            const centro = this.obtenerCoordenadasGeom(feature.geometry);
            if (!centro) return;

            let colorSuperficie = "#f59e0b";
            if (['artificial_turf', 'grass'].includes(props.surface)) colorSuperficie = "#10b981";
            else if (['asphalt', 'concrete', 'paving_stones'].includes(props.surface)) colorSuperficie = "#6366f1";

            const pinIcon = L.divIcon({
                className: 'custom-pin-marker',
                html: `
                    <div style="
                        background-color: ${colorSuperficie};
                        width: 28px; height: 28px;
                        display: flex; align-items: center; justify-content: center;
                        border-radius: 50% 50% 50% 0;
                        transform: rotate(-45deg);
                        box-shadow: 0 3px 6px rgba(0,0,0,0.3);
                        border: 2px solid #ffffff;
                    ">
                        <div style="width: 8px; height: 8px; background: white; border-radius: 50%; transform: rotate(45deg);"></div>
                    </div>
                `,
                iconSize: [28, 28],
                iconAnchor: [14, 28],
                popupAnchor: [0, -30]
            });

            const marker = L.marker([centro.lat, centro.lng], { icon: pinIcon });

            marker.on('click', () => {
                this.map.flyTo([centro.lat, centro.lng], 18, { duration: 1.2 });
                setTimeout(() => this.abrirModalCancha(props), 600);
            });

            marker.bindPopup(`<b>${props.nombre || 'Cancha de fútbol'}</b><br>Superficie: ${props.surface || 'N/A'}`);
            this.capaMarcadoresZoom.addLayer(marker);
        });

        this.capaMarcadoresZoom.addTo(this.map);
    }

    actualizarCapasEnMapa(canchasFiltradas) {
        const featureCollection = {
            type: 'FeatureCollection',
            features: canchasFiltradas.map((row) => ({ type: 'Feature', properties: row, geometry: row.geometry }))
        };

        if (this.capaSinteticas) this.map.removeLayer(this.capaSinteticas);
        if (this.capaPavimentadas) this.map.removeLayer(this.capaPavimentadas);
        if (this.capaOtras) this.map.removeLayer(this.capaOtras);
        if (this.capaMarcadoresZoom) this.map.removeLayer(this.capaMarcadoresZoom);
        if (this.layerControl) this.map.removeControl(this.layerControl);

        this.layerControl = null;
        this.dibujarCapas(featureCollection);
    }

    async cargarLimiteSabaneta() {
        const { data, error } = await this.supabase
            .from('limite_sabaneta')
            .select('id, geom');

        if (error || !data || data.length === 0) return;

        this.geometriaSabaneta = data[0].geom;

        const featureCollection = {
            type: 'FeatureCollection',
            features: data.map(row => ({
                type: 'Feature',
                properties: { id: row.id },
                geometry: row.geom
            }))
        };

        this.capaLimite = L.geoJSON(featureCollection, {
            style: {
                color: '#14201a',
                weight: 2.5,
                dashArray: '8 6',
                fillOpacity: 0
            }
        }).addTo(this.map);

        this.capaLimite.bringToBack();

        // Enfoque inicial y restricción de movimiento al área de Sabaneta
        const limites = this.capaLimite.getBounds();
        this.map.fitBounds(limites, { padding: [30, 30] });
        this.map.setMaxBounds(limites.pad(0.6));
        this.map.setMinZoom(13);
    }

    async cargarEstacionesMetroSupabase() {
        const tablasMetro = [
            'estacion_metros',
            'estacion_itagui_metro',
            'estacion_envigado_metro',
            'estacion_sabaneta_metro'
        ];

        let todasLasEstaciones = [];

        for (const tabla of tablasMetro) {
            const { data, error } = await this.supabase.from(tabla).select('*');
            if (!error && data) {
                todasLasEstaciones = [...todasLasEstaciones, ...data];
            }
        }

        if (todasLasEstaciones.length === 0) return;

        const featureCollection = {
            type: 'FeatureCollection',
            features: todasLasEstaciones.map(row => ({
                type: 'Feature',
                properties: { name: row.name || row.ref || row.nombre || 'Estación de Metro' },
                geometry: row.geometry || row.geom
            }))
        };

        this.capaMetro = L.geoJSON(featureCollection, {
            pointToLayer: (feature, latlng) => {
                const metroIcon = L.divIcon({
                    className: 'custom-metro-pin',
                    html: `<div style="background: linear-gradient(135deg, #f97316, #ea580c); color: white; width: 34px; height: 34px; display: flex; align-items: center; justify-content: center; border-radius: 50%; font-weight: bold; font-size: 14px; box-shadow: 0 4px 12px rgba(249,115,22,0.6); border: 2.5px solid #ffffff;"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="16" height="16" x="4" y="3" rx="2"/><path d="M4 11h16M12 3v8M8 19l-2 3M18 22l-2-3M8 15h.01M16 15h.01"/></svg></div>`,
                    iconSize: [34, 34],
                    iconAnchor: [17, 17],
                    popupAnchor: [0, -18]
                });
                return L.marker(latlng, { icon: metroIcon });
            },
            onEachFeature: (feature, layer) => {
                layer.bindPopup(`<b>🚇 ${feature.properties.name}</b><br>Sistema Masivo de Transporte (Metro)`);
            }
        }).addTo(this.map);

        this.capaMetro.bringToFront();
        if (this.layerControl) this.layerControl.addOverlay(this.capaMetro, "🚇 Estaciones del Metro");
    }

    async cargarParaderosSabaneta() {
        const { data, error } = await this.supabase.from('paraderos_buses_sabaneta').select('*');
        if (error || !data || data.length === 0) return;

        this.datosParaderos = data;

        const featureCollection = {
            type: 'FeatureCollection',
            features: data.map(row => ({
                type: 'Feature',
                properties: {
                    name: row.name || row.ref || row.nombre || 'Paradero de Bus',
                    route_ref: row.route_ref || row.ref || row.bus || null
                },
                geometry: row.geometry || row.geom
            }))
        };

        this.capaParaderos = L.geoJSON(featureCollection, {
            pointToLayer: (feature, latlng) => {
                const busStopIcon = L.divIcon({
                    className: 'custom-bus-pin',
                    html: `<div style="background: #3b82f6; color: white; width: 26px; height: 26px; display: flex; align-items: center; justify-content: center; border-radius: 50%; font-size: 12px; box-shadow: 0 3px 6px rgba(59,130,246,0.5); border: 2px solid #ffffff;"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 6v6M15 6v6M2 12h19.6M18 18h3s.5-1.7.8-2.8c.1-.4.2-.8.2-1.2 0-.4-.1-.8-.2-1.2l-1.4-5C20.1 6.8 19.1 6 18 6H4a2 2 0 0 0-2 2v10h3"/><circle cx="7" cy="18" r="2"/><path d="M9 18h5"/><circle cx="16" cy="18" r="2"/></svg></div>`,
                    iconSize: [26, 26],
                    iconAnchor: [13, 13],
                    popupAnchor: [0, -14]
                });
                return L.marker(latlng, { icon: busStopIcon });
            },
            onEachFeature: (feature, layer) => {
                layer.bindPopup(`<b>🚏 Paradero:</b> ${feature.properties.name}`);
            }
        }).addTo(this.map);

        this.capaParaderos.bringToFront();
        if (this.layerControl) this.layerControl.addOverlay(this.capaParaderos, "🚏 Paraderos de Buses");
    }

    async cargarCapaGdalProcesada() {
        try {
            // Se agrega ?t= para evitar que el navegador use la versión en caché
            const urlCapaGdal = `https://vdltyryvmphxdcxjrgsf.supabase.co/storage/v1/object/public/evidencias/canchas_analisis_gdal.geojson?t=${new Date().getTime()}`;
            const res = await fetch(urlCapaGdal);
            if (!res.ok) return;
            const geojson = await res.json();

            if (this.capaGdalGroup) {
                this.map.removeLayer(this.capaGdalGroup);
            }

            this.capaGdalGroup = L.geoJSON(geojson, {
                pointToLayer: (feature, latlng) => {
                    return L.circleMarker(latlng, {
                        radius: 8,
                        fillColor: "#a855f7",
                        color: "#ffffff",
                        weight: 2,
                        fillOpacity: 0.9
                    });
                },
                onEachFeature: (feature, layer) => {
                    const props = feature.properties;
                    layer.bindPopup(`
                        <div style="font-size: 0.85rem; line-height: 1.4;">
                            <b style="color: #a855f7;">📊 Análisis GIS Avanzado (GDAL)</b><br>
                            <b>🏟️ ${props.nombre || 'Cancha'}</b><br>
                            ★ Estrellas Promedio: <b>${props.promedio_est || 0.0}</b> (${props.num_opiniones || 0} op.)<br>
                            🏆 Eventos Registrados: <b>${props.num_eventos || 0}</b><br>
                            ⚡ Índice de Uso: <span style="color: #38bdf8; font-weight: bold;">${props.indice_uso || 'N/A'}</span>
                        </div>
                    `);
                }
            }).addTo(this.map);

            const chkGdal = document.getElementById('toggle-gdal');
            if (chkGdal && !chkGdal.checked) {
                this.map.removeLayer(this.capaGdalGroup);
            }

            if (this.layerControl) {
                // Evita duplicar la capa en el control de capas de Leaflet
                try { this.layerControl.removeLayer(this.capaGdalGroup); } catch (e) { }
                this.layerControl.addOverlay(this.capaGdalGroup, "📊 Análisis GDAL (Backend)");
            }
        } catch (err) {
            console.error("Error al cargar la capa analítica GDAL:", err);
        }
    }

    async cargarZonasInfluenciaAdmin() {
        try {
            const urlZonas = `https://vdltyryvmphxdcxjrgsf.supabase.co/storage/v1/object/public/evidencias/zonas_influencia_admin.geojson?t=${new Date().getTime()}`;

            const res = await fetch(urlZonas);
            if (!res.ok) throw new Error("No se pudo descargar la capa de Zonas de Influencia");

            const geojson = await res.json();

            if (this.capaZonasInfluencia) {
                this.map.removeLayer(this.capaZonasInfluencia);
            }

            this.capaZonasInfluencia = L.layerGroup();

            geojson.features.forEach(feature => {
                const props = feature.properties;
                const prioridad = props.prioridad_inversion;

                const centro = this.obtenerCoordenadasGeom(feature.geometry);
                if (!centro) return;

                let colorBorde = "#1e3a8a";
                let colorFondo = "#3b82f6";

                if (prioridad === 'ALTA_INVERSION') {
                    colorBorde = "#7f1d1d";
                    colorFondo = "#dc2626";
                } else if (prioridad === 'MANTENIMIENTO') {
                    colorBorde = "#78350f";
                    colorFondo = "#f59e0b";
                }

                const circuloBuffer = L.circle([centro.lat, centro.lng], {
                    radius: 350,
                    color: colorBorde,
                    weight: 2,
                    fillColor: colorFondo,
                    fillOpacity: 0.45,
                    dashArray: ''
                });

                circuloBuffer.bindPopup(`
                    <div style="font-size: 0.85rem; line-height: 1.4;">
                        <b style="color: #f87171;">🚨 Zona de Influencia Administrativa (GDAL)</b><br>
                        <b>🏟️ ${props.nombre}</b><br>
                        🏆 Torneos Activos: <b>${props.total_eventos}</b><br>
                        🎯 Prioridad: <b>${props.prioridad_inversion.replace('_', ' ')}</b><br>
                        <span style="font-size: 0.7rem; color: #94a3b8;">*Buffer renderizado a 350m para visualización</span>
                    </div>
                `);

                this.capaZonasInfluencia.addLayer(circuloBuffer);
            });

            this.capaZonasInfluencia.addTo(this.map);

            if (this.layerControl) {
                try { this.layerControl.removeLayer(this.capaZonasInfluencia); } catch (e) { }
                this.layerControl.addOverlay(this.capaZonasInfluencia, "🎯 Zonas de Influencia (Buffers 350m)");
            }

        } catch (err) {
            console.error("Error cargando los buffers de GDAL:", err);
        }
    }

    initEnfoqueSabaneta() {
        const btnEnfoque = document.getElementById('btn-toggle-enfoque');
        if (!btnEnfoque) return;

        btnEnfoque.addEventListener('click', () => {
            this.modoEnfoqueActivo = !this.modoEnfoqueActivo;

            const textoEnfoque = document.getElementById('btn-enfoque-texto');
            btnEnfoque.classList.toggle('is-active', this.modoEnfoqueActivo);
            if (textoEnfoque) {
                textoEnfoque.textContent = this.modoEnfoqueActivo ? 'Ver mapa completo' : 'Enfocar Sabaneta';
            }
            this.aplicarEfectoEnfoque(this.modoEnfoqueActivo);
        });
    }

    aplicarEfectoEnfoque(activar) {
        if (!this.capaLimite || !this.geometriaSabaneta) return;

        if (activar) {
            this.map.fitBounds(this.capaLimite.getBounds(), { padding: [40, 40] });
            const geojsonMascara = this.crearGeoJSONMascaraInvertida(this.geometriaSabaneta);

            this.capaMascaraGroup = L.geoJSON(geojsonMascara, {
                style: {
                    color: 'transparent',
                    fillColor: '#0b0f19',
                    fillOpacity: 0.75,
                    interactive: false
                }
            }).addTo(this.map);

            this.capaLimite.bringToFront();
            if (this.capaVias && document.getElementById('toggle-vias')?.checked) {
                this.map.removeLayer(this.capaVias);
                this.capaVias.addTo(this.map);
            }
        } else {
            if (this.capaMascaraGroup) {
                this.map.removeLayer(this.capaMascaraGroup);
                this.capaMascaraGroup = null;
            }
        }
    }

    crearGeoJSONMascaraInvertida(geomSabaneta) {
        const worldOuterRing = [[-180, -90], [180, -90], [180, 90], [-180, 90], [-180, -90]];
        let rings = [worldOuterRing];

        if (geomSabaneta.type === 'Polygon') {
            rings.push(geomSabaneta.coordinates[0]);
        } else if (geomSabaneta.type === 'MultiPolygon') {
            geomSabaneta.coordinates.forEach(polyCoords => rings.push(polyCoords[0]));
        }

        return {
            type: "Feature",
            properties: {},
            geometry: { type: "Polygon", coordinates: rings }
        };
    }

    async cargarViasSabaneta() {
        const { data, error } = await this.supabase.from('vias_sabaneta').select('id, geometry');
        if (error || !data) return;

        const featureCollection = {
            type: 'FeatureCollection',
            features: data.map(row => ({
                type: 'Feature',
                properties: { id: row.id },
                geometry: row.geometry
            }))
        };

        this.capaVias = L.geoJSON(featureCollection, {
            style: { color: '#7d867f', weight: 1.2, opacity: 0.55 }
        }).addTo(this.map);

        this.capaVias.bringToFront();
    }

    initControlCapasUI() {
        const chkLimite = document.getElementById('toggle-limite');
        const chkVias = document.getElementById('toggle-vias');
        const chkMetro = document.getElementById('toggle-metro');
        const chkParaderos = document.getElementById('toggle-paraderos');
        const chkGdal = document.getElementById('toggle-gdal');

        if (chkLimite) {
            chkLimite.addEventListener('change', (e) => {
                if (this.capaLimite) {
                    if (e.target.checked) this.map.addLayer(this.capaLimite);
                    else this.map.removeLayer(this.capaLimite);
                }
            });
        }

        if (chkVias) {
            chkVias.addEventListener('change', (e) => {
                if (this.capaVias) {
                    if (e.target.checked) this.map.addLayer(this.capaVias);
                    else this.map.removeLayer(this.capaVias);
                }
            });
        }

        if (chkMetro) {
            chkMetro.addEventListener('change', (e) => {
                if (this.capaMetro) {
                    if (e.target.checked) this.map.addLayer(this.capaMetro);
                    else this.map.removeLayer(this.capaMetro);
                }
            });
        }

        if (chkParaderos) {
            chkParaderos.addEventListener('change', (e) => {
                if (this.capaParaderos) {
                    if (e.target.checked) this.map.addLayer(this.capaParaderos);
                    else this.map.removeLayer(this.capaParaderos);
                }
            });
        }

        if (chkGdal) {
            chkGdal.addEventListener('change', (e) => {
                if (this.capaGdalGroup) {
                    if (e.target.checked) this.map.addLayer(this.capaGdalGroup);
                    else this.map.removeLayer(this.capaGdalGroup);
                }
            });
        }
    }

    toggleFavorito(id) {
        if (this.favoritos.includes(id)) {
            this.favoritos = this.favoritos.filter(favId => favId !== id);
        } else {
            this.favoritos.push(id);
        }
        localStorage.setItem('canchas_favoritas', JSON.stringify(this.favoritos));
        this.aplicarFiltrosGlobalesDebounced();
    }

    toggleFavoritoActual() {
        if (this.canchaSeleccionadaId) {
            this.toggleFavorito(this.canchaSeleccionadaId);
            const btnFav = document.getElementById('btn-favorito-modal');
            const esFav = this.favoritos.includes(this.canchaSeleccionadaId);
            if (btnFav) btnFav.innerText = esFav ? '★ Quitar de Favoritos' : '☆ Marcar como Favorito';
        }
    }

    async abrirModalCancha(props) {
        this.canchaSeleccionadaId = props.id;
        const nombreBarrio = props.barrio || 'Sin barrio';

        document.getElementById('modal-titulo').innerText = props.nombre || 'Cancha de fútbol';
        document.getElementById('modal-detalle').innerText = `Superficie: ${this.infoSuperficie(props.surface).label} · Barrio: ${nombreBarrio}`;
        document.getElementById('modal-horario').innerText = props.horario ? `Horario: ${props.horario}` : 'Sin horario registrado';

        const btnFav = document.getElementById('btn-favorito-modal');
        if (btnFav) {
            const esFav = this.favoritos.includes(props.id);
            btnFav.innerText = esFav ? '★ Quitar de Favoritos' : '☆ Marcar como Favorito';
        }

        const imgElement = document.getElementById('modal-imagen');
        if (props.imagen_url) {
            imgElement.src = props.imagen_url;
            imgElement.style.display = 'block';
        } else {
            imgElement.style.display = 'none';
        }

        document.getElementById('seccion-eventos-hub').classList.add('oculto');
        const seccionOpcionesRuta = document.getElementById('seccion-opciones-ruta');
        if (seccionOpcionesRuta) seccionOpcionesRuta.classList.add('oculto');

        document.getElementById('mensaje-crear-evento').innerText = '';
        document.getElementById('form-crear-evento').reset();
        document.getElementById('form-crear-evento').classList.add('oculto');

        document.getElementById('modal-overlay').classList.remove('oculto');
        await this.cargarEvidencias(props.id);
        await this.cargarCalificacionesCancha(props.id);
    }

    trazarRutaACancha(perfil = 'driving') {
        const canchaActual = this.datosCanchas.find(c => c.id == this.canchaSeleccionadaId);
        if (!canchaActual) return;

        const destino = this.obtenerCoordenadasGeom(canchaActual.geometry);
        if (!destino) return;

        // Si el usuario elige vehículo, abrir directamente Google Maps (CarPlay / Android Auto / Móvil)
        if (perfil === 'driving') {
            const urlGoogleMaps = `https://www.google.com/maps/dir/?api=1&destination=${destino.lat},${destino.lng}&travelmode=driving&dir_action=navigate`;
            window.open(urlGoogleMaps, '_blank');
            document.getElementById('modal-overlay').classList.add('oculto');
            return;
        }

        // Si es a pie u otra opción, mantiene el comportamiento interno del visor con OSRM
        const modalOverlay = document.getElementById('modal-overlay');
        if (modalOverlay) modalOverlay.classList.add('oculto');

        const ejecutarTrazado = (origenLat, origenLng) => {
            this.trazarRuta(origenLat, origenLng, destino.lat, destino.lng, perfil, canchaActual.nombre || 'Cancha');
        };

        if (!navigator.geolocation) {
            ejecutarTrazado(6.1515, -75.6166);
            return;
        }

        navigator.geolocation.getCurrentPosition(
            (position) => ejecutarTrazado(position.coords.latitude, position.coords.longitude),
            () => ejecutarTrazado(6.1515, -75.6166),
            { enableHighAccuracy: true, timeout: 4000, maximumAge: 0 }
        );
    }

    trazarRuta(latOrigen, lngOrigen, latDestino, lngDestino, perfil = 'driving', nombreCancha = 'Cancha') {
        this.limpiarRuta();
        const url = `https://router.project-osrm.org/route/v1/${perfil}/${lngOrigen},${latOrigen};${lngDestino},${latDestino}?overview=full&geometries=geojson`;

        fetch(url)
            .then(res => res.json())
            .then(data => {
                if (data.routes && data.routes.length > 0) {
                    const route = data.routes[0];
                    const coords = route.geometry.coordinates.map(c => [c[1], c[0]]);

                    if (this.capaSinteticas) this.map.removeLayer(this.capaSinteticas);
                    if (this.capaPavimentadas) this.map.removeLayer(this.capaPavimentadas);
                    if (this.capaOtras) this.map.removeLayer(this.capaOtras);
                    if (this.capaMarcadoresZoom) this.map.removeLayer(this.capaMarcadoresZoom);

                    this.capaRuta = L.polyline(coords, {
                        color: perfil === 'driving' ? '#38bdf8' : '#34d399',
                        weight: 5,
                        opacity: 0.9,
                        lineJoin: 'round'
                    }).addTo(this.map);

                    const markerOrigen = L.marker([latOrigen, lngOrigen], {
                        icon: L.divIcon({
                            className: 'pin-origen',
                            html: `<div style="background: #059669; color: white; padding: 6px 14px; border-radius: 12px; font-weight: bold; font-size: 11px; border: 2px solid white; box-shadow: 0 3px 8px rgba(0,0,0,0.4); white-space: nowrap;">🟢 Inicio</div>`,
                            iconSize: null
                        })
                    }).addTo(this.map);

                    const markerDestino = L.marker([latDestino, lngDestino], {
                        icon: L.divIcon({
                            className: 'pin-destino',
                            html: `<div style="background: #dc2626; color: white; padding: 6px 14px; border-radius: 12px; font-weight: bold; font-size: 11px; border: 2px solid white; box-shadow: 0 3px 8px rgba(0,0,0,0.4); white-space: nowrap;">🏁 Destino: ${nombreCancha}</div>`,
                            iconSize: null
                        })
                    }).addTo(this.map);

                    this.marcadoresRuta.push(markerOrigen, markerDestino);

                    const km = route.distance / 1000;
                    const minutos = perfil === 'foot' ? Math.max(1, Math.round(km * 12.5)) : Math.max(1, Math.round(route.duration / 60));
                    const modoTexto = perfil === 'driving' ? '🚗 En vehículo' : '🚶 A pie';

                    this.mostrarPanelRuta(nombreCancha, modoTexto, minutos, km.toFixed(1));
                    this.map.fitBounds(this.capaRuta.getBounds(), { padding: [60, 60] });
                }
            })
            .catch(err => console.error("Error al trazar ruta:", err));
    }

    calcularDistanciaHaversine(lat1, lon1, lat2, lon2) {
        const R = 6371e3;
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLon = (lon2 - lon1) * Math.PI / 180;
        const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c;
    }

    encontrarParaderoMasCercano(lat, lng) {
        if (!this.datosParaderos || this.datosParaderos.length === 0) return null;
        let paraderoCercano = null;
        let menorDistancia = Infinity;

        this.datosParaderos.forEach(p => {
            const coords = this.obtenerCoordenadasGeom(p.geometry || p.geom);
            if (!coords) return;
            const distancia = this.calcularDistanciaHaversine(lat, lng, coords.lat, coords.lng);
            if (distancia < menorDistancia) {
                menorDistancia = distancia;
                paraderoCercano = { ...p, lat: coords.lat, lng: coords.lng, distancia };
            }
        });
        return paraderoCercano;
    }

    obtenerNombreBus(paradero, nombreBarrio) {
        if (paradero.route_ref && paradero.route_ref.trim() !== '') return `🚍 Ruta: ${paradero.route_ref}`;
        if (paradero.ref && paradero.ref.trim() !== '') return `🚍 Ruta: ${paradero.ref}`;

        const pName = (paradero.name || '').toLowerCase();
        if (pName.includes('vegas') || pName.includes('carrera 48')) return "🚍 Bus: Alimentador Metro Las Vegas (15-2)";
        if (pName.includes('carmelo') || pName.includes('antaño')) return "🚍 Bus: Alimentador El Carmelo (15-1)";
        if (pName.includes('maria') || pName.includes('auxiliadora')) return "🚍 Bus: Alimentador María Auxiliadora (15-3)";

        const barrioLower = nombreBarrio.toLowerCase();
        if (barrioLower.includes('carmelo')) return "🚍 Bus: Alimentador 15-1 (El Carmelo)";
        if (barrioLower.includes('restrepo') || barrioLower.includes('vegas')) return "🚍 Bus: Ruta Circular Las Vegas (Sabaneta)";
        if (barrioLower.includes('maria auxiliadora')) return "🚍 Bus: Alimentador 15-3 (María Auxiliadora)";

        return "🚍 Bus: Ruta Integrada Sabaneta - Estación La Estrella";
    }

    trazarRutaBusInteligente() {
        const canchaActual = this.datosCanchas.find(c => c.id == this.canchaSeleccionadaId);
        if (!canchaActual) return;
        const destino = this.obtenerCoordenadasGeom(canchaActual.geometry);
        if (!destino) return;

        const nombreBarrio = canchaActual.barrio || 'Sabaneta';
        document.getElementById('modal-overlay').classList.add('oculto');

        const ejecutarBus = (origenLat, origenLng) => {
            this.procesarRutaBusMultimodal(origenLat, origenLng, destino.lat, destino.lng, canchaActual.nombre || 'Cancha', nombreBarrio);
        };

        if (!navigator.geolocation) {
            ejecutarBus(6.1515, -75.6166);
            return;
        }

        navigator.geolocation.getCurrentPosition(
            (pos) => ejecutarBus(pos.coords.latitude, pos.coords.longitude),
            () => ejecutarBus(6.1515, -75.6166),
            { enableHighAccuracy: true, timeout: 4000 }
        );
    }

    procesarRutaBusMultimodal(latOrigen, lngOrigen, latDestino, lngDestino, nombreCancha, nombreBarrio) {
        this.limpiarRuta();
        const paraderoOrigen = this.encontrarParaderoMasCercano(latOrigen, lngOrigen);
        const paraderoDestino = this.encontrarParaderoMasCercano(latDestino, lngDestino);

        if (!paraderoOrigen || !paraderoDestino) return;

        const url = `https://router.project-osrm.org/route/v1/driving/${lngOrigen},${latOrigen};${paraderoOrigen.lng},${paraderoOrigen.lat};${paraderoDestino.lng},${paraderoDestino.lat};${lngDestino},${latDestino}?overview=full&geometries=geojson`;

        fetch(url)
            .then(res => res.json())
            .then(data => {
                if (data.routes && data.routes.length > 0) {
                    const route = data.routes[0];
                    const coords = route.geometry.coordinates.map(c => [c[1], c[0]]);

                    if (this.capaSinteticas) this.map.removeLayer(this.capaSinteticas);
                    if (this.capaPavimentadas) this.map.removeLayer(this.capaPavimentadas);
                    if (this.capaOtras) this.map.removeLayer(this.capaOtras);
                    if (this.capaMarcadoresZoom) this.map.removeLayer(this.capaMarcadoresZoom);

                    if (this.capaParaderos && this.map.hasLayer(this.capaParaderos)) {
                        this.map.removeLayer(this.capaParaderos);
                    }
                    const chkParaderos = document.getElementById('toggle-paraderos');
                    if (chkParaderos) chkParaderos.checked = false;

                    this.capaRuta = L.polyline(coords, {
                        color: '#f97316',
                        weight: 6,
                        dashArray: '10, 10',
                        opacity: 0.95,
                        lineJoin: 'round'
                    }).addTo(this.map);

                    const infoBusSugerido = this.obtenerNombreBus(paraderoOrigen, nombreBarrio);

                    const markerInicio = L.marker([latOrigen, lngOrigen], {
                        icon: L.divIcon({
                            className: 'pin-origen',
                            html: `<div style="background: #059669; color: white; padding: 5px 10px; border-radius: 10px; font-weight: bold; font-size: 11px; border: 2px solid white; box-shadow: 0 2px 6px rgba(0,0,0,0.3); white-space: nowrap;">🟢 Tu ubicación</div>`,
                            iconSize: null
                        })
                    }).addTo(this.map);

                    const markerParaderoSubida = L.marker([paraderoOrigen.lat, paraderoOrigen.lng], {
                        icon: L.divIcon({
                            className: 'pin-bus-subida',
                            html: `
                                <div style="background: #3b82f6; color: white; padding: 6px 12px; border-radius: 10px; font-weight: bold; font-size: 11px; border: 2px solid white; box-shadow: 0 3px 8px rgba(0,0,0,0.4); text-align: center; white-space: nowrap;">
                                    🚏 Abordar en: ${paraderoOrigen.name || 'Paradero'}
                                    <div style="font-size: 10px; background: #ea580c; color: white; padding: 2px 6px; border-radius: 4px; margin-top: 3px; font-weight: 700;">${infoBusSugerido}</div>
                                </div>
                            `,
                            iconSize: null
                        })
                    }).addTo(this.map);

                    const markerDestino = L.marker([latDestino, lngDestino], {
                        icon: L.divIcon({
                            className: 'pin-destino',
                            html: `<div style="background: #dc2626; color: white; padding: 5px 10px; border-radius: 10px; font-weight: bold; font-size: 11px; border: 2px solid white; box-shadow: 0 2px 6px rgba(0,0,0,0.3); white-space: nowrap;">🏁 Destino: ${nombreCancha}</div>`,
                            iconSize: null
                        })
                    }).addTo(this.map);

                    this.marcadoresRuta.push(markerInicio, markerParaderoSubida, markerDestino);

                    const km = (route.distance / 1000).toFixed(1);
                    const minutos = Math.max(1, Math.round(route.duration / 60));

                    this.mostrarPanelRuta(nombreCancha, `${infoBusSugerido} (${km} km)`, minutos, km);
                    this.map.fitBounds(this.capaRuta.getBounds(), { padding: [60, 60] });
                }
            })
            .catch(err => console.error("Error al calcular ruta de bus:", err));
    }

    mostrarPanelRuta(nombreCancha, modoTexto, minutos, km) {
        let panel = document.getElementById('panel-info-ruta');
        if (!panel) {
            panel = document.createElement('div');
            panel.id = 'panel-info-ruta';
            panel.className = 'panel-info-ruta';

            const mapaContenedor = document.getElementById('map');
            if (mapaContenedor) mapaContenedor.appendChild(panel);
            else document.body.appendChild(panel);
        }

        panel.innerHTML = `
            <div class="panel-ruta-info">
                <div class="panel-ruta-destino">🏁 ${nombreCancha}</div>
                <div class="panel-ruta-subtexto">${modoTexto}</div>
            </div>
            <div class="panel-ruta-metrics">
                <div class="panel-ruta-tiempo">⏱️ ~${minutos} min</div>
            </div>
            <button class="btn-cerrar-ruta" onclick="window.mapApp.limpiarRuta()" title="Cerrar ruta">&times;</button>
        `;

        panel.classList.remove('oculto');
    }

    limpiarRuta() {
        if (this.capaRuta) {
            this.map.removeLayer(this.capaRuta);
            this.capaRuta = null;
        }
        if (this.marcadoresRuta) {
            this.marcadoresRuta.forEach(m => this.map.removeLayer(m));
            this.marcadoresRuta = [];
        }
        const panel = document.getElementById('panel-info-ruta');
        if (panel) panel.classList.add('oculto');

        this.aplicarFiltrosGlobalesDebounced();
    }

    // --- LÓGICA DE EVENTOS ---
    async cargarEventosCancha(canchaId) {
        const contenedor = document.getElementById('lista-eventos-cancha');
        if (!contenedor) return;
        contenedor.innerHTML = '<p class="modal-subtexto">Buscando próximos encuentros...</p>';

        const { data, error } = await this.supabase
            .from('eventos')
            .select('*')
            .eq('cancha_id', canchaId)
            .order('created_at', { ascending: false });

        if (error || !data || data.length === 0) {
            contenedor.innerHTML = '<p class="modal-subtexto">No hay eventos o torneos activos en esta cancha.</p>';
            return;
        }

        const eventosActivos = data.filter(ev => this.esEventoActivo(ev));

        if (eventosActivos.length === 0) {
            contenedor.innerHTML = '<p class="modal-subtexto">Todos los eventos de esta cancha ya finalizaron.</p>';
            return;
        }

        contenedor.innerHTML = '';
        for (const ev of eventosActivos) {
            const { data: participantes } = await this.supabase
                .from('participantes_evento')
                .select('*')
                .eq('evento_id', ev.id);

            let totalEspectadores = 0;
            let totalJugadoresIndividuales = 0;
            let totalEquipos = 0;

            if (participantes) {
                participantes.forEach(p => {
                    if (p.tipo_asistencia === 'Espectador') totalEspectadores++;
                    else if (p.tipo_asistencia === 'Equipo Completo') totalEquipos++;
                    else if (p.tipo_asistencia === 'Jugador') totalJugadoresIndividuales++;
                });
            }

            const div = document.createElement('div');
            div.className = 'row-card row-card--block';

            let bannerHtml = ev.banner_url ? `<img src="${this.escaparHtml(ev.banner_url)}" alt="Banner Torneo" loading="lazy" onerror="this.remove()" style="width: 100%; height: 110px; object-fit: cover; border-radius: 6px; margin-bottom: 8px;" />` : '';
            let detalleContenido = '';
            let tituloMostrar = '';
            let botonesHTML = `<input type="text" id="contacto-inscripcion-${ev.id}" placeholder="Tu contacto / Teléfono" style="padding: 4px; font-size: 0.8rem; border-radius: 4px; border: 1px solid #475569; background: #1e293b; color: white; width: 130px;" />`;

            if (ev.tipo_evento === 'Torneo') {
                tituloMostrar = `🏆 ${ev.titulo || 'Torneo Barrial'}`;
                const cuposLibres = ev.cupos_equipos - totalEquipos;

                detalleContenido = `
                    <p style="font-size: 0.8rem; color: #cbd5e1; margin: 3px 0;">📋 Tipo: <b>${ev.tipo_inscripcion}</b> | Cupos libres: <b style="color: ${cuposLibres > 0 ? '#34d399' : '#ef4444'}">${Math.max(0, cuposLibres)}</b> de ${ev.cupos_equipos}</p>
                    ${ev.tiene_costo_inscripcion ? `<p style="font-size: 0.8rem; color: #fbbf24; margin: 3px 0;">💰 Inscripción: $${ev.costo_inscripcion}</p>` : ''}
                    ${ev.tiene_premio ? `<p style="font-size: 0.8rem; color: #34d399; margin: 3px 0;">🎁 Premio: ${ev.valor_premio}</p>` : ''}
                    <p style="font-size: 0.8rem; color: #94a3b8; margin: 3px 0;">📅 Del ${ev.fecha_inicio || 'N/A'} al ${ev.fecha_fin || 'N/A'}</p>
                `;

                if (cuposLibres > 0) {
                    botonesHTML += `<button onclick="window.mapApp.inscribirseEvento(${ev.id}, 'Equipo Completo')" style="background: #2563eb; color: white; border: none; padding: 4px 8px; border-radius: 4px; font-size: 0.75rem; cursor: pointer;">Inscribir Equipo</button>`;
                } else {
                    botonesHTML += `<span style="font-size: 0.75rem; color: #ef4444; font-weight: bold; margin: 0 5px; padding: 4px;">Torneo Lleno 🚫</span>`;
                }
            } else {
                tituloMostrar = `⚽ ${ev.tipo_evento}`;
                let textoRival = '';

                if (ev.necesita_rival) {
                    if (totalEquipos === 0) {
                        textoRival = `<p style="font-size: 0.8rem; color: #38bdf8; margin: 3px 0;">⚔️ Necesita rival (${ev.formato_partido || 'Libre'})</p>`;
                        botonesHTML += `<button onclick="window.mapApp.inscribirseEvento(${ev.id}, 'Equipo Completo')" style="background: #d97706; color: white; border: none; padding: 4px 8px; border-radius: 4px; font-size: 0.75rem; cursor: pointer;">Soy Equipo Rival</button>`;
                    } else {
                        textoRival = `<p style="font-size: 0.8rem; color: #ef4444; margin: 3px 0; text-decoration: line-through;">⚔️ Necesita rival (¡Rival Encontrado!)</p>`;
                    }
                }

                let textoFaltantes = '';
                if (ev.faltan_jugadores) {
                    const faltantesRestantes = ev.jugadores_faltantes - totalJugadoresIndividuales;
                    if (faltantesRestantes > 0) {
                        textoFaltantes = `<p style="font-size: 0.8rem; color: #fbbf24; margin: 3px 0;">👤 Faltan jugadores: <b>${faltantesRestantes}</b></p>`;
                        botonesHTML += `<button onclick="window.mapApp.inscribirseEvento(${ev.id}, 'Jugador')" style="background: #2563eb; color: white; border: none; padding: 4px 8px; border-radius: 4px; font-size: 0.75rem; cursor: pointer;">Unirme a Jugar</button>`;
                    } else {
                        textoFaltantes = `<p style="font-size: 0.8rem; color: #ef4444; margin: 3px 0;">👤 Faltan jugadores: <b>¡Cupos Llenos!</b></p>`;
                    }
                }

                detalleContenido = `
                    ${textoRival}
                    ${textoFaltantes}
                    ${ev.tipo_evento === 'Reto / Apostado' && ev.monto_apuesta > 0 ? `<p style="font-size: 0.8rem; color: #f87171; margin: 3px 0;">💵 Apuesta: $${ev.monto_apuesta}</p>` : ''}
                    ${ev.fecha_hora ? `<p style="font-size: 0.8rem; color: #94a3b8; margin: 3px 0;">📅 Fecha: ${new Date(ev.fecha_hora).toLocaleString()}</p>` : ''}
                `;
            }

            botonesHTML += `<button onclick="window.mapApp.inscribirseEvento(${ev.id}, 'Espectador')" style="background: #475569; color: white; border: none; padding: 4px 8px; border-radius: 4px; font-size: 0.75rem; cursor: pointer;">Ver</button>`;

            div.innerHTML = `
                ${bannerHtml}
                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <strong style="color: #38bdf8; font-size: 0.95rem;">${tituloMostrar}</strong>
                    <span style="font-size: 0.75rem; background: #334155; padding: 2px 6px; border-radius: 4px; color: #cbd5e1;">📞 ${ev.contacto}</span>
                </div>
                ${detalleContenido}
                <p style="font-size: 0.8rem; color: #cbd5e1; margin: 4px 0;">💬 ${ev.descripcion || 'Sin descripción'}</p>
                <p style="font-size: 0.75rem; color: #34d399; margin: 6px 0;">
                    ${ev.tipo_evento === 'Torneo' ? `🛡️ Equipos inscritos: ${totalEquipos}` : `👥 Jugadores unidos: ${totalJugadoresIndividuales}${ev.necesita_rival ? ` | Equipos: ${totalEquipos}` : ''}`} 
                    | 👀 Espectadores: ${totalEspectadores}
                </p>
                
                <div style="display: flex; gap: 6px; margin-top: 8px; align-items: center; flex-wrap: wrap;">
                    ${botonesHTML}
                </div>
            `;
            contenedor.appendChild(div);
        }
    }

    async guardarNuevoEvento() {
        if (!this.canchaSeleccionadaId) return;

        const tipoEvento = document.getElementById('evento-tipo').value;
        const contacto = document.getElementById('evento-contacto').value.trim();
        const descripcion = document.getElementById('evento-descripcion').value.trim();
        const msgEl = document.getElementById('mensaje-crear-evento');

        if (!contacto) {
            msgEl.innerText = '⚠️ Ingresa un número de contacto o alias.';
            msgEl.style.color = '#fbbf24';
            return;
        }

        msgEl.innerText = 'Guardando y publicando...';
        msgEl.style.color = '#38bdf8';

        let datosInsert = {
            cancha_id: this.canchaSeleccionadaId,
            tipo_evento: tipoEvento,
            contacto: contacto,
            descripcion: descripcion
        };

        try {
            if (tipoEvento === 'Torneo') {
                datosInsert.titulo = document.getElementById('evento-titulo').value.trim();
                datosInsert.tipo_inscripcion = document.getElementById('evento-inscripcion').value;
                datosInsert.cupos_equipos = parseInt(document.getElementById('evento-cupos').value) || 0;
                datosInsert.tiene_costo_inscripcion = document.getElementById('evento-check-costo').checked;
                datosInsert.costo_inscripcion = parseFloat(document.getElementById('evento-costo-inscripcion').value) || 0;
                datosInsert.tiene_premio = document.getElementById('evento-check-premio').checked;
                datosInsert.valor_premio = document.getElementById('evento-valor-premio').value.trim();
                datosInsert.fecha_inicio = document.getElementById('evento-fecha-inicio').value || null;
                datosInsert.fecha_fin = document.getElementById('evento-fecha-fin').value || null;

                const bannerFile = document.getElementById('evento-banner-file').files[0];
                if (bannerFile) {
                    // Ruta sin repetir el nombre del bucket al inicio para evitar el error NoSuchKey
                    const nombreSeguro = bannerFile.name
                        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
                        .replace(/[^a-zA-Z0-9._-]+/g, '_');
                    const filePath = `eventos_banners/${Date.now()}_${nombreSeguro}`;

                    const { error: uploadError } = await this.supabase.storage
                        .from('evidencias')
                        .upload(filePath, bannerFile, { contentType: bannerFile.type || 'image/jpeg', upsert: false });

                    if (uploadError) {
                        uploadError.paso = 'subir el banner al Storage';
                        throw uploadError;
                    }

                    const { data: publicUrlData } = this.supabase.storage
                        .from('evidencias')
                        .getPublicUrl(filePath);

                    datosInsert.banner_url = publicUrlData.publicUrl;
                }
            } else {
                datosInsert.necesita_rival = document.getElementById('evento-necesita-rival').checked;
                datosInsert.formato_partido = document.getElementById('evento-formato').value.trim();
                datosInsert.faltan_jugadores = document.getElementById('evento-faltan-jugadores').checked;
                datosInsert.jugadores_faltantes = parseInt(document.getElementById('evento-faltantes').value) || 0;
                datosInsert.fecha_hora = document.getElementById('evento-fecha-hora').value || null;

                if (tipoEvento === 'Reto / Apostado') {
                    datosInsert.monto_apuesta = parseFloat(document.getElementById('evento-monto-apuesta').value) || 0;
                }
            }

            const { error } = await this.supabase.from('eventos').insert([datosInsert]);
            if (error) {
                error.paso = 'guardar el evento en la base de datos';
                throw error;
            }

            msgEl.innerText = '✅ ¡Publicado con éxito!';
            msgEl.style.color = '#34d399';
            this.animacionGol('¡GOOOL!', tipoEvento === 'Torneo' ? 'Tu torneo ya está publicado' : 'Tu evento ya está publicado');

            document.getElementById('form-crear-evento').reset();
            document.getElementById('form-crear-evento').classList.add('oculto');

            await this.cargarEventosGlobales();
            await this.cargarEventosCancha(this.canchaSeleccionadaId);
        } catch (err) {
            console.error(err);
            msgEl.innerText = `❌ Error al ${err.paso || 'guardar el evento'}: ${err.message || 'desconocido'}`;
            msgEl.style.color = '#ef4444';
        }
    }

    async inscribirseEvento(eventoId, tipoAsistencia) {
        const inputContacto = document.getElementById(`contacto-inscripcion-${eventoId}`);
        const contacto = inputContacto ? inputContacto.value.trim() : '';

        if (!contacto) {
            this.toast('⚠️ Ingresa tu contacto o nombre para registrar la inscripción.');
            return;
        }

        const { error } = await this.supabase.from('participantes_evento').insert([
            {
                evento_id: eventoId,
                contacto: contacto,
                tipo_asistencia: tipoAsistencia
            }
        ]);

        if (error) {
            console.error("Error de Supabase:", error);
            if (error.code === '23505') {
                this.toast('⚠️ Ya te encuentras inscrito en este evento con este contacto.');
            } else {
                this.toast('❌ Error al procesar la inscripción.');
            }
            return;
        }

        this.toast(`✅ ¡Inscripción exitosa como ${tipoAsistencia}!`);
        if (inputContacto) inputContacto.value = '';
        await this.cargarEventosCancha(this.canchaSeleccionadaId);
    }

    async cargarEvidencias(canchaId) {
        const contenedor = document.getElementById('lista-evidencias');
        if (!contenedor) return;
        contenedor.innerHTML = '<p class="modal-subtexto">Cargando evidencias...</p>';

        const { data, error } = await this.supabase
            .from('evidencias')
            .select('*')
            .eq('cancha_id', canchaId)
            .order('created_at', { ascending: false });

        if (error || !data || data.length === 0) {
            contenedor.innerHTML = '<p class="modal-subtexto">No hay reportes para esta cancha.</p>';
            return;
        }

        contenedor.innerHTML = '';
        data.forEach(ev => {
            const div = document.createElement('div');
            div.className = 'tarjeta-evidencia';
            div.innerHTML = `
                <img src="${ev.imagen_url}" alt="Reporte" loading="lazy">
                <p>${ev.descripcion || 'Sin descripción'}</p>
            `;
            contenedor.appendChild(div);
        });
    }

    async subirEvidencia() {
        if (!this.canchaSeleccionadaId) return;
        const btnSubir = document.getElementById('btn-subir-evidencia');
        const mensajeEl = document.getElementById('mensaje-evidencia');
        const fileInput = document.getElementById('input-foto-evidencia');
        const descInput = document.getElementById('input-descripcion-evidencia');

        const file = fileInput.files[0];
        const desc = descInput.value;
        if (!file) return;

        btnSubir.disabled = true;
        btnSubir.innerText = 'Subiendo...';

        try {
            const filePath = `cancha_${this.canchaSeleccionadaId}/${Date.now()}.${file.name.split('.').pop()}`;
            await this.supabase.storage.from('evidencias').upload(filePath, file);
            const { data: publicUrlData } = this.supabase.storage.from('evidencias').getPublicUrl(filePath);

            await this.supabase.from('evidencias').insert([{
                cancha_id: this.canchaSeleccionadaId,
                descripcion: desc,
                imagen_url: publicUrlData.publicUrl
            }]);

            mensajeEl.innerText = 'Evidencia subida con éxito.';
            mensajeEl.style.color = '#34d399';
            document.getElementById('form-evidencia').reset();
            await this.cargarEvidencias(this.canchaSeleccionadaId);
        } catch (err) {
            console.error(err);
            mensajeEl.innerText = 'Error al subir la foto.';
            mensajeEl.style.color = '#ef4444';
        } finally {
            btnSubir.disabled = false;
            btnSubir.innerText = 'Subir evidencia';
        }
    }

    // ------------------------------------------------------------------
    // ADMIN · PANEL Y CANCHAS (listar, crear, editar y eliminar)
    // ------------------------------------------------------------------
    initAdminPanelEvents() {
        const $ = (id) => document.getElementById(id);
        const btnAbrir = $('btn-abrir-admin');
        const modalAdmin = $('admin-modal-overlay');
        const btnCerrar = $('admin-modal-cerrar');

        if (btnAbrir && modalAdmin) {
            btnAbrir.addEventListener('click', () => {
                modalAdmin.classList.remove('oculto');
                this.mostrarVistaCanchasAdmin('lista');
                this.cargarDatosAdminCanchas();
                this.cargarDatosAdminEventos();
                this.cargarDatosAdminUsuarios();
                this.cargarAlertasDesgasteAdmin();
            });
        }
        if (btnCerrar && modalAdmin) {
            btnCerrar.addEventListener('click', () => modalAdmin.classList.add('oculto'));
        }

        // Pestañas
        const pestanas = [
            ['tab-btn-canchas', 'admin-seccion-canchas'],
            ['tab-btn-analisis', 'admin-seccion-analisis'],
            ['tab-btn-eventos', 'admin-seccion-eventos'],
            ['tab-btn-roles', 'admin-seccion-roles']
        ].map(([t, s]) => [$(t), $(s)]).filter(([t, s]) => t && s);

        pestanas.forEach(([tab]) => {
            tab.addEventListener('click', () => {
                pestanas.forEach(([t, s]) => {
                    const activa = t === tab;
                    t.classList.toggle('is-active', activa);
                    s.classList.toggle('oculto', !activa);
                });
            });
        });

        // Canchas
        $('btn-admin-nueva-cancha')?.addEventListener('click', () => this.abrirFormularioCanchaAdmin(null));
        $('btn-admin-volver-lista')?.addEventListener('click', () => this.mostrarVistaCanchasAdmin('lista'));
        $('btn-admin-cancelar-cancha')?.addEventListener('click', () => this.mostrarVistaCanchasAdmin('lista'));
        $('admin-buscar-cancha')?.addEventListener('input', () => this.renderizarListaCanchasAdmin());
        $('btn-admin-ubicar-mapa')?.addEventListener('click', () => this.elegirUbicacionEnMapa());
        $('admin-cancha-imagen')?.addEventListener('input', () => this.actualizarVistaPreviaImagenAdmin());
        $('admin-cancha-foto')?.addEventListener('change', () => this.actualizarVistaPreviaImagenAdmin());
        $('form-crear-cancha-admin')?.addEventListener('submit', async (e) => {
            e.preventDefault();
            await this.guardarCanchaAdmin();
        });
    }

    mostrarVistaCanchasAdmin(vista) {
        document.getElementById('admin-canchas-lista-vista')?.classList.toggle('oculto', vista !== 'lista');
        document.getElementById('admin-cancha-form-vista')?.classList.toggle('oculto', vista !== 'form');
        const modal = document.querySelector('#admin-modal-overlay .modal-content');
        if (modal) modal.scrollTop = 0;
    }

    poblarBarriosAdmin() {
        const sel = document.getElementById('admin-cancha-barrio');
        if (!sel) return;
        const barrios = [...(this.listaBarrios || [])]
            .sort((a, b) => String(a.nombre).localeCompare(String(b.nombre)));
        sel.innerHTML = '<option value="">Sin barrio</option>' +
            barrios.map(b => `<option value="${b.id}">${this.escaparHtml(b.nombre)}</option>`).join('');
    }

    actualizarVistaPreviaImagenAdmin() {
        const prev = document.getElementById('admin-cancha-preview');
        if (!prev) return;
        const archivo = document.getElementById('admin-cancha-foto')?.files[0];
        const url = document.getElementById('admin-cancha-imagen')?.value.trim();
        const src = archivo ? URL.createObjectURL(archivo) : url;
        prev.innerHTML = src
            ? `<img src="${this.escaparHtml(src)}" alt="Vista previa de la cancha" onerror="this.remove()">`
            : '<span>Sin imagen</span>';
    }

    abrirFormularioCanchaAdmin(cancha = null) {
        const $ = (id) => document.getElementById(id);
        $('form-crear-cancha-admin').reset();
        this.poblarBarriosAdmin();
        this._canchaAdminEditando = cancha;

        $('admin-cancha-id').value = cancha ? cancha.id : '';
        $('admin-cancha-form-titulo').textContent = cancha ? 'Editar cancha' : 'Registrar nueva cancha';
        $('btn-admin-guardar-cancha-texto').textContent = cancha ? 'Guardar cambios' : 'Guardar nueva cancha';
        $('mensaje-admin-cancha').textContent = '';
        $('admin-cancha-aviso-geom').classList.add('oculto');

        if (cancha) {
            $('admin-cancha-nombre').value = cancha.nombre || '';

            const selSup = $('admin-cancha-surface');
            const sup = cancha.surface || '';
            if (![...selSup.options].some(o => o.value === sup)) selSup.add(new Option(sup, sup));
            selSup.value = sup;

            $('admin-cancha-barrio').value = cancha.barrio_id ?? '';

            const c = this.obtenerCoordenadasGeom(cancha.geometry);
            if (c && !isNaN(c.lat) && !isNaN(c.lng)) {
                $('admin-cancha-lat').value = c.lat.toFixed(6);
                $('admin-cancha-lng').value = c.lng.toFixed(6);
            }
            if (cancha.geometry && cancha.geometry.type !== 'Point') {
                $('admin-cancha-aviso-geom').classList.remove('oculto');
            }

            $('admin-cancha-horario').value = cancha.horario || '';
            $('admin-cancha-imagen').value = cancha.imagen_url || '';
        }

        this.actualizarVistaPreviaImagenAdmin();
        this.mostrarVistaCanchasAdmin('form');
    }

    // Oculta el panel, deja elegir un punto en el mapa y vuelve con las coordenadas
    elegirUbicacionEnMapa() {
        const overlay = document.getElementById('admin-modal-overlay');
        const contenedorMapa = this.map.getContainer();
        overlay.classList.add('oculto');
        this.irAlMapa();
        contenedorMapa.style.cursor = 'crosshair';
        this.toast('Haz clic en el mapa donde está la cancha. Esc para cancelar.', 'aviso');

        const terminar = () => {
            contenedorMapa.style.cursor = '';
            document.removeEventListener('keydown', alEscape);
            this.map.off('click', alClic);
            overlay.classList.remove('oculto');
        };
        const alClic = (e) => {
            document.getElementById('admin-cancha-lat').value = e.latlng.lat.toFixed(6);
            document.getElementById('admin-cancha-lng').value = e.latlng.lng.toFixed(6);
            terminar();
            this.toast('Ubicación seleccionada.', 'ok');
        };
        const alEscape = (e) => { if (e.key === 'Escape') terminar(); };

        this.map.on('click', alClic);
        document.addEventListener('keydown', alEscape);
    }

    async guardarCanchaAdmin() {
        const $ = (id) => document.getElementById(id);
        const msg = $('mensaje-admin-cancha');
        const boton = $('btn-admin-guardar-cancha');
        const aviso = (texto, color) => { msg.textContent = texto; msg.style.color = color; };

        const id = $('admin-cancha-id').value;
        const editando = !!id;
        const original = this._canchaAdminEditando;

        const nombre = $('admin-cancha-nombre').value.trim();
        const surface = $('admin-cancha-surface').value || null;
        const barrioId = parseInt($('admin-cancha-barrio').value) || null;
        const lat = parseFloat($('admin-cancha-lat').value.replace(',', '.'));
        const lng = parseFloat($('admin-cancha-lng').value.replace(',', '.'));
        const horario = $('admin-cancha-horario').value.trim();
        let imagenUrl = $('admin-cancha-imagen').value.trim();
        const archivo = $('admin-cancha-foto').files[0];

        if (!nombre) { aviso('Escribe el nombre de la cancha.', '#b3382d'); return; }
        if (isNaN(lat) || isNaN(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
            aviso('Ingresa coordenadas válidas (latitud y longitud).', '#b3382d');
            return;
        }

        boton.disabled = true;
        try {
            aviso(editando ? 'Guardando cambios...' : 'Validando ubicación y registrando...', '#1c6ea4');

            // Foto subida desde el equipo -> bucket "evidencias"
            if (archivo) {
                const ext = (archivo.name.split('.').pop() || 'jpg').toLowerCase();
                const ruta = `canchas_fotos/${Date.now()}.${ext}`;
                const { error: errSubida } = await this.supabase.storage.from('evidencias').upload(ruta, archivo);
                if (errSubida) throw errSubida;
                imagenUrl = this.supabase.storage.from('evidencias').getPublicUrl(ruta).data.publicUrl;
            }

            const datos = { nombre, surface, barrio_id: barrioId, imagen_url: imagenUrl || null };

            // Solo se toca la geometría si la ubicación cambió (así no se pierde un polígono sin querer)
            const origen = original ? this.obtenerCoordenadasGeom(original.geometry) : null;
            const cambioUbicacion = !editando || !origen ||
                Math.abs(origen.lat - lat) > 2e-6 || Math.abs(origen.lng - lng) > 2e-6;
            if (cambioUbicacion) datos.geometry = { type: 'Point', coordinates: [lng, lat] };

            // "horario" solo se envía si hay valor o si la columna ya existe en esa fila
            if (horario || (original && 'horario' in original)) datos.horario = horario || null;

            let resultado;
            if (editando) {
                resultado = await this.supabase.from('canchas').update(datos).eq('id', id).select();
                if (!resultado.error && (!resultado.data || resultado.data.length === 0)) {
                    throw new Error('Sin permisos: revisa las políticas (RLS) de UPDATE en la tabla canchas.');
                }
            } else {
                resultado = await this.supabase.from('canchas').insert([datos]);
            }
            if (resultado.error) throw resultado.error;

            aviso('', '');
            this.toast(editando ? 'Cancha actualizada con éxito.' : 'Cancha registrada con éxito.', 'ok');
            await this.cargarCanchas();
            this.cargarDatosAdminCanchas();
            this.mostrarVistaCanchasAdmin('lista');
        } catch (err) {
            console.error('Error al guardar la cancha:', err);
            const t = String(err?.message || err);
            let texto = 'No se pudo guardar la cancha.';
            if (t.includes('validación espacial')) texto = 'Rechazado por PostGIS: la ubicación está fuera de Sabaneta.';
            else if (/horario/i.test(t)) texto = 'La tabla "canchas" no tiene la columna "horario". Déjalo vacío o créala en Supabase.';
            else if (t.includes('permisos')) texto = t;
            aviso(texto, '#b3382d');
        } finally {
            boton.disabled = false;
        }
    }

    cargarDatosAdminCanchas() {
        this.renderizarListaCanchasAdmin();
    }

    renderizarListaCanchasAdmin() {
        const contenedor = document.getElementById('admin-lista-canchas');
        const contador = document.getElementById('admin-canchas-contador');
        if (!contenedor) return;

        const q = (document.getElementById('admin-buscar-cancha')?.value || '').trim().toLowerCase();
        const todas = this.datosCanchas || [];
        const lista = todas
            .filter(c => !q || (c.nombre || '').toLowerCase().includes(q) || (c.barrio || '').toLowerCase().includes(q))
            .sort((a, b) => (a.nombre || '').localeCompare(b.nombre || ''));

        if (contador) contador.textContent = `${lista.length} de ${todas.length} canchas`;
        contenedor.innerHTML = '';

        if (lista.length === 0) {
            contenedor.innerHTML = '<p class="modal-subtexto">No hay canchas que coincidan con la búsqueda.</p>';
            return;
        }

        lista.forEach(c => {
            const sup = this.infoSuperficie(c.surface);
            const foto = c.imagen_url
                ? `<img src="${this.escaparHtml(c.imagen_url)}" alt="" loading="lazy" onerror="this.remove()">`
                : '';

            const fila = document.createElement('div');
            fila.className = 'row-card admin-cancha-row';
            fila.innerHTML = `
                <span class="admin-cancha-row__thumb">${foto}</span>
                <div class="admin-cancha-row__txt">
                    <strong>${this.escaparHtml(c.nombre || 'Cancha de fútbol')}</strong>
                    <small><i style="--dot:${sup.color}"></i>${this.escaparHtml(sup.label)} · ${this.escaparHtml(c.barrio || 'Sin barrio')}</small>
                </div>
                <div class="admin-cancha-row__acc">
                    <button type="button" class="btn btn--secondary btn--sm" data-editar>Editar</button>
                    <button type="button" class="btn btn--peligro-suave btn--sm" data-eliminar>Eliminar</button>
                </div>`;
            fila.querySelector('[data-editar]').addEventListener('click', () => this.abrirFormularioCanchaAdmin(c));
            fila.querySelector('[data-eliminar]').addEventListener('click', () => this.eliminarCanchaAdmin(c.id));
            contenedor.appendChild(fila);
        });
    }

    async eliminarCanchaAdmin(canchaId) {
        const c = (this.datosCanchas || []).find(x => x.id == canchaId);
        const ok = await this.confirmar(
            '¿Eliminar esta cancha?',
            `Se eliminará "${c?.nombre || 'la cancha'}" y sus referencias. Esta acción no se puede deshacer.`,
            'Sí, eliminar'
        );
        if (!ok) return;

        const { data, error } = await this.supabase.from('canchas').delete().eq('id', canchaId).select();
        if (error || !data || data.length === 0) {
            const t = error?.code === '23503'
                ? 'La cancha tiene eventos, calificaciones o evidencias asociados.'
                : 'No se pudo eliminar la cancha.';
            this.toast(t, 'error');
            return;
        }

        this.toast('Cancha eliminada con éxito.', 'ok');
        await this.cargarCanchas();
        this.cargarDatosAdminCanchas();
    }

    async cargarAlertasDesgasteAdmin() {
        const contenedor = document.getElementById('lista-alertas-desgaste');
        if (!contenedor) return;

        // Feedback visual: el botón gira y la lista muestra un "esqueleto" mientras consulta
        const boton = document.querySelector('[onclick*="cargarAlertasDesgasteAdmin"]');
        const textoOriginal = boton ? boton.innerHTML : '';
        if (boton) {
            boton.disabled = true;
            boton.classList.add('is-cargando');
            boton.innerHTML = '<svg class="icon"><use href="#i-refresh"/></svg> Consultando…';
        }
        contenedor.innerHTML = '<div class="alerta-skel"></div><div class="alerta-skel"></div><div class="alerta-skel"></div>';

        const inicio = Date.now();
        const { data, error } = await this.supabase
            .from('alertas_desgaste')
            .select(`
                id,
                total_participantes,
                distancia_via_principal_m,
                nivel_alerta,
                fecha_alerta,
                canchas ( nombre )
            `)
            .order('fecha_alerta', { ascending: false })
            .limit(10);

        // Que la animación se alcance a ver aunque la respuesta sea instantánea
        const espera = 500 - (Date.now() - inicio);
        if (espera > 0) await new Promise(r => setTimeout(r, espera));

        if (boton) {
            boton.disabled = false;
            boton.classList.remove('is-cargando');
            boton.innerHTML = textoOriginal;
        }

        if (error) {
            console.error("Error cargando alertas de desgaste:", error);
            contenedor.innerHTML = '<p class="admin-vacio admin-vacio--error">No se pudieron cargar las alertas de desgaste.</p>';
            this.toast('❌ No se pudieron cargar las alertas.');
            return;
        }

        if (!data || data.length === 0) {
            contenedor.innerHTML = '<p class="admin-vacio">Aún no hay alertas de desgaste registradas.</p>';
            this.toast('Sin alertas nuevas por ahora.', 'aviso');
            return;
        }

        const nivel = (txt) => {
            const t = String(txt || '').toUpperCase();
            if (t.includes('CRÍTICO') || t.includes('CRITICO')) return 'critica';
            if (t.includes('MEDIO') || t.includes('MODERADO') || t.includes('ALTO')) return 'media';
            return 'baja';
        };

        contenedor.innerHTML = '';
        data.forEach((alerta, i) => {
            const nombreCancha = this.escaparHtml(alerta.canchas ? alerta.canchas.nombre : 'Cancha desconocida');
            const fecha = alerta.fecha_alerta ? new Date(alerta.fecha_alerta).toLocaleString('es-CO') : '';
            const card = document.createElement('div');
            card.className = `alerta-card alerta-card--${nivel(alerta.nivel_alerta)}`;
            card.style.animationDelay = `${i * 40}ms`;
            card.innerHTML = `
                <div class="alerta-card__top">
                    <b><svg class="icon"><use href="#i-pin"/></svg>${nombreCancha}</b>
                    <span class="alerta-card__fecha">${this.escaparHtml(fecha)}</span>
                </div>
                <p>${this.escaparHtml(alerta.nivel_alerta)}</p>
                <div class="alerta-card__chips">
                    <span><svg class="icon"><use href="#i-users"/></svg>${Number(alerta.total_participantes) || 0} participantes</span>
                    <span><svg class="icon"><use href="#i-road"/></svg>${this.escaparHtml(alerta.distancia_via_principal_m)} m a la vía</span>
                </div>`;
            contenedor.appendChild(card);
        });
        this.toast(`Alertas actualizadas (${data.length}).`, 'ok');
    }

    initCalificacionesEvents() {
        const estrellas = document.querySelectorAll('#selector-estrellas-input span');
        const inputValor = document.getElementById('input-puntuacion-valor');

        estrellas.forEach(estrella => {
            estrella.addEventListener('click', (e) => {
                const val = parseInt(e.target.getAttribute('data-value'));
                if (inputValor) inputValor.value = val;

                estrellas.forEach(s => {
                    const sVal = parseInt(s.getAttribute('data-value'));
                    s.textContent = sVal <= val ? '★' : '☆';
                });
            });
        });

        const formCalificacion = document.getElementById('form-calificacion');
        if (formCalificacion) {
            formCalificacion.addEventListener('submit', async (e) => {
                e.preventDefault();
                await this.guardarCalificacion();
            });
        }
    }

    async cargarCalificacionesCancha(canchaId) {
        const contenedorLista = document.getElementById('lista-calificaciones');
        const textoPromedio = document.getElementById('promedio-estrellas-texto');
        if (!contenedorLista || !textoPromedio) return;

        contenedorLista.innerHTML = '<p class="modal-subtexto">Cargando opiniones...</p>';

        const { data, error } = await this.supabase
            .from('calificaciones_cancha')
            .select('*')
            .eq('cancha_id', canchaId)
            .order('created_at', { ascending: false });

        if (error || !data || data.length === 0) {
            textoPromedio.innerHTML = '★ 0.0 <span style="font-size: 0.8rem; color: #94a3b8;">(Sin opiniones aún)</span>';
            contenedorLista.innerHTML = '<p class="modal-subtexto">Sé el primero en calificar esta cancha.</p>';
            return;
        }

        let suma = 0;
        data.forEach(c => suma += c.puntuacion);
        const promedio = (suma / data.length).toFixed(1);

        textoPromedio.innerHTML = `★ ${promedio} <span style="font-size: 0.8rem; color: #cbd5e1;">(${data.length} ${data.length === 1 ? 'opinión' : 'opiniones'})</span>`;

        contenedorLista.innerHTML = '';
        data.forEach(cal => {
            const div = document.createElement('div');
            div.className = 'row-card row-card--block';

            const estrellasStr = '★'.repeat(cal.puntuacion) + '☆'.repeat(5 - cal.puntuacion);
            const fecha = new Date(cal.created_at).toLocaleDateString();

            div.innerHTML = `
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 2px;">
                    <strong style="color: #38bdf8;">${cal.contacto}</strong>
                    <span style="color: #94a3b8; font-size: 0.75rem;">${fecha}</span>
                </div>
                <div style="color: #fbbf24; margin-bottom: 2px; font-size: 0.85rem;">${estrellasStr}</div>
                <p style="color: #cbd5e1; margin: 0;">${cal.comentario || 'Sin comentario'}</p>
            `;
            contenedorLista.appendChild(div);
        });
    }

    async guardarCalificacion() {
        if (!this.canchaSeleccionadaId) return;

        const puntuacion = parseInt(document.getElementById('input-puntuacion-valor').value) || 5;
        const contacto = document.getElementById('input-contacto-calificacion').value.trim();
        const comentario = document.getElementById('input-comentario-calificacion').value.trim();
        const msgEl = document.getElementById('mensaje-calificacion');

        if (!contacto) {
            msgEl.innerText = '⚠️ Ingresa tu nombre o contacto.';
            msgEl.style.color = '#fbbf24';
            return;
        }

        msgEl.innerText = 'Guardando calificación...';
        msgEl.style.color = '#38bdf8';

        const { error } = await this.supabase.from('calificaciones_cancha').insert([{
            cancha_id: this.canchaSeleccionadaId,
            contacto,
            puntuacion,
            comentario
        }]);

        if (error) {
            msgEl.innerText = '❌ Error al guardar la calificación.';
            msgEl.style.color = '#ef4444';
            return;
        }

        msgEl.innerText = '✅ ¡Calificación enviada con éxito!';
        msgEl.style.color = '#34d399';

        document.getElementById('form-calificacion').reset();
        document.querySelectorAll('#selector-estrellas-input span').forEach(s => s.textContent = '★');
        document.getElementById('input-puntuacion-valor').value = 5;

        await this.cargarCalificacionesCancha(this.canchaSeleccionadaId);
        await this.cargarCanchas(); // Recargamos para actualizar los promedios en la lista general
    }

    async cargarDatosAdminEventos() {
        const contenedor = document.getElementById('admin-lista-eventos');
        if (!contenedor) return;
        contenedor.innerHTML = '<div class="alerta-skel"></div><div class="alerta-skel"></div><div class="alerta-skel"></div>';

        const { data, error } = await this.supabase.from('eventos').select('*');
        if (error) {
            console.error(error);
            contenedor.innerHTML = '<p class="admin-vacio admin-vacio--error">No se pudieron cargar los eventos.</p>';
            return;
        }
        this.adminEventos = data || [];
        if (!this.adminEventosFiltro) this.adminEventosFiltro = { texto: '', estado: 'todos' };
        this.prepararBarraAdminEventos();
        this.renderizarAdminEventos();
    }

    // Barra de búsqueda y filtros (se crea una sola vez)
    prepararBarraAdminEventos() {
        const seccion = document.getElementById('admin-seccion-eventos');
        const lista = document.getElementById('admin-lista-eventos');
        if (!seccion || !lista || document.getElementById('admin-eventos-barra')) return;

        const barra = document.createElement('div');
        barra.id = 'admin-eventos-barra';
        barra.className = 'admin-evt-barra';
        barra.innerHTML = `
            <label class="admin-buscar">
                <svg class="icon"><use href="#i-search"/></svg>
                <input type="search" id="admin-eventos-buscar" placeholder="Buscar por nombre, cancha o contacto" autocomplete="off" aria-label="Buscar evento">
            </label>
            <div class="admin-evt-chips" role="group" aria-label="Filtrar por estado">
                <button type="button" class="is-on" data-estado="todos">Todos</button>
                <button type="button" data-estado="activo">Activos</button>
                <button type="button" data-estado="finalizado">Finalizados</button>
            </div>
            <p id="admin-eventos-resumen" class="admin-evt-resumen"></p>`;
        lista.parentNode.insertBefore(barra, lista);

        barra.querySelector('#admin-eventos-buscar').addEventListener('input', (e) => {
            this.adminEventosFiltro.texto = e.target.value.trim().toLowerCase();
            this.renderizarAdminEventos();
        });
        barra.querySelectorAll('[data-estado]').forEach(b => b.addEventListener('click', () => {
            this.adminEventosFiltro.estado = b.dataset.estado;
            barra.querySelectorAll('[data-estado]').forEach(x => x.classList.toggle('is-on', x === b));
            this.renderizarAdminEventos();
        }));
    }

    renderizarAdminEventos() {
        const contenedor = document.getElementById('admin-lista-eventos');
        if (!contenedor) return;
        const f = this.adminEventosFiltro || { texto: '', estado: 'todos' };
        const todos = this.adminEventos || [];

        const tipos = {
            'Torneo': { clase: 'torneo', icono: '#i-trophy', etiqueta: 'Torneo' },
            'Partido Recreativo': { clase: 'recreativo', icono: '#i-users', etiqueta: 'Recreativo' },
            'Reto / Apostado': { clase: 'reto', icono: '#i-target', etiqueta: 'Reto' }
        };

        const lista = todos.filter(ev => {
            const activo = this.esEventoActivo(ev);
            if (f.estado === 'activo' && !activo) return false;
            if (f.estado === 'finalizado' && activo) return false;
            if (!f.texto) return true;
            const cancha = (this.datosCanchas || []).find(c => c.id == ev.cancha_id);
            const pajar = [ev.titulo, ev.tipo_evento, ev.contacto, ev.descripcion, cancha?.nombre].join(' ').toLowerCase();
            return pajar.includes(f.texto);
        });

        const resumen = document.getElementById('admin-eventos-resumen');
        if (resumen) {
            const activos = todos.filter(ev => this.esEventoActivo(ev)).length;
            resumen.innerHTML = `<b>${todos.length}</b> en total · <b class="ok">${activos}</b> activos · <b class="fin">${todos.length - activos}</b> finalizados`;
        }

        if (lista.length === 0) {
            contenedor.innerHTML = '<p class="admin-vacio">No hay eventos que coincidan con la búsqueda.</p>';
            return;
        }

        contenedor.innerHTML = '';
        lista.forEach((ev, i) => {
            const t = tipos[ev.tipo_evento] || { clase: 'recreativo', icono: '#i-users', etiqueta: ev.tipo_evento || 'Evento' };
            const activo = this.esEventoActivo(ev);
            const cancha = (this.datosCanchas || []).find(c => c.id == ev.cancha_id);
            const titulo = this.escaparHtml(ev.titulo || ev.tipo_evento || 'Evento');
            let cuando = '';
            if (ev.tipo_evento === 'Torneo' && ev.fecha_inicio) {
                cuando = this.formatearFechaEvento(ev.fecha_inicio);
                if (ev.fecha_fin && ev.fecha_fin !== ev.fecha_inicio) cuando += ' → ' + this.formatearFechaEvento(ev.fecha_fin);
            } else if (ev.fecha_hora) cuando = this.formatearFechaEvento(ev.fecha_hora);

            const media = ev.banner_url
                ? `<img src="${this.escaparHtml(ev.banner_url)}" alt="" loading="lazy" decoding="async" onerror="this.remove()">`
                : '';

            const fila = document.createElement('article');
            fila.className = `admin-evt admin-evt--${t.clase}${activo ? '' : ' is-fin'}`;
            fila.style.animationDelay = `${Math.min(i, 8) * 35}ms`;
            fila.innerHTML = `
                <div class="admin-evt__media"><svg class="icon"><use href="${t.icono}"/></svg>${media}</div>
                <div class="admin-evt__cuerpo">
                    <div class="admin-evt__tit">
                        <strong>${titulo}</strong>
                        <span class="admin-evt__pill ${activo ? 'is-activo' : 'is-fin'}">${activo ? 'Activo' : 'Finalizado'}</span>
                    </div>
                    <div class="admin-evt__meta">
                        <span class="admin-evt__tipo">${this.escaparHtml(t.etiqueta)}</span>
                        <span><svg class="icon"><use href="#i-pin"/></svg>${this.escaparHtml(cancha?.nombre || 'Cancha sin identificar')}</span>
                        ${cuando ? `<span><svg class="icon"><use href="#i-check"/></svg>${this.escaparHtml(cuando)}</span>` : ''}
                        <span><svg class="icon"><use href="#i-users"/></svg>${this.escaparHtml(ev.contacto || 'Sin contacto')}</span>
                    </div>
                </div>
                <button type="button" class="btn btn--peligro-suave btn--sm admin-evt__borrar" aria-label="Borrar ${titulo}">
                    <svg class="icon"><use href="#i-x"/></svg>Borrar
                </button>`;
            fila.querySelector('.admin-evt__borrar').addEventListener('click', () => this.eliminarEventoAdmin(ev.id));
            contenedor.appendChild(fila);
        });
    }

    async eliminarEventoAdmin(eventoId) {
        const ok = await this.confirmar(
            '¿Eliminar este evento?',
            'Se eliminará el torneo o evento de forma definitiva. Esta acción no se puede deshacer.',
            'Sí, eliminar'
        );
        if (!ok) return;

        // .select() devuelve las filas borradas: si viene vacío, la base de datos lo bloqueó (políticas RLS)
        const { data, error } = await this.supabase.from('eventos').delete().eq('id', eventoId).select();
        if (error) {
            console.error(error);
            this.toast('❌ Error al eliminar: ' + (error.message || 'desconocido'));
            return;
        }
        if (!data || data.length === 0) {
            this.toast('❌ La base de datos no permitió borrar el evento (revisa las políticas de la tabla eventos).');
            return;
        }

        this.toast('✅ Evento eliminado.');
        await this.cargarEventosGlobales();
        await this.cargarDatosAdminEventos();
    }

    async cargarDatosAdminUsuarios() {
        const contenedor = document.getElementById('admin-lista-usuarios');
        if (!contenedor) return;
        contenedor.innerHTML = '<p class="modal-subtexto">Cargando usuarios...</p>';

        const { data, error } = await this.supabase.from('profiles').select('*');
        if (error || !data) {
            contenedor.innerHTML = '<p class="modal-subtexto">No se pudieron cargar los perfiles.</p>';
            return;
        }

        contenedor.innerHTML = '';
        data.forEach(user => {
            const div = document.createElement('div');
            div.className = 'row-card';

            const esAdmin = user.role === 'admin';
            div.innerHTML = `
                <div>
                    <strong style="color: #f8fafc; font-size: 0.85rem;">${user.email}</strong>
                    <p style="font-size: 0.75rem; color: ${esAdmin ? '#34d399' : '#94a3b8'}; margin: 0;">Rol: <b>${user.role.toUpperCase()}</b></p>
                </div>
                <button onclick="window.mapApp.cambiarRolUsuario('${user.id}', '${esAdmin ? 'user' : 'admin'}')" style="background: ${esAdmin ? '#d97706' : '#7c3aed'}; color: white; border: none; padding: 4px 8px; border-radius: 4px; font-size: 0.75rem; cursor: pointer;">
                    ${esAdmin ? '⬇️ Hacer Usuario' : '👑 Hacer Admin'}
                </button>
            `;
            contenedor.appendChild(div);
        });
    }

    async cambiarRolUsuario(userId, nuevoRol) {
        const { error } = await this.supabase
            .from('profiles')
            .update({ role: nuevoRol })
            .eq('id', userId);

        if (error) {
            this.toast('❌ Error al actualizar el rol.');
            return;
        }

        this.toast(`✅ Rol actualizado a ${nuevoRol.toUpperCase()} con éxito.`);
        await this.cargarDatosAdminUsuarios();
    }
}


// Decoración navideña: función independiente de la clase para que NO dependa de que el resto del visor arranque bien
// (por ejemplo en ventanas privadas, donde el almacenamiento del navegador puede estar bloqueado).
function iniciarDecoracionNavidad() {
    const NAVIDAD_ACTIVA = true;
    if (!NAVIDAD_ACTIVA) return;

    const gorro = `<svg class="navidad-gorro" viewBox="0 0 64 56" aria-hidden="true"><path d="M5 46 C8 22 26 8 46 9 C56 10 61 18 60 28 L56 46 Z" fill="#d62828"/><path d="M13 44 C15 28 27 15 42 13" fill="none" stroke="#a31515" stroke-width="3" stroke-linecap="round" opacity=".55"/><circle cx="60" cy="31" r="7.5" fill="#fff"/><rect x="1" y="40" width="62" height="14" rx="7" fill="#fff"/><rect x="1" y="40" width="62" height="14" rx="7" fill="none" stroke="#d9dee3" stroke-width="1"/></svg>`;
    const copo = `<svg class="navidad-copo" viewBox="0 0 24 24" aria-hidden="true"><g id="copo-brazo"><path d="M12 2v20"/><path d="M9.2 4.6 12 7.4 14.8 4.6"/><path d="M9.2 19.4 12 16.6 14.8 19.4"/></g><use href="#copo-brazo" transform="rotate(60 12 12)"/><use href="#copo-brazo" transform="rotate(120 12 12)"/></svg>`;

    // Gorro y copo en todos los logos (cabecera y pantalla de bienvenida)
    document.querySelectorAll('.brand-logo').forEach(logo => {
        if (!logo.querySelector('.navidad-gorro')) logo.insertAdjacentHTML('beforeend', gorro + copo);
    });

    // Nieve cayendo en la cabecera
    const header = document.querySelector('.app-header');
    if (header && !header.querySelector('.nieve')) {
        const capa = document.createElement('div');
        capa.className = 'nieve';
        capa.setAttribute('aria-hidden', 'true');
        const total = 20;
        for (let i = 0; i < total; i++) {
            const f = document.createElement('i');
            const t = 5 + Math.random() * 4;
            f.style.cssText = `left:${(i / total * 100 + Math.random() * 3).toFixed(1)}%;--s:${(2.5 + Math.random() * 3).toFixed(1)}px;--t:${t.toFixed(1)}s;--d:-${(Math.random() * t).toFixed(1)}s;--x:${(Math.random() * 24 - 12).toFixed(0)}px`;
            capa.appendChild(f);
        }
        header.prepend(capa);
    }
}

try { iniciarDecoracionNavidad(); } catch (e) { console.warn('Decoración navideña no disponible:', e); }

if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    document.querySelector('.intro-map')?.pauseAnimations();
}

// Carga principal al estar listo el DOM
window.onload = () => {
    new MapViewer('map');
    // Refuerzo: asegura la decoración aunque algo haya fallado durante el arranque
};