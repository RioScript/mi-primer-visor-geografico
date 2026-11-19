// admin.js · Panel de administración (página completa)
const SUPABASE_URL = "https://vdltyryvmphxdcxjrgsf.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZkbHR5cnl2bXBoeGRjeGpyZ3NmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc3NTU5NTgsImV4cCI6MjEwMzMzMTk1OH0.vxqi58vWcfbWqoRTs9-AhalTOJS5rkOGQKbGrCOb9WA";

class AdminApp {
    constructor() {
        this.sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
        this.$ = (id) => document.getElementById(id);
        this.yoId = null;
        this.datosCanchas = [];
        this.listaBarrios = [];
        this.adminEventos = [];
        this.adminEventosFiltro = { texto: '', estado: 'todos' };
        this.canchaEditando = null;
        this.perm = { pagina: 1, tam: 10, total: 0, filtros: null };
        this.init();
    }

    async init() {
        const { data: { session } } = await this.sb.auth.getSession();
        if (!session) return location.replace('index.html');
        this.yoId = session.user.id;
        const { data, error } = await this.sb.from('profiles').select('role').eq('id', this.yoId).single();
        if (error || data?.role !== 'admin') return location.replace('index.html');
        this.sb.auth.onAuthStateChange((_e, s) => { if (!s) location.replace('index.html'); });
        document.body.classList.remove('admin-cargando');

        this.initTabs();
        this.initBalonFondo();
        this.initCanchas();
        this.initGis();
        this.initParticipantes();
        this.pintarVacio('No se encontraron registros', 'Rellena al menos un campo y pulsa «Buscar Participante».');

        await this.cargarCanchas();
        this.restaurarBorrador();
        this.cargarEventos();
        this.cargarKpis();
    }

    // ------------------------------------------------------------------ balón de fondo
    initBalonFondo() {
        const balon = this.$('balon-fondo');
        if (!balon) return;

        const lanzar = () => {
            const topPct = (14 + Math.random() * 68).toFixed(1);
            const startVw = (-5 + Math.random() * 35).toFixed(1);
            const rebotePx = (10 + Math.random() * 18).toFixed(0);
            const sizePx = (28 + Math.random() * 12).toFixed(0);

            balon.style.setProperty('--y', `${topPct}%`);
            balon.style.setProperty('--x-inicio', `${startVw}vw`);
            balon.style.setProperty('--rebote', `${rebotePx}px`);
            balon.style.setProperty('--size', `${sizePx}px`);

            balon.classList.remove('is-jugando');
            void balon.offsetWidth;
            balon.classList.add('is-jugando');
        };

        setTimeout(lanzar, 1200);
        setInterval(lanzar, 30000);
    }

