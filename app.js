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
        this.canchaSeleccionadaId = null;
        this.datosCanchas = [];
        this.datosParaderos = [];
        this.datosEventos = [];
        this.capaMarcadoresZoom = null;
        this.layerControl = null;
        this.capaRuta = null;
        this.marcadoresRuta = [];
        this.barrioSeleccionadoValor = '';

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

            const adminModalBody = document.querySelector('#admin-modal-overlay .modal-content') || document.querySelector('.admin-content');
            if (adminModalBody && !document.getElementById('btn-recalcular-gdal')) {
                const btnGdalContainer = document.createElement('div');
                btnGdalContainer.className = 'admin-card';
                btnGdalContainer.innerHTML = `
                    <p>Motor analítico espacial (GDAL / PostGIS)</p>
                    <button id="btn-recalcular-gdal" type="button" onclick="window.mapApp.recalcularAnalisisGdal()" class="btn btn--secondary btn--block">
                        <svg class="icon"><use href="#i-refresh"/></svg>
                        Recalcular análisis GIS (GDAL)
                    </button>
                `;
                const tituloAdmin = adminModalBody.querySelector('.tabs');
                if (tituloAdmin) {
                    adminModalBody.insertBefore(btnGdalContainer, tituloAdmin);
                } else {
                    adminModalBody.appendChild(btnGdalContainer);
                }
            }
        }
    }

    async recalcularAnalisisGdal() {
        const btn = document.getElementById('btn-recalcular-gdal');
        if (btn) {
            btn.disabled = true;
            btn.innerText = 'Ejecutando motor GDAL / buffers...';
        }

        try {
            await this.cargarZonasInfluenciaAdmin();
            await this.cargarCapaGdalProcesada();
            await this.cargarAlertasDesgasteAdmin();

            await new Promise(resolve => setTimeout(resolve, 800));

            alert('✅ ¡Análisis espacial GDAL recalculado con éxito! Las zonas de influencia y los buffers se han actualizado en el mapa.');
        } catch (err) {
            console.error("Error al recalcular GDAL:", err);
            alert('❌ Ocurrió un error al ejecutar el re-análisis espacial.');
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.innerText = 'Recalcular análisis GIS (GDAL)';
            }
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
        input.addEventListener('input', () => this.aplicarFiltrosGlobalesDebounced());
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

        contenedor.innerHTML = '';
        if (contador) contador.innerText = eventos.length;

        if (!eventos || eventos.length === 0) {
            contenedor.innerHTML = '<p class="cargando-texto">No hay eventos o torneos que coincidan con la búsqueda.</p>';
            return;
        }

        const tabla = document.createElement('table');
        tabla.className = 'tabla-canchas';
        tabla.innerHTML = `
            <thead><tr>
                <th scope="col">Evento / Torneo</th>
                <th scope="col">Cancha Asociada</th>
                <th scope="col">Organizador</th>
                <th scope="col">Detalles</th>
                <th scope="col" class="col-acciones"><span class="visualmente-oculto">Acciones</span></th>
            </tr></thead><tbody></tbody>`;
        const cuerpo = tabla.querySelector('tbody');

        eventos.forEach(ev => {
            const canchaObj = this.datosCanchas.find(c => c.id === ev.cancha_id);
            const nombreCancha = this.escaparHtml(canchaObj?.nombre || 'Escenario deportivo');
            const titulo = this.escaparHtml(ev.tipo_evento === 'Torneo' ? (ev.titulo || 'Torneo') : ev.tipo_evento);
            const icono = ev.tipo_evento === 'Torneo' ? '#i-trophy' : '#i-users';

            const fila = document.createElement('tr');
            fila.className = 'item-cancha-lista';
            fila.innerHTML = `
                <td data-label="Evento"><span class="celda-evento"><svg class="icon"><use href="${icono}"/></svg><strong>${titulo}</strong></span></td>
                <td data-label="Cancha">${nombreCancha}</td>
                <td data-label="Organizador">${this.escaparHtml(ev.contacto)}</td>
                <td data-label="Detalles"><small>${this.escaparHtml(ev.descripcion || 'Sin detalles adicionales')}</small></td>
                <td class="col-acciones"><button type="button" class="btn btn--secondary btn--sm">Ver en mapa</button></td>
            `;
            fila.addEventListener('click', () => {
                if (canchaObj) {
                    this.enfocarCancha(canchaObj, true);
                }
            });
            cuerpo.appendChild(fila);
        });

        const envoltorio = document.createElement('div');
        envoltorio.className = 'tabla-wrap';
        envoltorio.appendChild(tabla);
        contenedor.appendChild(envoltorio);
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
        contenedor.innerHTML = '';

        if (!eventos || eventos.length === 0) {
            contenedor.innerHTML = '<p class="cargando-texto">No hay eventos próximos en este momento.</p>';
            return;
        }

        const tabla = document.createElement('table');
        tabla.className = 'tabla-canchas';
        tabla.innerHTML = `
            <thead><tr>
                <th scope="col">Evento</th><th scope="col">Cancha</th><th scope="col">Contacto</th>
                <th scope="col" class="col-acciones"><span class="visualmente-oculto">Acciones</span></th>
            </tr></thead><tbody></tbody>`;
        const cuerpo = tabla.querySelector('tbody');

        eventos.forEach(ev => {
            const canchaObj = this.datosCanchas.find(c => c.id === ev.cancha_id);
            const nombreCancha = this.escaparHtml(canchaObj?.nombre || 'Cancha de Sabaneta');
            const titulo = this.escaparHtml(ev.tipo_evento === 'Torneo' ? (ev.titulo || 'Torneo') : ev.tipo_evento);
            const icono = ev.tipo_evento === 'Torneo' ? '#i-trophy' : '#i-users';

            const fila = document.createElement('tr');
            fila.className = 'item-cancha-lista';
            fila.innerHTML = `
                <td data-label="Evento"><span class="celda-evento"><svg class="icon"><use href="${icono}"/></svg><strong>${titulo}</strong></span></td>
                <td data-label="Cancha">${nombreCancha}</td>
                <td data-label="Contacto">${this.escaparHtml(ev.contacto)}</td>
                <td class="col-acciones"><button type="button" class="btn btn--secondary btn--sm">Ver cancha</button></td>
            `;
            fila.addEventListener('click', () => {
                if (canchaObj) this.enfocarCancha(canchaObj, true);
            });
            cuerpo.appendChild(fila);
        });

        const envoltorio = document.createElement('div');
        envoltorio.className = 'tabla-wrap';
        envoltorio.appendChild(tabla);
        contenedor.appendChild(envoltorio);
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

        const featureCollection = {
            type: 'FeatureCollection',
            features: this.datosCanchas.map((row) => ({ type: 'Feature', properties: row, geometry: row.geometry }))
        };

        this.dibujarCapas(featureCollection);
        this.renderizarListaCanchas(this.datosCanchas);

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
        if (!coords) return;
        this.irAlMapa();
        this.map.flyTo([coords.lat, coords.lng], 18, { duration: 1.2 });
        if (abrirDetalle) setTimeout(() => this.abrirModalCancha(cancha), 600);
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

        const orden = this.ordenTabla || { campo: null, dir: 1 };
        let filas = [...canchas];
        if (orden.campo) {
            const valor = (c) => {
                if (orden.campo === 'nombre') return (c.nombre || '').toLowerCase();
                if (orden.campo === 'superficie') return this.infoSuperficie(c.surface).label.toLowerCase();
                return c.promedio_estrellas || 0;
            };
            filas.sort((a, b) => {
                const va = valor(a), vb = valor(b);
                return (va < vb ? -1 : va > vb ? 1 : 0) * orden.dir;
            });
        }

        const cabecera = (campo, texto) => {
            const activo = orden.campo === campo;
            const sentido = activo ? (orden.dir === 1 ? 'ascending' : 'descending') : 'none';
            const flecha = activo ? (orden.dir === 1 ? '↑' : '↓') : '';
            return `<th scope="col" aria-sort="${sentido}"><button type="button" class="th-orden" data-orden="${campo}">${texto}<span class="th-flecha">${flecha}</span></button></th>`;
        };

        const tabla = document.createElement('table');
        tabla.className = 'tabla-canchas';
        tabla.innerHTML = `
            <thead><tr>
                ${cabecera('nombre', 'Cancha')}
                ${cabecera('superficie', 'Superficie')}
                ${cabecera('estrellas', 'Calificación')}
                <th scope="col" class="col-acciones"><span class="visualmente-oculto">Acciones</span></th>
            </tr></thead>
            <tbody></tbody>
        `;
        tabla.querySelectorAll('[data-orden]').forEach(b => b.addEventListener('click', () => this.ordenarTabla(b.dataset.orden)));

        const cuerpo = tabla.querySelector('tbody');
        filas.forEach(c => {
            const esFav = this.favoritos.includes(c.id);
            const nombre = this.escaparHtml(c.nombre || 'Cancha de fútbol');
            const barrio = this.escaparHtml(c.barrio || 'Sin barrio');
            const sup = this.infoSuperficie(c.surface);
            const imagen = c.imagen_url ? `<img src="${this.escaparHtml(c.imagen_url)}" alt="" loading="lazy" onerror="this.remove()">` : '';
            const calificacion = c.promedio_estrellas > 0
                ? `<span class="nota"><svg class="icon"><use href="#i-star"/></svg><b>${Number(c.promedio_estrellas).toFixed(1)}</b></span>`
                : '<span class="nota nota--vacia">Sin calificar</span>';

            const fila = document.createElement('tr');
            fila.className = 'item-cancha-lista';
            fila.tabIndex = 0;
            fila.innerHTML = `
                <td data-label="Cancha">
                    <div class="celda-cancha">
                        <span class="miniatura">${imagen}</span>
                        <span class="celda-cancha__texto"><strong>${nombre}</strong><small><svg class="icon"><use href="#i-pin"/></svg>${barrio}</small></span>
                    </div>
                </td>
                <td data-label="Superficie"><span class="sup"><i style="--dot:${sup.color}"></i>${this.escaparHtml(sup.label)}</span></td>
                <td data-label="Calificación">${calificacion}</td>
                <td class="col-acciones">
                    <button type="button" class="icon-btn fav-btn" data-fav aria-pressed="${esFav}" aria-label="${esFav ? 'Quitar de favoritas' : 'Marcar como favorita'}" title="Favorita"><svg class="icon"><use href="#i-star"/></svg></button>
                    <button type="button" class="icon-btn" data-locate aria-label="Ver ${nombre} en el mapa" title="Ver en el mapa"><svg class="icon"><use href="#i-pin"/></svg></button>
                    <button type="button" class="btn btn--secondary btn--sm" data-ver>Detalles</button>
                </td>
            `;

            const accion = (e) => {
                if (e.target.closest('[data-fav]')) this.toggleFavorito(c.id);
                else if (e.target.closest('[data-locate]')) this.enfocarCancha(c, false);
                else this.enfocarCancha(c, true);
            };
            fila.addEventListener('click', accion);
            fila.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && e.target === fila) this.enfocarCancha(c, true);
            });
            cuerpo.appendChild(fila);
        });

        const envoltorio = document.createElement('div');
        envoltorio.className = 'tabla-wrap';
        envoltorio.appendChild(tabla);
        contenedor.appendChild(envoltorio);
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
            onEachFeature
        }).addTo(this.map);

        this.capaPavimentadas = L.geoJSON(datosCanchas, {
            filter: (f) => ['asphalt', 'concrete', 'paving_stones'].includes(f.properties.surface),
            style: { color: "#4f46e5", fillColor: "#6366f1", ...opciones },
            onEachFeature
        }).addTo(this.map);

        this.capaOtras = L.geoJSON(datosCanchas, {
            filter: (f) => !f.properties.surface || !['artificial_turf', 'grass', 'asphalt', 'concrete', 'paving_stones'].includes(f.properties.surface),
            style: { color: "#d97706", fillColor: "#f59e0b", ...opciones },
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
                color: '#ef4444',
                weight: 4,
                fillColor: '#f87171',
                fillOpacity: 0.10
            }
        }).addTo(this.map);

        this.capaLimite.bringToBack();
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
            const urlCapaGdal = "https://vdltyryvmphxdcxjrgsf.supabase.co/storage/v1/object/public/evidencias/canchas_analisis_gdal.geojson";
            const res = await fetch(urlCapaGdal);
            if (!res.ok) return;
            const geojson = await res.json();

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
            if (!chkGdal || chkGdal.checked) {
                if (chkGdal) chkGdal.checked = true;
            } else {
                this.map.removeLayer(this.capaGdalGroup);
            }

            if (this.layerControl) this.layerControl.addOverlay(this.capaGdalGroup, "📊 Análisis GDAL (Backend)");
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
            style: { color: '#f59e0b', weight: 2.5, opacity: 0.85 }
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

            let bannerHtml = ev.banner_url ? `<img src="${ev.banner_url}" alt="Banner Torneo" style="width: 100%; height: 110px; object-fit: cover; border-radius: 6px; margin-bottom: 8px;" />` : '';
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
                    // 💡 RUTA CORREGIDA: Sin repetir el nombre del bucket al inicio para evitar el error NoSuchKey
                    const filePath = `eventos_banners/${Date.now()}_${bannerFile.name}`;
                    
                    const { error: uploadError } = await this.supabase.storage
                        .from('evidencias')
                        .upload(filePath, bannerFile);

                    if (uploadError) throw uploadError;

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
            if (error) throw error;

            msgEl.innerText = '✅ ¡Publicado con éxito!';
            msgEl.style.color = '#34d399';

            document.getElementById('form-crear-evento').reset();
            document.getElementById('form-crear-evento').classList.add('oculto');

            await this.cargarEventosGlobales();
            await this.cargarEventosCancha(this.canchaSeleccionadaId);
        } catch (err) {
            console.error(err);
            msgEl.innerText = '❌ Error al guardar el evento.';
            msgEl.style.color = '#ef4444';
        }
    }

    async inscribirseEvento(eventoId, tipoAsistencia) {
        const inputContacto = document.getElementById(`contacto-inscripcion-${eventoId}`);
        const contacto = inputContacto ? inputContacto.value.trim() : '';

        if (!contacto) {
            alert('Por favor ingresa tu contacto o nombre para registrar la inscripción.');
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
                alert('⚠️ Ya te encuentras inscrito en este evento con este contacto.');
            } else {
                alert('❌ Error al procesar la inscripción.');
            }
            return;
        }

        alert(`✅ ¡Inscripción exitosa como ${tipoAsistencia}!`);
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

    initAdminPanelEvents() {
        const btnAbrir = document.getElementById('btn-abrir-admin');
        const modalAdmin = document.getElementById('admin-modal-overlay');
        const btnCerrar = document.getElementById('admin-modal-cerrar');

        if (btnAbrir && modalAdmin) {
            btnAbrir.addEventListener('click', () => {
                modalAdmin.classList.remove('oculto');
                this.cargarDatosAdminCanchas();
                this.cargarDatosAdminEventos();
                this.cargarDatosAdminUsuarios();
                this.cargarAlertasDesgasteAdmin();
            });
        }

        if (btnCerrar && modalAdmin) {
            btnCerrar.addEventListener('click', () => modalAdmin.classList.add('oculto'));
        }

        const tabCanchas = document.getElementById('tab-btn-canchas');
        const tabEventos = document.getElementById('tab-btn-eventos');
        const tabRoles = document.getElementById('tab-btn-roles');

        const secCanchas = document.getElementById('admin-seccion-canchas');
        const secEventos = document.getElementById('admin-seccion-eventos');
        const secRoles = document.getElementById('admin-seccion-roles');

        if (tabCanchas && tabEventos && tabRoles) {
            const pestanas = [
                [tabCanchas, secCanchas],
                [tabEventos, secEventos],
                [tabRoles, secRoles]
            ];
            pestanas.forEach(([tab, seccion]) => {
                tab.addEventListener('click', () => {
                    pestanas.forEach(([t, s]) => {
                        const activa = t === tab;
                        t.classList.toggle('is-active', activa);
                        s.classList.toggle('oculto', !activa);
                    });
                });
            });
        }

        const formCanchaAdmin = document.getElementById('form-crear-cancha-admin');
        if (formCanchaAdmin) {
            formCanchaAdmin.addEventListener('submit', async (e) => {
                e.preventDefault();
                await this.crearCanchaAdmin();
            });
        }
    }

    async crearCanchaAdmin() {
        const nombre = document.getElementById('admin-cancha-nombre').value.trim();
        const surface = document.getElementById('admin-cancha-surface').value;
        const barrioId = parseInt(document.getElementById('admin-cancha-barrio').value) || null;
        const lat = parseFloat(document.getElementById('admin-cancha-lat').value);
        const lng = parseFloat(document.getElementById('admin-cancha-lng').value);
        const imagenUrl = document.getElementById('admin-cancha-imagen').value.trim();
        const msgEl = document.getElementById('mensaje-admin-cancha');

        if (isNaN(lat) || isNaN(lng)) {
            msgEl.innerText = '⚠️ Ingresa coordenadas válidas.';
            msgEl.style.color = '#fbbf24';
            return;
        }

        msgEl.innerText = 'Validando ubicación y registrando...';
        msgEl.style.color = '#38bdf8';

        const geometry = { type: "Point", coordinates: [lng, lat] };

        const { error } = await this.supabase.from('canchas').insert([{
            nombre,
            surface,
            barrio_id: barrioId,
            geometry,
            imagen_url: imagenUrl || null
        }]);

        if (error) {
            if (error.message?.includes('Error de validación espacial')) {
                msgEl.innerText = '❌ Rechazado por PostGIS: La cancha está fuera de Sabaneta.';
            } else {
                msgEl.innerText = '❌ Error al registrar la cancha en la base de datos.';
            }
            msgEl.style.color = '#ef4444';
            return;
        }

        msgEl.innerText = '✅ ¡Cancha registrada con éxito dentro del municipio!';
        msgEl.style.color = '#34d399';
        document.getElementById('form-crear-cancha-admin').reset();
        await this.cargarCanchas();
        await this.cargarDatosAdminCanchas();
    }

    async cargarDatosAdminCanchas() {
        const contenedor = document.getElementById('admin-lista-canchas');
        if (!contenedor) return;
        contenedor.innerHTML = '<p class="modal-subtexto">Cargando...</p>';

        const { data, error } = await this.supabase.from('canchas').select('id, nombre, surface');
        if (error || !data) {
            contenedor.innerHTML = '<p class="modal-subtexto">Error al cargar canchas.</p>';
            return;
        }

        contenedor.innerHTML = '';
        data.forEach(c => {
            const div = document.createElement('div');
            div.className = 'row-card';
            div.innerHTML = `
                <div>
                    <strong style="color: #f8fafc; font-size: 0.85rem;">${c.nombre || 'Cancha'}</strong>
                    <p style="font-size: 0.75rem; color: #94a3b8; margin: 0;">${c.surface || 'N/A'}</p>
                </div>
                <button onclick="window.mapApp.eliminarCanchaAdmin(${c.id})" style="background: #dc2626; color: white; border: none; padding: 4px 8px; border-radius: 4px; font-size: 0.75rem; cursor: pointer;">🗑️ Eliminar</button>
            `;
            contenedor.appendChild(div);
        });
    }

    async eliminarCanchaAdmin(canchaId) {
        if (!confirm("⚠️ ¿Estás seguro de eliminar esta cancha? Se borrarán sus referencias.")) return;

        const { error } = await this.supabase.from('canchas').delete().eq('id', canchaId);
        if (error) {
            alert("❌ No se pudo eliminar la cancha.");
            return;
        }

        alert("✅ Cancha eliminada con éxito.");
        await this.cargarCanchas();
        await this.cargarDatosAdminCanchas();
    }

    async cargarAlertasDesgasteAdmin() {
        const contenedor = document.getElementById('lista-alertas-desgaste');
        if (!contenedor) return;

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

        if (error) {
            console.error("Error cargando alertas de desgaste:", error);
            contenedor.innerHTML = '<p style="color: #ef4444;">Error al cargar las alertas de desgaste.</p>';
            return;
        }

        if (!data || data.length === 0) {
            contenedor.innerHTML = '<p style="color: #94a3b8; font-size: 0.85rem;">No hay registros de desgaste o alertas generadas aún.</p>';
            return;
        }

        let html = '<div style="display: flex; flex-direction: column; gap: 8px;">';
        data.forEach(alerta => {
            const nombreCancha = alerta.canchas ? alerta.canchas.nombre : 'Cancha desconocida';
            const fechaFormateada = new Date(alerta.fecha_alerta).toLocaleString();

            html += `
                <div style="background: #1e293b; padding: 10px; border-radius: 6px; border-left: 4px solid #3b82f6; font-size: 0.85rem;">
                    <b style="color: #f8fafc;">📍 ${nombreCancha}</b><br>
                    <span style="color: #cbd5e1;">${alerta.nivel_alerta}</span><br>
                    <span style="color: #94a3b8; font-size: 0.75rem;">
                        👥 Participantes: <b>${alerta.total_participantes}</b> | 
                        🛣️ Distancia a vía: <b>${alerta.distancia_via_principal_m} m</b> | 
                        🕒 ${fechaFormateada}
                    </span>
                </div>
            `;
        });
        html += '</div>';

        contenedor.innerHTML = html;
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
        contenedor.innerHTML = '<p class="modal-subtexto">Cargando eventos...</p>';

        const { data, error } = await this.supabase.from('eventos').select('*');
        if (error || !data || data.length === 0) {
            contenedor.innerHTML = '<p class="modal-subtexto">No hay eventos activos.</p>';
            return;
        }

        contenedor.innerHTML = '';
        data.forEach(ev => {
            const div = document.createElement('div');
            div.className = 'row-card';

            const estaActivo = this.esEventoActivo(ev);
            const badgeEstado = estaActivo
                ? '<span style="color: #34d399; font-size: 0.7rem; font-weight: normal; margin-left: 5px;">(Activo)</span>'
                : '<span style="color: #ef4444; font-size: 0.7rem; font-weight: normal; margin-left: 5px;">(Finalizado)</span>';

            const titulo = ev.titulo || ev.tipo_evento;

            div.innerHTML = `
                <div>
                    <strong style="color: #38bdf8; font-size: 0.85rem;">${titulo} ${badgeEstado}</strong>
                    <p style="font-size: 0.75rem; color: #cbd5e1; margin: 0;">📞 ${ev.contacto}</p>
                </div>
                <button onclick="window.mapApp.eliminarEventoAdmin(${ev.id})" style="background: #dc2626; color: white; border: none; padding: 4px 8px; border-radius: 4px; font-size: 0.75rem; cursor: pointer;">🗑️ Borrar</button>
            `;
            contenedor.appendChild(div);
        });
    }

    async eliminarEventoAdmin(eventoId) {
        if (!confirm("🚨 ¿Eliminar este torneo/evento definitivamente?")) return;

        const { error } = await this.supabase.from('eventos').delete().eq('id', eventoId);
        if (error) {
            alert("❌ Error al eliminar el evento.");
            return;
        }

        alert("✅ Evento eliminado.");
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
            alert("❌ Error al actualizar el rol.");
            return;
        }

        alert(`✅ Rol actualizado a ${nuevoRol.toUpperCase()} con éxito.`);
        await this.cargarDatosAdminUsuarios();
    }
}

// Carga principal al estar listo el DOM
window.onload = () => new MapViewer('map');