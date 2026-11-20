/* ==========================================================================
   Pantalla de carga del visor · Sabaneta en la jugada
   Aparece 5 segundos cada vez que alguien entra al visor (invitado, usuario
   o administrador): un jugador corre con el balón mientras una barra va de
   0 a 100 %.

   No depende de app.js: vigila la pantalla de bienvenida (#intro-overlay) y
   arranca cuando esta se cierra, sea cual sea el camino (invitado, login,
   registro, sesión ya iniciada o enlace desde un correo).

   Instalación: en index.html, justo ANTES de <script src="app.js">:
       <script src="carga-visor.js"></script>
   (carga sola styles-carga.css, que debe estar en la misma carpeta)
   ========================================================================== */
(function () {
    'use strict';

    var DURACION_MS = 2000;   // tiempo total de la pantalla de carga
    var iniciada = false;

    // Carga la hoja de estilos que está junto a este script
    try {
        var actual = document.currentScript && document.currentScript.src;
        var href = actual ? actual.replace(/carga-visor\.js(\?.*)?$/, 'styles-carga.css') : 'styles-carga.css';
        var link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = href;
        document.head.appendChild(link);
    } catch (e) { /* si falla, la pantalla simplemente no se verá estilizada */ }

    var FRASES = [
        [0, 'Calentando en la cancha…'],
        [28, 'Cargando canchas y eventos…'],
        [58, 'Trazando las rutas…'],
        [86, '¡Listo para jugar!']
    ];

    function construir() {
        var el = document.createElement('div');
        el.id = 'pantalla-carga';
        el.className = 'carga';
        el.setAttribute('role', 'status');
        el.setAttribute('aria-live', 'polite');
        el.innerHTML =
            '<div class="carga__lineas" aria-hidden="true"></div>' +
            '<div class="carga__centro">' +
              '<img class="carga__logo" src="img/logo.png" alt="" onerror="this.remove()">' +
              '<svg class="carga__escena" viewBox="0 0 320 170" aria-hidden="true">' +
                '<defs><clipPath id="carga-balon-clip"><circle cx="0" cy="0" r="10"/></clipPath></defs>' +
                // rayas de velocidad
                '<g class="cg-viento" stroke="rgba(255,255,255,.55)" stroke-width="2.4" stroke-linecap="round">' +
                  '<path d="M60 58H92"/><path d="M40 82H84"/><path d="M70 104H98"/>' +
                '</g>' +
                // suelo: línea de cal que se desplaza
                '<line x1="10" y1="146" x2="310" y2="146" stroke="rgba(255,255,255,.35)" stroke-width="2"/>' +
                '<line class="cg-suelo" x1="-20" y1="154" x2="340" y2="154" stroke="rgba(240,196,25,.55)" stroke-width="3" stroke-dasharray="16 22" stroke-linecap="round"/>' +
                '<ellipse class="cg-sombra" cx="150" cy="147" rx="34" ry="4.5" fill="rgba(0,0,0,.35)"/>' +
                // jugador (mira a la derecha)
                '<g class="cg-jugador">' +
                  // brazo trasero
                  '<g class="cg-brazo cg-brazo--b"><path d="M158 42 L158 62" stroke="#d9a574" stroke-width="7" stroke-linecap="round"/>' +
                     '<g class="cg-antebrazo"><path d="M158 62 L158 80" stroke="#d9a574" stroke-width="6.5" stroke-linecap="round"/></g></g>' +
                  // pierna trasera
                  '<g class="cg-muslo cg-muslo--b"><path d="M150 76 L150 104" stroke="#f5f7f6" stroke-width="12" stroke-linecap="round"/>' +
                     '<g class="cg-pierna"><path d="M150 104 L150 132" stroke="#d9a574" stroke-width="8" stroke-linecap="round"/>' +
                     '<path d="M150 132 L161 134" stroke="#151c19" stroke-width="8" stroke-linecap="round"/></g></g>' +
                  // torso con camiseta
                  '<path d="M148 76 L158 42" stroke="#f0c419" stroke-width="17" stroke-linecap="round"/>' +
                  '<path d="M146 78 L151 62" stroke="#1f7a4d" stroke-width="4" stroke-linecap="round" opacity=".55"/>' +
                  // pantaloneta
                  '<rect x="140" y="70" width="22" height="13" rx="5" fill="#f5f7f6"/>' +
                  // cabeza
                  '<circle cx="164" cy="25" r="10" fill="#d9a574"/>' +
                  '<path d="M154 22 C156 12 170 11 174 20 C168 16 160 17 154 22Z" fill="#2b1d12"/>' +
                  // pierna delantera
                  '<g class="cg-muslo cg-muslo--a"><path d="M150 76 L150 104" stroke="#f5f7f6" stroke-width="12" stroke-linecap="round"/>' +
                     '<g class="cg-pierna"><path d="M150 104 L150 132" stroke="#d9a574" stroke-width="8" stroke-linecap="round"/>' +
                     '<path d="M150 132 L161 134" stroke="#151c19" stroke-width="8" stroke-linecap="round"/></g></g>' +
                  // brazo delantero
                  '<g class="cg-brazo cg-brazo--a"><path d="M158 42 L158 62" stroke="#f0c419" stroke-width="8" stroke-linecap="round"/>' +
                     '<g class="cg-antebrazo"><path d="M158 62 L158 80" stroke="#d9a574" stroke-width="6.5" stroke-linecap="round"/></g></g>' +
                '</g>' +
                // balón
                '<g class="cg-balon-pos"><g class="cg-balon-bota"><g class="cg-balon">' +
                  '<circle r="10" fill="#fff"/>' +
                  '<g clip-path="url(#carga-balon-clip)" fill="#11261f"><polygon points="0,-4.5 4.3,-1.4 2.6,3.6 -2.6,3.6 -4.3,-1.4"/>' +
                  '<circle cx="0" cy="11" r="3.6"/><circle cx="10" cy="-5" r="3.6"/><circle cx="-10" cy="-5" r="3.6"/></g>' +
                  '<circle r="10" fill="none" stroke="#11261f" stroke-width="1.6"/>' +
                '</g></g></g>' +
              '</svg>' +
              '<p class="carga__titulo">Cargando<span class="carga__puntos"><i>.</i><i>.</i><i>.</i></span></p>' +
              '<p class="carga__pct"><b id="carga-pct">0</b>%</p>' +
              '<div class="carga__barra" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">' +
                '<span class="carga__relleno"><i class="carga__bola"></i></span>' +
              '</div>' +
              '<p class="carga__frase" id="carga-frase">' + FRASES[0][1] + '</p>' +
            '</div>';
        return el;
    }

    function iniciar() {
        if (iniciada || !document.body) return;
        iniciada = true;

        var el = construir();
        document.body.appendChild(el);
        document.body.classList.add('carga-activa');

        var relleno = el.querySelector('.carga__relleno');
        var pct = el.querySelector('#carga-pct');
        var barra = el.querySelector('.carga__barra');
        var frase = el.querySelector('#carga-frase');
        var fraseActual = 0;
        var t0 = null;

        // Avance casi lineal con pequeños "tirones" para que se sienta real
        function progreso(t) {
            var x = Math.min(1, t / DURACION_MS);
            return Math.min(1, x + Math.sin(x * Math.PI * 6) * 0.018 * (1 - x));
        }

        function paso(ahora) {
            if (t0 === null) t0 = ahora;
            var t = ahora - t0;
            var p = t >= DURACION_MS ? 1 : Math.max(0, progreso(t));
            var n = Math.round(p * 100);
            relleno.style.width = (p * 100) + '%';
            pct.textContent = n;
            barra.setAttribute('aria-valuenow', n);

            for (var i = FRASES.length - 1; i >= 0; i--) {
                if (n >= FRASES[i][0]) {
                    if (i !== fraseActual) { fraseActual = i; frase.textContent = FRASES[i][1]; }
                    break;
                }
            }

            if (t < DURACION_MS) requestAnimationFrame(paso);
            else terminar();
        }

        function terminar() {
            el.classList.add('carga--listo');
            setTimeout(function () {
                el.classList.add('carga--sale');
                document.body.classList.remove('carga-activa');
                // el mapa pudo medirse mientras estaba tapado
                try {
                    var app = window.mapApp || window.mapViewer;
                    if (app && app.map) {
                        app.map.invalidateSize({ pan: false });
                        setTimeout(function () { app.map.invalidateSize({ pan: false }); }, 250);
                    }
                } catch (e) { /* ignorar */ }
                setTimeout(function () { el.remove(); }, 500);
            }, 350);
        }

        requestAnimationFrame(paso);
    }

    // ---- Detecta cuándo se cierra la pantalla de bienvenida ----
    function bienvenidaCerrada(ov) {
        return ov.classList.contains('fade-out') || ov.classList.contains('oculto');
    }

    function vigilar() {
        var ov = document.getElementById('intro-overlay');
        if (!ov) { iniciar(); return; }          // sin pantalla de bienvenida: entra directo
        if (bienvenidaCerrada(ov)) { iniciar(); return; }
        var obs = new MutationObserver(function () {
            if (bienvenidaCerrada(ov)) { obs.disconnect(); iniciar(); }
        });
        obs.observe(ov, { attributes: true, attributeFilter: ['class'] });
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', vigilar);
    else vigilar();
})();