    // ------------------------------------------------------------------ utilidades
    esc(v) {
        return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    toast(mensaje, tipo) {
        let cont = this.$('toast-stack');
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
        t.innerHTML = `<span class="toast__ico"><svg class="icon"><use href="${iconos[tipo]}"/></svg></span><span class="toast__txt"></span><i class="toast__bar"></i>`;
        t.querySelector('.toast__txt').textContent = limpio;
        cont.appendChild(t);
        const quitar = () => { t.classList.add('toast--sale'); setTimeout(() => t.remove(), 300); };
        t.addEventListener('click', quitar);
        setTimeout(quitar, 4200);
    }

    confirmar(titulo, texto, textoBoton = 'Confirmar') {
        return new Promise((resolve) => {
            const ov = document.createElement('div');
            ov.className = 'gis-modal';
            ov.innerHTML = `
                <div class="gis-modal__card" role="alertdialog" aria-modal="true">
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

    infoSuperficie(s) {
        const t = {
            artificial_turf: { label: 'Sintética', color: '#10b981' },
            grass: { label: 'Grama natural', color: '#10b981' },
            asphalt: { label: 'Asfalto', color: '#6366f1' },
            concrete: { label: 'Concreto', color: '#6366f1' },
            paving_stones: { label: 'Adoquín', color: '#6366f1' }
        };
        return t[s] || { label: s ? String(s) : 'Sin dato', color: '#f59e0b' };
    }

    coordsGeom(geom) {
        if (!geom) return null;
        let lat, lng;
        if (geom.type === 'Point') [lng, lat] = geom.coordinates;
        else if (geom.type === 'Polygon' || geom.type === 'MultiPolygon') {
            const c = geom.type === 'Polygon' ? geom.coordinates[0] : geom.coordinates[0][0];
            let sLat = 0, sLng = 0;
            c.forEach((p) => { sLng += p[0]; sLat += p[1]; });
            lng = sLng / c.length; lat = sLat / c.length;
        } else return null;
        return { lat, lng };
    }

    esEventoActivo(ev) {
        const ahora = new Date();
        if (ev.tipo_evento === 'Torneo' && ev.fecha_fin) return new Date(ev.fecha_fin + 'T23:59:59') >= ahora;
        if (ev.fecha_hora) return new Date(ev.fecha_hora) >= ahora;
        return true;
    }

    formatearFecha(valor) {
        if (!valor) return '';
        const soloFecha = /^\d{4}-\d{2}-\d{2}$/.test(String(valor));
        const d = soloFecha ? new Date(String(valor) + 'T00:00:00') : new Date(valor);
        if (isNaN(d)) return '';
        let txt = d.toLocaleDateString('es-CO', { day: 'numeric', month: 'short' }).replace('.', '');
        if (String(valor).includes('T') || String(valor).includes(':'))
            txt += ' · ' + d.toLocaleTimeString('es-CO', { hour: 'numeric', minute: '2-digit' });
        return txt;
    }

    // ------------------------------------------------------------------ pestañas
    initTabs() {
        const pares = [
            ['tab-btn-canchas', 'admin-seccion-canchas'],
            ['tab-btn-analisis', 'admin-seccion-analisis'],
            ['tab-btn-eventos', 'admin-seccion-eventos'],
            ['tab-btn-roles', 'admin-seccion-roles']
        ].map(([t, s]) => [this.$(t), this.$(s)]);
        pares.forEach(([tab]) => tab.addEventListener('click', () => {
            pares.forEach(([t, s]) => { t.classList.toggle('is-active', t === tab); s.classList.toggle('oculto', t !== tab); });
        }));
    }

    // ------------------------------------------------------------------ canchas
    initCanchas() {
        const $ = this.$;
        $('btn-admin-nueva-cancha').addEventListener('click', () => this.abrirFormCancha(null));
        $('btn-admin-volver-lista').addEventListener('click', () => this.vistaCanchas('lista'));
        $('btn-admin-cancelar-cancha').addEventListener('click', () => this.vistaCanchas('lista'));
        $('admin-buscar-cancha').addEventListener('input', () => this.renderListaCanchas());
        $('admin-cancha-imagen').addEventListener('input', () => this.previewImagen());
        $('admin-cancha-foto').addEventListener('change', () => this.previewImagen());
        $('btn-admin-ubicar-mapa').addEventListener('click', () => this.irAlMapa());
        ['admin-cancha-lat', 'admin-cancha-lng'].forEach((id) => $(id).addEventListener('input', () => this.estadoUbicacion()));
        $('form-crear-cancha-admin').addEventListener('submit', (e) => { e.preventDefault(); this.guardarCancha(); });
    }

    async cargarCanchas() {
        const [rC, rB] = await Promise.all([
            this.sb.from('canchas').select('*'),
            this.sb.from('barrios').select('id, nombre')
        ]);
        if (rC.error) {
            this.$('admin-lista-canchas').innerHTML = '<p class="admin-vacio admin-vacio--error">No se pudieron cargar las canchas.</p>';
            return;
        }
        this.listaBarrios = rB.data || [];
        const mb = new Map(this.listaBarrios.map((b) => [b.id, b.nombre]));
        this.datosCanchas = (rC.data || []).map((c) => ({ ...c, barrio: mb.get(c.barrio_id) || 'Sin barrio' }));
        this.renderListaCanchas();
        if (this.adminEventos.length) this.renderEventos();
    }

    vistaCanchas(v) {
        this.$('admin-canchas-lista-vista').classList.toggle('oculto', v !== 'lista');
        this.$('admin-cancha-form-vista').classList.toggle('oculto', v !== 'form');
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    renderListaCanchas() {
        const cont = this.$('admin-lista-canchas');
        const q = (this.$('admin-buscar-cancha').value || '').trim().toLowerCase();
        const todas = this.datosCanchas;
        const lista = todas
            .filter((c) => !q || (c.nombre || '').toLowerCase().includes(q) || (c.barrio || '').toLowerCase().includes(q))
            .sort((a, b) => (a.nombre || '').localeCompare(b.nombre || ''));
        this.$('admin-canchas-contador').textContent = `${lista.length} de ${todas.length} canchas`;
        cont.innerHTML = '';
        if (!lista.length) { cont.innerHTML = '<p class="modal-subtexto">No hay canchas que coincidan con la búsqueda.</p>'; return; }
        lista.forEach((c) => {
            const sup = this.infoSuperficie(c.surface);
            const foto = c.imagen_url ? `<img src="${this.esc(c.imagen_url)}" alt="" loading="lazy" onerror="this.remove()">` : '';
            const fila = document.createElement('div');
            fila.className = 'row-card admin-cancha-row';
            fila.innerHTML = `
                <span class="admin-cancha-row__thumb">${foto}</span>
                <div class="admin-cancha-row__txt">
                    <strong>${this.esc(c.nombre || 'Cancha de fútbol')}</strong>
                    <small><i style="--dot:${sup.color}"></i>${this.esc(sup.label)} · ${this.esc(c.barrio)}</small>
                </div>
                <div class="admin-cancha-row__acc">
                    <button type="button" class="btn btn--secondary btn--sm" data-editar>Editar</button>
                    <button type="button" class="btn btn--peligro-suave btn--sm" data-eliminar>Eliminar</button>
                </div>`;
            fila.querySelector('[data-editar]').addEventListener('click', () => this.abrirFormCancha(c));
            fila.querySelector('[data-eliminar]').addEventListener('click', () => this.eliminarCancha(c.id));
            cont.appendChild(fila);
        });
    }

    previewImagen() {
        const prev = this.$('admin-cancha-preview');
        const archivo = this.$('admin-cancha-foto').files[0];
        const url = this.$('admin-cancha-imagen').value.trim();
        const src = archivo ? URL.createObjectURL(archivo) : url;
        prev.innerHTML = src ? `<img src="${this.esc(src)}" alt="Vista previa" onerror="this.remove()">` : '<span>Sin imagen</span>';
    }

    estadoUbicacion() {
        const lat = parseFloat(this.$('admin-cancha-lat').value.replace(',', '.'));
        const lng = parseFloat(this.$('admin-cancha-lng').value.replace(',', '.'));
        const ok = !isNaN(lat) && !isNaN(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
        const el = this.$('ubic-estado');
        el.classList.toggle('is-ok', ok);
        el.innerHTML = `<svg class="icon"><use href="${ok ? '#i-check' : '#i-pin'}"/></svg><span>${ok ? `Ubicación lista · ${lat.toFixed(5)}, ${lng.toFixed(5)}` : 'Sin ubicación'}</span>`;
    }

    abrirFormCancha(cancha) {
        const $ = this.$;
        $('form-crear-cancha-admin').reset();
        const barrios = [...this.listaBarrios].sort((a, b) => String(a.nombre).localeCompare(String(b.nombre)));
        $('admin-cancha-barrio').innerHTML = '<option value="">Sin barrio</option>' +
            barrios.map((b) => `<option value="${b.id}">${this.esc(b.nombre)}</option>`).join('');
        this.canchaEditando = cancha;
        $('admin-cancha-id').value = cancha ? cancha.id : '';
        $('admin-cancha-form-titulo').textContent = cancha ? 'Editar cancha' : 'Registrar nueva cancha';
        $('btn-admin-guardar-cancha-texto').textContent = cancha ? 'Guardar cambios' : 'Guardar nueva cancha';
        $('mensaje-admin-cancha').textContent = '';
        $('admin-cancha-aviso-geom').classList.add('oculto');

        if (cancha) {
            $('admin-cancha-nombre').value = cancha.nombre || '';
            this.fijarSuperficie(cancha.surface || '');
            $('admin-cancha-barrio').value = cancha.barrio_id ?? '';
            const c = this.coordsGeom(cancha.geometry);
            if (c && !isNaN(c.lat) && !isNaN(c.lng)) {
                $('admin-cancha-lat').value = c.lat.toFixed(6);
                $('admin-cancha-lng').value = c.lng.toFixed(6);
            }
            if (cancha.geometry && cancha.geometry.type !== 'Point') $('admin-cancha-aviso-geom').classList.remove('oculto');
            $('admin-cancha-horario').value = cancha.horario || '';
            $('admin-cancha-imagen').value = cancha.imagen_url || '';
        }
        this.previewImagen();
        this.estadoUbicacion();
        this.vistaCanchas('form');
    }

    fijarSuperficie(valor) {
        const sel = this.$('admin-cancha-surface');
        if (![...sel.options].some((o) => o.value === valor)) sel.add(new Option(valor, valor));
        sel.value = valor;
    }

    // --- Elegir ubicación en el mapa del visor (ida y vuelta) ---
    irAlMapa() {
        const $ = this.$;
        const borrador = {
            id: $('admin-cancha-id').value,
            nombre: $('admin-cancha-nombre').value,
            surface: $('admin-cancha-surface').value,
            barrio: $('admin-cancha-barrio').value,
            horario: $('admin-cancha-horario').value,
            imagen: $('admin-cancha-imagen').value,
            lat: $('admin-cancha-lat').value,
            lng: $('admin-cancha-lng').value
        };
        try {
            sessionStorage.setItem('admin_borrador', JSON.stringify(borrador));
            sessionStorage.removeItem('admin_coords');
        } catch (e) { /* almacenamiento bloqueado: se abre el mapa igual */ }
        location.href = 'index.html?elegir=ubicacion';
    }

    restaurarBorrador() {
        let raw = null, coords = null;
        try {
            raw = sessionStorage.getItem('admin_borrador');
            coords = JSON.parse(sessionStorage.getItem('admin_coords') || 'null');
            sessionStorage.removeItem('admin_borrador');
            sessionStorage.removeItem('admin_coords');
        } catch (e) { return; }
        if (!raw && !coords) return;

        let d = {};
        if (raw) {
            try { d = JSON.parse(raw) || {}; } catch (e) { d = {}; }
        }

        const $ = this.$;
        const cancha = d.id ? (this.datosCanchas.find((c) => c.id == d.id) || null) : null;
        this.abrirFormCancha(cancha);

        if (d.nombre !== undefined) $('admin-cancha-nombre').value = d.nombre || '';
        if (d.surface !== undefined) this.fijarSuperficie(d.surface || '');
        if (d.barrio !== undefined) $('admin-cancha-barrio').value = d.barrio || '';
        if (d.horario !== undefined) $('admin-cancha-horario').value = d.horario || '';
        if (d.imagen !== undefined) $('admin-cancha-imagen').value = d.imagen || '';
        if (d.lat !== undefined) $('admin-cancha-lat').value = d.lat || '';
        if (d.lng !== undefined) $('admin-cancha-lng').value = d.lng || '';

        if (coords && !isNaN(coords.lat) && !isNaN(coords.lng)) {
            $('admin-cancha-lat').value = Number(coords.lat).toFixed(6);
            $('admin-cancha-lng').value = Number(coords.lng).toFixed(6);
            this.toast('Ubicación seleccionada en el mapa.', 'ok');
        }
        this.previewImagen();
        this.estadoUbicacion();
    }

    async guardarCancha() {
        const $ = this.$;
        const msg = $('mensaje-admin-cancha'), boton = $('btn-admin-guardar-cancha');
        const aviso = (t, c) => { msg.textContent = t; msg.style.color = c; };
        const id = $('admin-cancha-id').value, editando = !!id, original = this.canchaEditando;

        const nombre = $('admin-cancha-nombre').value.trim();
        const surface = $('admin-cancha-surface').value || null;
        const barrioId = parseInt($('admin-cancha-barrio').value) || null;
        const lat = parseFloat($('admin-cancha-lat').value.replace(',', '.'));
        const lng = parseFloat($('admin-cancha-lng').value.replace(',', '.'));
        const horario = $('admin-cancha-horario').value.trim();
        let imagenUrl = $('admin-cancha-imagen').value.trim();
        const archivo = $('admin-cancha-foto').files[0];

        if (!nombre) return aviso('Escribe el nombre de la cancha.', '#b3382d');
        if (isNaN(lat) || isNaN(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180)
            return aviso('Ingresa coordenadas válidas o elígelas en el mapa.', '#b3382d');

        boton.disabled = true;
        try {
            aviso(editando ? 'Guardando cambios...' : 'Validando ubicación y registrando...', '#1c6ea4');
            if (archivo) {
                const ext = (archivo.name.split('.').pop() || 'jpg').toLowerCase();
                const ruta = `canchas_fotos/${Date.now()}.${ext}`;
                const { error: eS } = await this.sb.storage.from('evidencias').upload(ruta, archivo);
                if (eS) throw eS;
                imagenUrl = this.sb.storage.from('evidencias').getPublicUrl(ruta).data.publicUrl;
            }
            const datos = { nombre, surface, barrio_id: barrioId, imagen_url: imagenUrl || null };
            const origen = original ? this.coordsGeom(original.geometry) : null;
            const cambio = !editando || !origen || Math.abs(origen.lat - lat) > 2e-6 || Math.abs(origen.lng - lng) > 2e-6;
            if (cambio) datos.geometry = { type: 'Point', coordinates: [lng, lat] };
            if (horario || (original && 'horario' in original)) datos.horario = horario || null;

            let res;
            if (editando) {
                res = await this.sb.from('canchas').update(datos).eq('id', id).select();
                if (!res.error && (!res.data || !res.data.length)) throw new Error('Sin permisos: revisa las políticas (RLS) de UPDATE en la tabla canchas.');
            } else res = await this.sb.from('canchas').insert([datos]);
            if (res.error) throw res.error;

            aviso('', '');
            this.toast(editando ? 'Cancha actualizada con éxito.' : 'Cancha registrada con éxito.', 'ok');
            await this.cargarCanchas();
            this.vistaCanchas('lista');
        } catch (err) {
            console.error(err);
            const t = String(err?.message || err);
            let texto = 'No se pudo guardar la cancha.';
            if (t.includes('validación espacial')) texto = 'Rechazado por PostGIS: la ubicación está fuera de Sabaneta.';
            else if (/horario/i.test(t)) texto = 'La tabla "canchas" no tiene la columna "horario". Déjalo vacío o créala en Supabase.';
            else if (t.includes('permisos')) texto = t;
            aviso(texto, '#b3382d');
        } finally { boton.disabled = false; }
    }

    async eliminarCancha(id) {
        const c = this.datosCanchas.find((x) => x.id == id);
        const ok = await this.confirmar('¿Eliminar esta cancha?', `Se eliminará "${c?.nombre || 'la cancha'}" y sus referencias. Esta acción no se puede deshacer.`, 'Sí, eliminar');
        if (!ok) return;
        const { data, error } = await this.sb.from('canchas').delete().eq('id', id).select();
        if (error || !data || !data.length) {
            this.toast(error?.code === '23503' ? 'La cancha tiene eventos, calificaciones o evidencias asociados.' : 'No se pudo eliminar la cancha.', 'error');
            return;
        }
        this.toast('Cancha eliminada con éxito.', 'ok');
        await this.cargarCanchas();
    }

    // ------------------------------------------------------------------ análisis GIS
    initGis() {
        this.$('btn-recalcular-gdal').addEventListener('click', () => this.recalcularGis());
        this.$('btn-alertas').addEventListener('click', () => this.cargarAlertas());
    }

    crearBuffer(lng, lat, radioM, pasos = 48) {
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

    async subirGeoJson(nombre, objeto) {
        const blob = new Blob([JSON.stringify(objeto)], { type: 'application/geo+json' });
        const { error } = await this.sb.storage.from('evidencias')
            .upload(nombre, blob, { upsert: true, contentType: 'application/geo+json', cacheControl: '0' });
        if (error) throw new Error(`No se pudo subir ${nombre}: ${error.message}`);
    }

    async generarAnalisis(onPaso) {
        onPaso(0);
        const [rC, rCal, rEv, rPar] = await Promise.all([
            this.sb.from('canchas').select('*'),
            this.sb.from('calificaciones_cancha').select('cancha_id, puntuacion'),
            this.sb.from('eventos').select('id, cancha_id, tipo_evento'),
            this.sb.from('participantes_evento').select('evento_id')
        ]);
        const fallo = [rC, rCal, rEv, rPar].find((r) => r.error);
        if (fallo) throw new Error('Error leyendo datos: ' + fallo.error.message);

        const personasEv = {};
        (rPar.data || []).forEach((p) => { personasEv[p.evento_id] = (personasEv[p.evento_id] || 0) + 1; });
        const personasCa = {}, eventosCa = {};
        (rEv.data || []).forEach((ev) => {
            personasCa[ev.cancha_id] = (personasCa[ev.cancha_id] || 0) + (personasEv[ev.id] || 0);
            eventosCa[ev.cancha_id] = (eventosCa[ev.cancha_id] || 0) + 1;
        });
        const calif = {};
        (rCal.data || []).forEach((c) => {
            const a = calif[c.cancha_id] || (calif[c.cancha_id] = { suma: 0, n: 0 });
            a.suma += c.puntuacion; a.n += 1;
        });

        onPaso(1);
        const zonas = [], analisis = [];
        const resumen = { canchas: 0, alta: 0, mantenimiento: 0, tranquila: 0 };
        (rC.data || []).forEach((c) => {
            const centro = this.coordsGeom(c.geometry);
            if (!centro || isNaN(centro.lat) || isNaN(centro.lng)) return;
            const personas = personasCa[c.id] || 0, nEv = eventosCa[c.id] || 0;
            let nivel = 'ZONA_TRANQUILA', indice = 'Bajo';
            if (personas >= 20 || nEv >= 5) { nivel = 'ALTA_INVERSION'; indice = 'Alto'; resumen.alta++; }
            else if (personas >= 5 || nEv >= 2) { nivel = 'MANTENIMIENTO'; indice = 'Medio'; resumen.mantenimiento++; }
            else resumen.tranquila++;
            resumen.canchas++;
            const radio = Math.max(personas * 3, 25);
            zonas.push({ type: 'Feature', properties: { cancha_id: c.id, nombre: c.nombre || 'Cancha', total_eventos: nEv, prioridad_inversion: nivel, radio_buffer_m: radio }, geometry: this.crearBuffer(centro.lng, centro.lat, radio) });
            const cal = calif[c.id];
            analisis.push({ type: 'Feature', properties: { cancha_id: c.id, nombre: c.nombre || 'Cancha', promedio_est: cal ? +(cal.suma / cal.n).toFixed(1) : 0, num_opiniones: cal ? cal.n : 0, num_eventos: nEv, indice_uso: indice }, geometry: { type: 'Point', coordinates: [centro.lng, centro.lat] } });
        });

        onPaso(2);
        await this.subirGeoJson('zonas_influencia_admin.geojson', { type: 'FeatureCollection', features: zonas });
        await this.subirGeoJson('canchas_analisis_gdal.geojson', { type: 'FeatureCollection', features: analisis });
        return resumen;
    }

    mostrarProceso() {
        const pasos = ['Leyendo canchas, eventos y calificaciones', 'Calculando zonas de influencia (buffers)', 'Publicando capas en Supabase Storage', 'Finalizando'];
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
                items.forEach((li, k) => { li.classList.toggle('is-done', k < i); li.classList.toggle('is-active', k === i); });
                barra.style.width = `${Math.round(((i + .4) / pasos.length) * 100)}%`;
            },
            ok: (r) => {
                items.forEach((li) => { li.classList.remove('is-active'); li.classList.add('is-done'); });
                barra.style.width = '100%';
                ov.classList.add('gis-proceso--ok');
                titulo.textContent = '¡Análisis actualizado!';
                sub.textContent = 'Las capas ya están publicadas. El visor mostrará los datos más recientes.';
                const tarjetas = [['Canchas analizadas', r.canchas, 'total'], ['Alta inversión', r.alta, 'alta'], ['Mantenimiento', r.mantenimiento, 'media'], ['Zona tranquila', r.tranquila, 'baja']];
                res.innerHTML = `<div class="gis-kpis">${tarjetas.map(([l, v, c], i) => `<div class="gis-kpi gis-kpi--${c}" style="--d:${i * 90}ms"><b data-n="${v}">0</b><span>${l}</span></div>`).join('')}</div>
                    <div class="gis-resultado__acciones">
                        <button type="button" class="btn btn--ghost" data-a="cerrar">Seguir en el panel</button>
                        <button type="button" class="btn btn--primary" data-a="mapa">Ver en el mapa</button>
                    </div>`;
                res.hidden = false;
                res.querySelectorAll('b[data-n]').forEach((b) => {
                    const fin = +b.dataset.n, t0 = performance.now();
                    const tick = (t) => { const p = Math.min((t - t0) / 700, 1); b.textContent = Math.round(fin * (1 - Math.pow(1 - p, 3))); if (p < 1) requestAnimationFrame(tick); };
                    requestAnimationFrame(tick);
                });
                res.addEventListener('click', (e) => {
                    const a = e.target.closest('[data-a]');
                    if (!a) return;
                    if (a.dataset.a === 'mapa') location.href = 'index.html#mapa';
                    else cerrar();
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

    async recalcularGis() {
        const btn = this.$('btn-recalcular-gdal');
        btn.disabled = true;
        const ui = this.mostrarProceso();
        const pausa = (ms) => new Promise((r) => setTimeout(r, ms));
        try {
            const resumen = await this.generarAnalisis((i) => ui.paso(i));
            await pausa(350);
            ui.paso(3);
            await this.cargarAlertas(true);
            await pausa(450);
            this.$('gis-ultima-act').textContent = 'Última actualización: ' + new Date().toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' });
            ui.ok(resumen);
        } catch (err) {
            console.error(err);
            ui.error(err.message || String(err));
        } finally { btn.disabled = false; }
    }

    async cargarAlertas(silencioso = false) {
        const cont = this.$('lista-alertas-desgaste'), boton = this.$('btn-alertas');
        const original = boton.innerHTML;
        boton.disabled = true; boton.classList.add('is-cargando');
        boton.innerHTML = '<svg class="icon"><use href="#i-refresh"/></svg> Consultando…';
        cont.innerHTML = '<div class="alerta-skel"></div><div class="alerta-skel"></div><div class="alerta-skel"></div>';

        const inicio = Date.now();
        const { data, error } = await this.sb.from('alertas_desgaste')
            .select('id, total_participantes, distancia_via_principal_m, nivel_alerta, fecha_alerta, canchas ( nombre )')
            .order('fecha_alerta', { ascending: false }).limit(10);
        const espera = 500 - (Date.now() - inicio);
        if (espera > 0) await new Promise((r) => setTimeout(r, espera));

        boton.disabled = false; boton.classList.remove('is-cargando'); boton.innerHTML = original;

        if (error) {
            console.error(error);
            cont.innerHTML = '<p class="admin-vacio admin-vacio--error">No se pudieron cargar las alertas de desgaste.</p>';
            if (!silencioso) this.toast('❌ No se pudieron cargar las alertas.');
            return;
        }
        if (!data || !data.length) {
            cont.innerHTML = '<p class="admin-vacio">Aún no hay alertas de desgaste registradas.</p>';
            if (!silencioso) this.toast('Sin alertas nuevas por ahora.', 'aviso');
            return;
        }
        const nivel = (txt) => {
            const t = String(txt || '').toUpperCase();
            if (t.includes('CRÍTICO') || t.includes('CRITICO')) return 'critica';
            if (t.includes('MEDIO') || t.includes('MODERADO') || t.includes('ALTO')) return 'media';
            return 'baja';
        };
        cont.innerHTML = '';
        data.forEach((a, i) => {
            const card = document.createElement('div');
            card.className = `alerta-card alerta-card--${nivel(a.nivel_alerta)}`;
            card.style.animationDelay = `${i * 40}ms`;
            card.innerHTML = `
                <div class="alerta-card__top">
                    <b><svg class="icon"><use href="#i-pin"/></svg>${this.esc(a.canchas ? a.canchas.nombre : 'Cancha desconocida')}</b>
                    <span class="alerta-card__fecha">${this.esc(a.fecha_alerta ? new Date(a.fecha_alerta).toLocaleString('es-CO') : '')}</span>
                </div>
                <p>${this.esc(a.nivel_alerta)}</p>
                <div class="alerta-card__chips">
                    <span><svg class="icon"><use href="#i-users"/></svg>${Number(a.total_participantes) || 0} participantes</span>
                    <span><svg class="icon"><use href="#i-road"/></svg>${this.esc(a.distancia_via_principal_m)} m a la vía</span>
                </div>`;
            cont.appendChild(card);
        });
        if (!silencioso) this.toast(`Alertas actualizadas (${data.length}).`, 'ok');
    }

    // ------------------------------------------------------------------ eventos
    async cargarEventos() {
        const cont = this.$('admin-lista-eventos');
        cont.innerHTML = '<div class="alerta-skel"></div><div class="alerta-skel"></div><div class="alerta-skel"></div>';
        const { data, error } = await this.sb.from('eventos').select('*');
        if (error) { console.error(error); cont.innerHTML = '<p class="admin-vacio admin-vacio--error">No se pudieron cargar los eventos.</p>'; return; }
        this.adminEventos = data || [];
        this.prepararBarraEventos();
        this.renderEventos();
    }

    prepararBarraEventos() {
        const lista = this.$('admin-lista-eventos');
        if (this.$('admin-eventos-barra')) return;
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
        barra.querySelector('#admin-eventos-buscar').addEventListener('input', (e) => { this.adminEventosFiltro.texto = e.target.value.trim().toLowerCase(); this.renderEventos(); });
        barra.querySelectorAll('[data-estado]').forEach((b) => b.addEventListener('click', () => {
            this.adminEventosFiltro.estado = b.dataset.estado;
            barra.querySelectorAll('[data-estado]').forEach((x) => x.classList.toggle('is-on', x === b));
            this.renderEventos();
        }));
    }

    renderEventos() {
        const cont = this.$('admin-lista-eventos');
        const f = this.adminEventosFiltro, todos = this.adminEventos;
        const tipos = {
            'Torneo': { clase: 'torneo', icono: '#i-trophy', etiqueta: 'Torneo' },
            'Partido Recreativo': { clase: 'recreativo', icono: '#i-users', etiqueta: 'Recreativo' },
            'Reto / Apostado': { clase: 'reto', icono: '#i-target', etiqueta: 'Reto' }
        };
        const lista = todos.filter((ev) => {
            const activo = this.esEventoActivo(ev);
            if (f.estado === 'activo' && !activo) return false;
            if (f.estado === 'finalizado' && activo) return false;
            if (!f.texto) return true;
            const cancha = this.datosCanchas.find((c) => c.id == ev.cancha_id);
            return [ev.titulo, ev.tipo_evento, ev.contacto, ev.descripcion, cancha?.nombre].join(' ').toLowerCase().includes(f.texto);
        });
        const resumen = this.$('admin-eventos-resumen');
        if (resumen) {
            const activos = todos.filter((ev) => this.esEventoActivo(ev)).length;
            resumen.innerHTML = `<b>${todos.length}</b> en total · <b class="ok">${activos}</b> activos · <b class="fin">${todos.length - activos}</b> finalizados`;
        }
        if (!lista.length) { cont.innerHTML = '<p class="admin-vacio">No hay eventos que coincidan con la búsqueda.</p>'; return; }
        cont.innerHTML = '';
        lista.forEach((ev, i) => {
            const t = tipos[ev.tipo_evento] || { clase: 'recreativo', icono: '#i-users', etiqueta: ev.tipo_evento || 'Evento' };
            const activo = this.esEventoActivo(ev);
            const cancha = this.datosCanchas.find((c) => c.id == ev.cancha_id);
            const titulo = this.esc(ev.titulo || ev.tipo_evento || 'Evento');
            let cuando = '';
            if (ev.tipo_evento === 'Torneo' && ev.fecha_inicio) {
                cuando = this.formatearFecha(ev.fecha_inicio);
                if (ev.fecha_fin && ev.fecha_fin !== ev.fecha_inicio) cuando += ' → ' + this.formatearFecha(ev.fecha_fin);
            } else if (ev.fecha_hora) cuando = this.formatearFecha(ev.fecha_hora);
            const media = ev.banner_url ? `<img src="${this.esc(ev.banner_url)}" alt="" loading="lazy" decoding="async" onerror="this.remove()">` : '';
            const fila = document.createElement('article');
            fila.className = `admin-evt admin-evt--${t.clase}${activo ? '' : ' is-fin'}`;
            fila.style.animationDelay = `${Math.min(i, 8) * 35}ms`;
            fila.innerHTML = `
                <div class="admin-evt__media"><svg class="icon"><use href="${t.icono}"/></svg>${media}</div>
                <div class="admin-evt__cuerpo">
                    <div class="admin-evt__tit"><strong>${titulo}</strong>
                        <span class="admin-evt__pill ${activo ? 'is-activo' : 'is-fin'}">${activo ? 'Activo' : 'Finalizado'}</span></div>
                    <div class="admin-evt__meta">
                        <span class="admin-evt__tipo">${this.esc(t.etiqueta)}</span>
                        <span><svg class="icon"><use href="#i-pin"/></svg>${this.esc(cancha?.nombre || 'Cancha sin identificar')}</span>
                        ${cuando ? `<span><svg class="icon"><use href="#i-check"/></svg>${this.esc(cuando)}</span>` : ''}
                        <span><svg class="icon"><use href="#i-users"/></svg>${this.esc(ev.contacto || 'Sin contacto')}</span>
                    </div>
                </div>
                <button type="button" class="btn btn--peligro-suave btn--sm admin-evt__borrar" aria-label="Borrar ${titulo}"><svg class="icon"><use href="#i-x"/></svg>Borrar</button>`;
            fila.querySelector('.admin-evt__borrar').addEventListener('click', () => this.eliminarEvento(ev.id));
            cont.appendChild(fila);
        });
    }

    async eliminarEvento(id) {
        const ok = await this.confirmar('¿Eliminar este evento?', 'Se eliminará el torneo o evento de forma definitiva. Esta acción no se puede deshacer.', 'Sí, eliminar');
        if (!ok) return;
        const { data, error } = await this.sb.from('eventos').delete().eq('id', id).select();
        if (error) { console.error(error); return this.toast('❌ Error al eliminar: ' + (error.message || 'desconocido')); }
        if (!data || !data.length) return this.toast('❌ La base de datos no permitió borrar el evento (revisa las políticas de la tabla eventos).');
        this.toast('✅ Evento eliminado.');
        await this.cargarEventos();
    }

    // ------------------------------------------------------------------ participantes
    initParticipantes() {
        const $ = this.$;
        $('form-buscar').addEventListener('submit', (e) => { e.preventDefault(); this.perm.pagina = 1; this.buscarParticipantes(false); });
        $('btn-limpiar').addEventListener('click', () => this.limpiarParticipantes());
        document.querySelectorAll('.part-kpi').forEach((k) => k.addEventListener('click', () => {
            if (!k.dataset.rol) return this.limpiarParticipantes();
            $('f-rol').value = k.dataset.rol;
            this.perm.pagina = 1;
            this.buscarParticipantes(false);
        }));
        const ir = (p) => { this.perm.pagina = p; this.buscarParticipantes(true); };
        const ultima = () => Math.max(1, Math.ceil(this.perm.total / this.perm.tam));
        $('part-first').addEventListener('click', () => ir(1));
        $('part-prev').addEventListener('click', () => ir(Math.max(1, this.perm.pagina - 1)));
        $('part-next').addEventListener('click', () => ir(Math.min(ultima(), this.perm.pagina + 1)));
        $('part-last').addEventListener('click', () => ir(ultima()));
        $('part-tam').addEventListener('change', (e) => {
            this.perm.tam = parseInt(e.target.value) || 10;
            this.perm.pagina = 1;
            if (this.perm.filtros) this.buscarParticipantes(true);
        });
    }

    limpiarTexto(s) { return s.trim().replace(/[,()*%_\\]/g, ' ').replace(/\s+/g, ' '); }

    leerFiltros() {
        const $ = this.$;
        return {
            role: $('f-rol').value,
            nombre: this.limpiarTexto($('f-nombre').value),
            apellidos: this.limpiarTexto($('f-apellidos').value),
            telefono: this.limpiarTexto($('f-telefono').value).replace(/\s/g, ''),
            email: this.limpiarTexto($('f-correo').value)
        };
    }

    limpiarParticipantes() {
        this.$('form-buscar').reset();
        this.$('part-msg').textContent = '';
        this.perm.filtros = null; this.perm.total = 0; this.perm.pagina = 1;
        this.pintarVacio('No se encontraron registros', 'Rellena al menos un campo y pulsa «Buscar Participante».');
    }

    pintarVacio(titulo, sub, error = false) {
        this.$('part-tbody').innerHTML = `<tr><td colspan="5"><div class="part-vacio${error ? ' part-vacio--error' : ''}">
            <svg class="icon"><use href="${error ? '#i-x' : '#i-inbox'}"/></svg><strong>${this.esc(titulo)}</strong><span>${this.esc(sub)}</span></div></td></tr>`;
        this.actualizarPie();
    }

    actualizarPie() {
        const { pagina, tam, total } = this.perm;
        const ultima = Math.max(1, Math.ceil(total / tam));
        const a = total ? (pagina - 1) * tam + 1 : 0;
        const b = Math.min(pagina * tam, total);
        this.$('part-resumen').textContent = `Mostrando ${a} a ${b} de ${total} registros`;
        this.$('part-pagina').textContent = `Página ${pagina} de ${ultima}`;
        this.$('part-first').disabled = this.$('part-prev').disabled = pagina <= 1;
        this.$('part-next').disabled = this.$('part-last').disabled = pagina >= ultima;
    }

    async buscarParticipantes(reusar) {
        const msg = this.$('part-msg');
        let f = this.perm.filtros;
        if (!reusar || !f) {
            f = this.leerFiltros();
            if (!Object.values(f).some(Boolean)) {
                msg.style.color = '#b3382d';
                msg.textContent = 'Debes rellenar al menos un campo para realizar la búsqueda.';
                return;
            }
            this.perm.filtros = f;
        }
        msg.textContent = '';

        this.$('part-tbody').innerHTML = [1, 2, 3].map(() => '<tr><td colspan="5"><div class="alerta-skel" style="height:46px;margin:0"></div></td></tr>').join('');

        const { pagina, tam } = this.perm;
        const desde = (pagina - 1) * tam;
        let q = this.sb.from('profiles')
            .select('id, email, role, nombre, apellidos, telefono', { count: 'exact' })
            .order('email').range(desde, desde + tam - 1);
        if (f.role) q = q.eq('role', f.role);
        if (f.nombre) q = q.ilike('nombre', `%${f.nombre}%`);
        if (f.apellidos) q = q.ilike('apellidos', `%${f.apellidos}%`);
        if (f.telefono) q = q.ilike('telefono', `%${f.telefono}%`);
        if (f.email) q = q.ilike('email', `%${f.email}%`);

        const [{ data, error, count }] = await Promise.all([q, new Promise((r) => setTimeout(r, 300))]);
        if (error) {
            this.perm.total = 0;
            this.pintarVacio('No se pudo realizar la búsqueda', error.message, true);
            return;
        }
        this.perm.total = count ?? (data || []).length;
        if (!(data || []).length && this.perm.total > 0 && pagina > 1) {
            this.perm.pagina = Math.max(1, Math.ceil(this.perm.total / tam));
            return this.buscarParticipantes(true);
        }
        if (!(data || []).length) return this.pintarVacio('No se encontraron registros', 'Prueba con otro nombre, teléfono o correo.');
        this.pintarFilas(data);
        this.actualizarPie();
    }

    pintarFilas(lista) {
        const tbody = this.$('part-tbody');
        tbody.innerHTML = '';
        lista.forEach((u, i) => {
            const esAdmin = u.role === 'admin';
            const nombre = [u.nombre, u.apellidos].filter(Boolean).join(' ') || '(sin nombre)';
            const inicial = (u.nombre || u.email || '?').trim().charAt(0).toUpperCase();
            const yo = u.id === this.yoId;
            const tr = document.createElement('tr');
            tr.className = 'part-fila';
            tr.style.animationDelay = `${Math.min(i, 10) * 25}ms`;
            tr.innerHTML = `
                <td><div class="part-persona">
                    <span class="part-avatar${esAdmin ? ' is-admin' : ''}">${this.esc(inicial)}</span>
                    <strong>${this.esc(nombre)}${yo ? '<span class="part-tu">Tú</span>' : ''}</strong>
                </div></td>
                <td>${u.email ? this.esc(u.email) : '<span class="part-celda-vacia">Sin correo</span>'}</td>
                <td>${u.telefono ? this.esc(u.telefono) : '<span class="part-celda-vacia">Sin teléfono</span>'}</td>
                <td><span class="part-rol${esAdmin ? ' is-admin' : ''}"><svg class="icon"><use href="${esAdmin ? '#i-shield' : '#i-user'}"/></svg>${esAdmin ? 'Administrador' : 'Usuario'}</span></td>
                <td class="part-acc"><button type="button" class="btn btn--sm ${esAdmin ? 'btn--secondary' : 'btn--primary'}" ${yo ? 'disabled title="No puedes cambiar tu propio rol"' : ''}>${esAdmin ? 'Hacer usuario' : 'Hacer admin'}</button></td>`;
            tr.querySelector('button').addEventListener('click', () => this.cambiarRol(u));
            tbody.appendChild(tr);
        });
    }

    async cambiarRol(u) {
        const nuevo = u.role === 'admin' ? 'user' : 'admin';
        const ok = await this.confirmar(
            nuevo === 'admin' ? '¿Dar permisos de administrador?' : '¿Quitar permisos de administrador?',
            `${u.email} pasará a ser ${nuevo === 'admin' ? 'administrador' : 'usuario estándar'}.`,
            'Sí, cambiar'
        );
        if (!ok) return;
        const { data, error } = await this.sb.from('profiles').update({ role: nuevo }).eq('id', u.id).select();
        if (error || !data || !data.length) {
            this.toast('❌ No se pudo cambiar el rol' + (error ? ': ' + error.message : ' (revisa las políticas de profiles).'));
            return;
        }
        this.toast(`✅ Rol actualizado a ${nuevo === 'admin' ? 'administrador' : 'usuario'}.`);
        this.cargarKpis();
        this.buscarParticipantes(true);
    }

    async cargarKpis() {
        const cuenta = async (rol) => {
            let q = this.sb.from('profiles').select('id', { count: 'exact', head: true });
            if (rol) q = q.eq('role', rol);
            const { count } = await q;
            return count ?? '–';
        };
        const [t, u, a] = await Promise.all([cuenta(''), cuenta('user'), cuenta('admin')]);
        this.$('kpi-total').textContent = t;
        this.$('kpi-user').textContent = u;
        this.$('kpi-admin').textContent = a;
    }
}

window.addEventListener('DOMContentLoaded', () => { window.adminApp = new AdminApp(); });