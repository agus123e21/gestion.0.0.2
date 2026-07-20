/**
 * TerMate — Sistema de Gestión de Rutas y Logística para Camiones
 * v2.1 — Refinado Profesional, Geocodificación Federal, Cero Emojis
 */
(function () {
    'use strict';

    // ═══════════════════════════════════════════════════════════
    // 1. ESTADO GLOBAL
    // ═══════════════════════════════════════════════════════════
    let envios = [];
    let contadorId = 1;
    
    // Mapas
    let mapaFull = null;
    let mapaInline = null;
    let marcadoresFull = {};
    let marcadoresInline = {};
    let polylinesFull = {};
    let polylinesInline = {};
    
    let idEnvioEditando = null;
    let idEnvioDetalle = null;
    let filtroEstado = 'todos';
    let filtroBuscar = '';
    let rutaPendiente = null;

    // Camiones registrados
    let camiones = [];
    let contadorCamiones = 1;
    let camionEditandoId = null;

    const KEY_GEO_CACHE = 'termate_geo_cache';
    const KEY_ENVIOS     = 'termate_envios';
    const KEY_CONTADOR   = 'termate_contador';
    const KEY_CAMIONES   = 'termate_camiones';
    const KEY_CONT_CAM   = 'termate_cont_camiones';
    const cacheGeo = JSON.parse(localStorage.getItem(KEY_GEO_CACHE) || '{}');

    const ORS_BASE = 'https://api.openrouteservice.org/v2';
    const ORS_API_KEY = ''; // Coloca tu API key aquí si lo prefieres

    // ═══════════════════════════════════════════════════════════
    // 2. REGISTRO SERVICE WORKER (PWA)
    // ═══════════════════════════════════════════════════════════
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('./sw.js')
            .catch(err => console.warn('[SW] Error registro:', err));
    }

    // ═══════════════════════════════════════════════════════════
    // 3. INDICADOR DE CONEXIÓN
    // ═══════════════════════════════════════════════════════════
    function actualizarConexion() {
        const online = navigator.onLine;
        const badges = [
            document.getElementById('indicador-conexion'),
            document.getElementById('indicador-conexion-sidebar')
        ];
        
        badges.forEach(b => {
            if (!b) return;
            b.className = `conexion-pill ${online ? 'online' : 'offline'}`;
            const txt = b.querySelector('.conexion-texto');
            if (txt) txt.textContent = online ? 'Online' : 'Sin red';
        });
    }

    window.addEventListener('online', () => {
        actualizarConexion();
        showToast('Conexión reestablecida.', 'success');
    });
    window.addEventListener('offline', () => {
        actualizarConexion();
        showToast('Modo sin conexión activado.', 'warning');
    });

    // ═══════════════════════════════════════════════════════════
    // 4. PERSISTENCIA
    // ═══════════════════════════════════════════════════════════
    function guardar() {
        try {
            localStorage.setItem(KEY_ENVIOS, JSON.stringify(envios));
            localStorage.setItem(KEY_CONTADOR, String(contadorId));
            localStorage.setItem(KEY_CAMIONES, JSON.stringify(camiones));
            localStorage.setItem(KEY_CONT_CAM, String(contadorCamiones));
        } catch {
            showToast('Almacenamiento lleno. Elimina rutas viejas.', 'error');
        }
    }

    function guardarGeoCache() {
        try {
            localStorage.setItem(KEY_GEO_CACHE, JSON.stringify(cacheGeo));
        } catch {}
    }

    function cargarDatos() {
        try {
            const e = localStorage.getItem(KEY_ENVIOS);
            if (e) envios = JSON.parse(e);
            const c = localStorage.getItem(KEY_CONTADOR);
            if (c) contadorId = parseInt(c, 10);
            const ca = localStorage.getItem(KEY_CAMIONES);
            if (ca) camiones = JSON.parse(ca);
            const cc = localStorage.getItem(KEY_CONT_CAM);
            if (cc) contadorCamiones = parseInt(cc, 10);
        } catch (err) {
            console.error(err);
        }
    }

    // ═══════════════════════════════════════════════════════════
    // 5. GEOCODIFICACIÓN FEDERAL (NOMINATIM NACIONAL)
    // ═══════════════════════════════════════════════════════════

    /**
     * Búsqueda en Nominatim restringida estrictamente a Argentina.
     * Retorna sugerencias formateadas con la localidad y provincia correctas.
     */
    async function buscarSugerenciasFederales(query) {
        if (query.length < 3 || !navigator.onLine) return [];
        try {
            const params = new URLSearchParams({
                q: query,
                format: 'json',
                limit: 5,
                countrycodes: 'ar',
                addressdetails: 1
            });
            const res = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, {
                headers: { 'User-Agent': 'TerMate/2.1' },
                signal: AbortSignal.timeout(4000)
            });
            if (!res.ok) return [];
            const data = await res.json();

            return data.map(item => {
                const addr = item.address;
                
                // Formatear dirección limpia
                const calle = addr.road || addr.pedestrian || addr.suburb || '';
                const altura = addr.house_number ? ` ${addr.house_number}` : '';
                const localidad = addr.city || addr.town || addr.village || addr.locality || '';
                const provincia = addr.state || '';

                let principal = '';
                let secundario = '';

                if (calle) {
                    principal = `${calle}${altura}`;
                    secundario = [localidad, provincia].filter(Boolean).join(', ');
                } else {
                    principal = localidad || provincia || item.display_name;
                    secundario = provincia && localidad ? provincia : 'Argentina';
                }

                return {
                    completo: `${principal}, ${secundario}`,
                    principal,
                    secundario,
                    lat: parseFloat(item.lat),
                    lon: parseFloat(item.lon)
                };
            });
        } catch {
            return [];
        }
    }

    async function geocodificar(direccion) {
        const key = direccion.toLowerCase().trim();
        if (!key) return null;
        if (cacheGeo[key]) return cacheGeo[key];

        if (navigator.onLine) {
            try {
                const params = new URLSearchParams({
                    q: direccion,
                    format: 'json',
                    limit: 1,
                    countrycodes: 'ar'
                });
                const res = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, {
                    headers: { 'User-Agent': 'TerMate/2.1' }
                });
                if (res.ok) {
                    const data = await res.json();
                    if (data?.length > 0) {
                        const coords = [parseFloat(data[0].lat), parseFloat(data[0].lon)];
                        cacheGeo[key] = coords;
                        guardarGeoCache();
                        return coords;
                    }
                }
            } catch {}
        }
        return null;
    }

    // ═══════════════════════════════════════════════════════════
    // 6. RUTEO PROFESIONAL HGV
    // ═══════════════════════════════════════════════════════════
    async function obtenerRutaCamion(cOrigen, cDestino, camionId) {
        const camion = camiones.find(c => c.id === camionId);
        const headers = {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        };
        if (ORS_API_KEY) headers['Authorization'] = ORS_API_KEY;

        const body = {
            coordinates: [
                [cOrigen[1], cOrigen[0]], // lon, lat
                [cDestino[1], cDestino[0]]
            ]
        };

        if (camion) {
            body.options = {
                profile_params: {
                    restrictions: {
                        height: camion.alto,
                        width: camion.ancho,
                        length: camion.largo,
                        weight: camion.peso,
                        axleload: Math.round(camion.peso / 3 * 10) / 10
                    }
                }
            };
        }

        const res = await fetch(`${ORS_BASE}/directions/driving-hgv`, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(9000)
        });

        if (!res.ok) throw new Error('ORS_ERROR');
        const data = await res.json();

        if (data.routes?.length > 0) {
            const r = data.routes[0];
            return {
                distancia: r.summary.distance / 1000,
                tiempo: r.summary.duration / 3600,
                coordenadas: decodificarPolyline(r.geometry),
                warnings: (r.warnings || []).map(w => w.message || w)
            };
        }
        throw new Error('Ruta no encontrada');
    }

    async function obtenerRutaOSRM(cOrigen, cDestino) {
        const url = `https://router.project-osrm.org/route/v1/driving/${cOrigen[1]},${cOrigen[0]};${cDestino[1]},${cDestino[0]}?overview=full&geometries=geojson`;
        const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
        if (!res.ok) throw new Error('OSRM_ERROR');
        const data = await res.json();

        if (data.code === 'Ok' && data.routes?.length > 0) {
            const r = data.routes[0];
            return {
                distancia: r.distance / 1000,
                tiempo: r.duration / 3600,
                coordenadas: r.geometry.coordinates.map(c => [c[1], c[0]]),
                warnings: []
            };
        }
        throw new Error('OSRM sin ruta');
    }

    async function resolverRuta(origen, destino, camionId) {
        const [coordsOrigen, coordsDestino] = await Promise.all([
            geocodificar(origen),
            geocodificar(destino)
        ]);

        if (!coordsOrigen) throw new Error(`Direccion de origen no resuelta.`);
        if (!coordsDestino) throw new Error(`Direccion de destino no resuelta.`);

        let dataRuta = null;
        let esAproximada = false;

        if (navigator.onLine) {
            try {
                dataRuta = await obtenerRutaCamion(coordsOrigen, coordsDestino, camionId);
            } catch {
                try {
                    dataRuta = await obtenerRutaOSRM(coordsOrigen, coordsDestino);
                    esAproximada = true;
                } catch {}
            }
        }

        if (!dataRuta) {
            const dist = haversine(coordsOrigen, coordsDestino);
            dataRuta = {
                distancia: dist,
                tiempo: dist / 70,
                coordenadas: [coordsOrigen, coordsDestino],
                warnings: ['Sin red: Calculo en linea recta.']
            };
            esAproximada = true;
        }

        if (esAproximada && navigator.onLine) {
            showToast('Ruta aproximada por limites de servicio.', 'warning');
        }

        return {
            coordsOrigen,
            coordsDestino,
            distancia: dataRuta.distancia,
            tiempo: dataRuta.tiempo,
            coordsRuta: dataRuta.coordenadas,
            warnings: dataRuta.warnings || []
        };
    }

    // ═══════════════════════════════════════════════════════════
    // 7. MAPAS LEAFLET DUALES
    // ═══════════════════════════════════════════════════════════
    function initMapas() {
        const osmAttrib = '© OpenStreetMap, © CARTO';
        const tileUrl = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';

        const argentinaBounds = L.latLngBounds(
            L.latLng(-55.1, -73.6),  // Sur-Oeste (Tierra del Fuego)
            L.latLng(-21.8, -53.6)   // Norte-Este (Misiones)
        );
        const mapOpts = {
            zoomControl: true,
            maxBounds: argentinaBounds,
            maxBoundsViscosity: 1.0,
            minZoom: 3,
            maxZoom: 18,
            worldCopyJump: false
        };

        const argStyle = {
            color: '#38bdf8',
            weight: 1.2,
            opacity: 0.6,
            fillColor: '#0e1726',
            fillOpacity: 0.15
        };
        const argLabelStyle = {
            className: 'argentina-province-label',
            direction: 'center',
            permanent: true,
            offset: [0, 0],
            interactive: false
        };

        function onEachProvince(layer) {
            layer.bindTooltip(layer.feature.properties.name, argLabelStyle);
        }

        function addArgentinaOverlay(map) {
            fetch('data/argentina-provinces.geojson')
                .then(r => r.json())
                .then(geo => {
                    L.geoJSON(geo, {
                        style: () => argStyle,
                        onEachFeature: (_f, layer) => onEachProvince(layer)
                    }).addTo(map);
                })
                .catch(err => console.error('Error cargando provincias:', err));
        }

        // 1. Mapa Full (Tab principal de Mapa)
        if (!mapaFull && document.getElementById('mapa')) {
            try {
                mapaFull = L.map('mapa', mapOpts).setView([-38.4, -63.6], 4);
                L.tileLayer(tileUrl, { attribution: osmAttrib, maxZoom: 19 }).addTo(mapaFull);
                addArgentinaOverlay(mapaFull);
            } catch (err) {
                console.error(err);
            }
        }

        // 2. Mapa Inline (Tab Nueva Ruta - Desktop)
        if (!mapaInline && document.getElementById('mapa-inline')) {
            try {
                mapaInline = L.map('mapa-inline', mapOpts).setView([-38.4, -63.6], 4);
                L.tileLayer(tileUrl, { attribution: osmAttrib, maxZoom: 19 }).addTo(mapaInline);
                addArgentinaOverlay(mapaInline);
            } catch (err) {
                console.error(err);
            }
        }
    }

    function crearIcono(color) {
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="30" height="38" viewBox="0 0 30 38">
            <path d="M15 0C6.72 0 0 6.72 0 15c0 11.25 15 23 15 23s15-11.75 15-23C30 6.72 23.28 0 15 0z" fill="${color}"/>
            <circle cx="15" cy="15" r="5" fill="#080c14"/>
        </svg>`;
        return L.divIcon({
            html: svg,
            className: '',
            iconSize: [30, 38],
            iconAnchor: [15, 38],
            popupAnchor: [0, -32]
        });
    }

    function crearIconoOrigen() {
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 22 22">
            <circle cx="11" cy="11" r="9" fill="#10b981" stroke="#080c14" stroke-width="2"/>
            <circle cx="11" cy="11" r="3" fill="#080c14"/>
        </svg>`;
        return L.divIcon({ html: svg, className: '', iconSize: [22, 22], iconAnchor: [11, 11] });
    }

    function colorPorEstado(estado) {
        if (estado === 'Pendiente') return '#f59e0b';
        if (estado === 'En Transito') return '#3b82f6';
        return '#10b981';
    }

    function renderMapas() {
        actualizarMapa(mapaFull, marcadoresFull, polylinesFull, true);
        actualizarMapa(mapaInline, marcadoresInline, polylinesInline, false);
    }

    function actualizarMapa(instanciaMapa, refMarcadores, refPolylines, incluirTodos) {
        if (!instanciaMapa) return;

        // Limpiar capas previas
        Object.values(refMarcadores).forEach(m => instanciaMapa.removeLayer(m));
        Object.values(refPolylines).forEach(p => instanciaMapa.removeLayer(p));
        
        // Reset local referencias
        for (const k in refMarcadores) delete refMarcadores[k];
        for (const k in refPolylines) delete refPolylines[k];

        const todosCoords = [];
        const enviosAMapear = incluirTodos 
            ? envios 
            : envios.slice(-1); // En el mapa de preview, solo mostramos la última ruta o la que se está editando

        enviosAMapear.forEach(e => {
            if (!e.coordsDestino) return;
            const color = colorPorEstado(e.estado);

            // Destino
            const mDest = L.marker(e.coordsDestino, { icon: crearIcono(color) }).addTo(instanciaMapa);
            mDest.bindPopup(popupHtml(e));
            mDest.bindTooltip(`#${String(e.id).padStart(4,'0')} — ${e.destino}`, { permanent: true, direction: 'top', offset: [0, -10], className: 'map-label' });
            refMarcadores[e.id] = mDest;
            todosCoords.push(e.coordsDestino);

            // Origen
            if (e.coordsOrigen) {
                const mOr = L.marker(e.coordsOrigen, { icon: crearIconoOrigen() }).addTo(instanciaMapa);
                mOr.bindPopup(`<div class="popup-titulo" style="color:#10b981">Origen</div><div class="popup-linea">${e.origen}</div>`);
                mOr.bindTooltip(e.origen, { permanent: true, direction: 'bottom', offset: [0, 10], className: 'map-label map-label-origen' });
                refMarcadores[`${e.id}_or`] = mOr;
                todosCoords.push(e.coordsOrigen);

                if (e.coordsRuta?.length > 0) {
                    const poly = L.polyline(e.coordsRuta, {
                        color,
                        weight: e.estado === 'En Transito' ? 5 : 3,
                        opacity: 0.8,
                        dashArray: e.estado === 'Pendiente' ? '8, 8' : null
                    }).addTo(instanciaMapa);
                    refPolylines[e.id] = poly;
                }
            }
        });

        if (todosCoords.length > 0) {
            const grupo = L.featureGroup(todosCoords.map(c => L.marker(c)));
            try {
                instanciaMapa.fitBounds(grupo.getBounds().pad(0.15));
            } catch {}
        }
    }

    function popupHtml(e) {
        const dist = formatoDistancia(e.distancia);
        const tiempo = formatoTiempo(e.tiempo);
        const fuel = formatoFuel(e.distancia, e.pesoCarga);
        return `<div class="popup-titulo">${e.destino}</div>`
            + `<div class="popup-linea"><strong>Desde:</strong> ${e.origen}</div>`
            + `<div class="popup-linea"><strong>Carga:</strong> ${e.producto}</div>`
            + (dist !== '—' ? `<div class="popup-linea"><strong>Distancia:</strong> ${dist}</div>` : '')
            + (tiempo !== '—' ? `<div class="popup-linea"><strong>Tiempo:</strong> ${tiempo}</div>` : '')
            + (fuel ? `<div class="popup-linea"><strong>Combustible:</strong> ${fuel}</div>` : '');
    }

    function enfocarRutaEspecifica(id) {
        irATab('mapa');
        setTimeout(() => {
            const poly = polylinesFull[id];
            if (poly) {
                mapaFull.fitBounds(poly.getBounds(), { padding: [40, 40], maxZoom: 10 });
                if (marcadoresFull[id]) marcadoresFull[id].openPopup();
            } else if (marcadoresFull[id]) {
                mapaFull.setView(marcadoresFull[id].getLatLng(), 10);
                marcadoresFull[id].openPopup();
            }
        }, 300);
    }

    // ═══════════════════════════════════════════════════════════
    // 8. RENDERIZADO UI
    // ═══════════════════════════════════════════════════════════
    function actualizarKPIs() {
        const pendiente = envios.filter(e => e.estado === 'Pendiente').length;
        const transito  = envios.filter(e => e.estado === 'En Transito').length;
        const entregado = envios.filter(e => e.estado === 'Entregado').length;

        const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
        set('kpi-num-pendiente', pendiente);
        set('kpi-num-transito', transito);
        set('kpi-num-entregado', entregado);
    }

    function renderListaViajes() {
        const c = document.getElementById('lista-viajes');
        if (!c) return;

        let lista = envios.slice().reverse();

        if (filtroEstado !== 'todos') {
            lista = lista.filter(e => e.estado === filtroEstado);
        }
        if (filtroBuscar) {
            const q = filtroBuscar.toLowerCase();
            lista = lista.filter(e =>
                e.origen.toLowerCase().includes(q) ||
                e.destino.toLowerCase().includes(q) ||
                e.producto.toLowerCase().includes(q) ||
                (e.cliente && e.cliente.toLowerCase().includes(q)) ||
                (e.remito && e.remito.toLowerCase().includes(q))
            );
        }

        if (lista.length === 0) {
            c.innerHTML = `<div class="empty-state">
                <span class="empty-icon">📋</span>
                <p>No se encontraron registros de viajes.</p>
            </div>`;
            return;
        }

        c.innerHTML = lista.map(e => {
            const clase = e.estado === 'Pendiente' ? 'pendiente' : e.estado === 'En Transito' ? 'transito' : 'entregado';
            return `<div class="viaje-card ${clase}" data-id="${e.id}" role="button" tabindex="0">
                <div class="viaje-ruta">
                    <span>${e.origen.split(',')[0]}</span>
                    <span class="viaje-ruta-arrow">→</span>
                    <span>${e.destino.split(',')[0]}</span>
                </div>
                <div class="viaje-meta">
                    <span class="viaje-carga">${e.producto}</span>
                    <span class="viaje-distancia">${formatoDistancia(e.distancia)}</span>
                </div>
            </div>`;
        }).join('');
    }

    function render() {
        actualizarKPIs();
        renderListaViajes();
        renderMapas();
        renderSelectCamiones();
    }

    // ═══════════════════════════════════════════════════════════
    // 9. EVENTOS Y AUTOCOMPLETADO
    // ═══════════════════════════════════════════════════════════
    function setupAutocompletado(inputId, listaId) {
        const input = document.getElementById(inputId);
        const lista = document.getElementById(listaId);
        if (!input || !lista) return;

        let delay = null;

        input.addEventListener('input', () => {
            clearTimeout(delay);
            const q = input.value.trim();
            if (q.length < 3) { lista.classList.remove('visible'); return; }

            delay = setTimeout(async () => {
                const sugs = await buscarSugerenciasFederales(q);
                if (sugs.length === 0) { lista.classList.remove('visible'); return; }

                lista.innerHTML = sugs.map(s =>
                    `<li role="option" data-lat="${s.lat}" data-lon="${s.lon}" data-completo="${s.completo}">
                        <span class="sug-principal">${s.principal}</span>
                        <span class="sug-secundario">${s.secundario}</span>
                    </li>`
                ).join('');
                lista.classList.add('visible');
            }, 300);
        });

        lista.addEventListener('click', e => {
            const li = e.target.closest('li');
            if (!li) return;

            const completo = li.dataset.completo;
            const lat = parseFloat(li.dataset.lat);
            const lon = parseFloat(li.dataset.lon);

            input.value = completo;
            lista.classList.remove('visible');

            if (!isNaN(lat) && !isNaN(lon)) {
                cacheGeo[completo.toLowerCase().trim()] = [lat, lon];
                guardarGeoCache();
            }
        });

        document.addEventListener('click', e => {
            if (!input.contains(e.target) && !lista.contains(e.target)) {
                lista.classList.remove('visible');
            }
        });
    }

    function irATab(tabId) {
        document.querySelectorAll('.tab-pane').forEach(t => t.classList.remove('active'));
        document.getElementById(`tab-${tabId}`)?.classList.add('active');

        // Botones
        document.querySelectorAll('.sidebar-btn, .nav-btn').forEach(btn => {
            if (btn.dataset.tab === tabId) btn.classList.add('active');
            else btn.classList.remove('active');
        });

        // Forzar recalcular tamaño de mapas al verse
        if (tabId === 'mapa' && mapaFull) {
            setTimeout(() => mapaFull.invalidateSize(), 50);
        }
        if (tabId === 'nueva-ruta' && mapaInline) {
            setTimeout(() => mapaInline.invalidateSize(), 50);
        }
    }

    function cerrarModalCamion() {
        document.getElementById('modal-camion')?.classList.add('hidden');
        camionEditandoId = null;
    }

    function renderListaCamiones() {
        const c = document.getElementById('lista-camiones');
        if (!c) return;

        if (camiones.length === 0) {
            c.innerHTML = `<div class="empty-state">
                <p>No hay camiones registrados. Agrega uno para empezar a asignar rutas.</p>
            </div>`;
            return;
        }

        c.innerHTML = camiones.map(cam => `
            <div class="camion-card viaje-card pendiente" data-id="${cam.id}" role="button" tabindex="0">
                <div class="viaje-ruta">
                    <span>${cam.nombre}</span>
                    <span class="viaje-distancia" style="font-size:0.7rem;opacity:0.7;margin-left:auto">${cam.patente || ''}</span>
                </div>
                ${cam.camionero ? `<div class="viaje-meta"><span class="viaje-carga">Camionero: ${cam.camionero}</span></div>` : ''}
                <div class="viaje-meta">
                    <span class="viaje-carga">${cam.peso} tn</span>
                    <span class="viaje-distancia">${cam.largo}m x ${cam.ancho}m</span>
                </div>
                <div class="viaje-meta">
                    <span class="viaje-carga">Vacio: ${cam.consumoVacio} L/100km</span>
                    <span class="viaje-distancia">Cargado: ${cam.consumoLleno} L/100km</span>
                </div>
                <button class="camion-card-delete" data-id="${cam.id}" aria-label="Eliminar camion" style="position:absolute;top:8px;right:8px;background:none;border:none;color:var(--c-text-muted);cursor:pointer;font-size:1.1rem;">&times;</button>
            </div>
        `).join('');
    }

    function renderSelectCamiones() {
        const sel = document.getElementById('select-camion');
        if (!sel) return;
        const prev = sel.value;
        sel.innerHTML = '<option value="">-- Seleccionar camion --</option>' +
            camiones.map(c => `<option value="${c.id}">${c.nombre} ${c.patente ? '(' + c.patente + ')' : ''}</option>`).join('');
        if (prev && camiones.some(c => c.id === parseInt(prev))) sel.value = prev;
    }

    // Modal Datos del Viaje
    function abrirModalViaje(envioExistente) {
        const m = document.getElementById('modal-viaje');
        if (!m) return;

        const vjSel = document.getElementById('vj-select-camion');
        if (vjSel) {
            vjSel.innerHTML = '<option value="">-- Seleccionar camion --</option>' +
                camiones.map(c => `<option value="${c.id}">${c.nombre} ${c.patente ? '(' + c.patente + ')' : ''}</option>`).join('');
            vjSel.value = envioExistente?.camionId || '';
        }

        if (envioExistente) {
            document.getElementById('vj-cliente').value = envioExistente.cliente || '';
            document.getElementById('vj-remito').value = envioExistente.remito || '';
        } else {
            document.getElementById('form-viaje')?.reset();
            if (vjSel) vjSel.value = '';
        }

        m.classList.remove('hidden');
    }

    function cerrarModalViaje() {
        document.getElementById('modal-viaje')?.classList.add('hidden');
        rutaPendiente = null;
    }

    // Modal Detalle Viaje
    function abrirDetalle(id) {
        const e = envios.find(x => x.id === id);
        if (!e) return;
        idEnvioDetalle = id;

        const cont = document.getElementById('detalle-contenido');
        if (cont) {
            cont.innerHTML = [
                ['Origen', e.origen],
                ['Destino', e.destino],
                ['Carga', e.producto],
                e.pesoCarga ? ['Peso', `${e.pesoCarga} tn`] : null,
                ['Distancia', formatoDistancia(e.distancia)],
                ['Tiempo estimado', formatoTiempo(e.tiempo)],
                e.distancia ? ['Consumo estimado', formatoFuel(e.distancia, e.pesoCarga, e.camionId)] : null,
                ['Estado', e.estado],
                e.camionId ? ['Camion', `${(camiones.find(c => c.id === e.camionId) || {}).nombre || 'N/A'} ${(camiones.find(c => c.id === e.camionId) || {}).patente ? '(' + (camiones.find(c => c.id === e.camionId)).patente + ')' : ''}`] : ['Camion', '<em style="opacity:0.5">Sin asignar</em> <button id="btn-detalle-asignar-camion" class="btn-link" style="margin-left:6px">Asignar</button>'],
                e.camionId && (camiones.find(c => c.id === e.camionId) || {}).camionero ? ['Camionero', (camiones.find(c => c.id === e.camionId)).camionero] : null,
                e.cliente ? ['Cliente', e.cliente] : null,
                e.remito ? ['N° Remito', e.remito] : null
            ].filter(Boolean).map(([k, v]) => 
                `<div class="detail-row">
                    <span class="detail-key">${k}</span>
                    <span class="detail-val">${v}</span>
                </div>`
            ).join('') + `<div style="text-align:center;margin-top:12px"><button id="btn-detalle-cambiar-camion" class="btn-link" style="font-size:0.85rem">Cambiar camion</button></div>`;
        }

        document.getElementById('modal-detalle')?.classList.remove('hidden');
    }

    function cerrarDetalle() {
        document.getElementById('modal-detalle')?.classList.add('hidden');
        idEnvioDetalle = null;
    }

    function iniciarEdicion(id) {
        const e = envios.find(x => x.id === id);
        if (!e) return;
        idEnvioEditando = id;
        cerrarDetalle();

        document.getElementById('origen').value = e.origen;
        document.getElementById('destino').value = e.destino;
        document.getElementById('producto').value = e.producto;
        document.getElementById('peso-carga').value = e.pesoCarga || '';
        document.getElementById('estado').value = e.estado;
        document.getElementById('select-camion').value = e.camionId || '';

        document.getElementById('form-titulo').textContent = `Editar Ruta #${String(id).padStart(4, '0')}`;
        document.getElementById('btn-submit-texto').textContent = 'Guardar Cambios';
        document.getElementById('btn-cancelar-edicion').classList.remove('hidden');

        irATab('nueva-ruta');
    }

    function cancelarEdicion() {
        idEnvioEditando = null;
        document.getElementById('form-envio')?.reset();
        document.getElementById('form-titulo').textContent = 'Nueva Ruta';
        document.getElementById('btn-submit-texto').textContent = 'Calcular Mejor Ruta';
        document.getElementById('btn-cancelar-edicion').classList.add('hidden');
        document.getElementById('resultado-ruta')?.classList.add('hidden');
        renderSelectCamiones();
    }

    // ═══════════════════════════════════════════════════════════
    // 10. BIND EVENT LISTENERS
    // ═══════════════════════════════════════════════════════════
    function bindEvents() {
        // Formulario de envío
        const formEnvio = document.getElementById('form-envio');
        formEnvio?.addEventListener('submit', async e => {
            e.preventDefault();
            const origen = document.getElementById('origen').value.trim();
            const destino = document.getElementById('destino').value.trim();
            const producto = document.getElementById('producto').value.trim();
            const pesoCarga = parseFloat(document.getElementById('peso-carga').value) || null;
            const estado = document.getElementById('estado').value;
            const camionId = parseInt(document.getElementById('select-camion').value) || null;

            if (!origen || !destino || !producto) {
                showToast('Completa origen, destino y carga.', 'error');
                return;
            }
            if (!camionId) {
                showToast('Selecciona un camion para la ruta.', 'error');
                return;
            }

            const btnText = document.getElementById('btn-submit-texto');
            const loader = document.getElementById('btn-submit-loader');
            const btn = document.getElementById('btn-submit-envio');

            btn.disabled = true;
            btnText.classList.add('hidden');
            loader.classList.remove('hidden');

            try {
                const dataRuta = await resolverRuta(origen, destino, camionId);

                // Actualizar panel de resultados
                const resPanel = document.getElementById('resultado-ruta');
                if (resPanel) {
                    document.getElementById('res-distancia').textContent = formatoDistancia(dataRuta.distancia);
                    document.getElementById('res-tiempo').textContent = formatoTiempo(dataRuta.tiempo);
                    document.getElementById('res-fuel').textContent = formatoFuel(dataRuta.distancia, pesoCarga, camionId) || '--';
                    const adv = document.getElementById('res-advertencias');
                    if (dataRuta.warnings.length > 0) {
                        adv.textContent = dataRuta.warnings.join(' · ');
                        adv.classList.remove('hidden');
                    } else {
                        adv.classList.add('hidden');
                    }
                    resPanel.classList.remove('hidden');
                }

                if (idEnvioEditando === null) {
                    rutaPendiente = {
                        origen, destino, producto, pesoCarga, estado, camionId,
                        ...dataRuta,
                        fecha: new Date().toISOString()
                    };
                    abrirModalViaje(null);
                } else {
                    const idx = envios.findIndex(x => x.id === idEnvioEditando);
                    if (idx !== -1) {
                        envios[idx] = { ...envios[idx], origen, destino, producto, pesoCarga, estado, camionId, ...dataRuta };
                        abrirModalViaje(envios[idx]);
                    }
                }

            } catch (err) {
                showToast(err.message || 'Error al calcular la ruta.', 'error');
            } finally {
                btn.disabled = false;
                btnText.classList.remove('hidden');
                loader.classList.add('hidden');
            }
        });

        document.getElementById('btn-cancelar-edicion')?.addEventListener('click', cancelarEdicion);
        document.getElementById('btn-ver-mapa-resultado')?.addEventListener('click', () => irATab('mapa'));

        // Tab triggers (Bottom Nav & Sidebar)
        document.querySelectorAll('.nav-btn, .sidebar-btn').forEach(btn => {
            btn.addEventListener('click', () => irATab(btn.dataset.tab));
        });

        // Modal Camiones
        document.getElementById('btn-nuevo-camion')?.addEventListener('click', () => {
            camionEditandoId = null;
            document.getElementById('modal-camion-titulo').textContent = 'Nuevo Camion';
            document.getElementById('form-camion')?.reset();
            document.getElementById('cam-id').value = '';
            document.getElementById('modal-camion')?.classList.remove('hidden');
        });
        document.getElementById('btn-cerrar-camion')?.addEventListener('click', cerrarModalCamion);
        document.getElementById('btn-cancelar-camion')?.addEventListener('click', cerrarModalCamion);

        // Lista de camiones (click en card para editar)
        document.getElementById('lista-camiones')?.addEventListener('click', e => {
            const card = e.target.closest('.camion-card');
            if (!card) return;
            const id = Number(card.dataset.id);
            const btnDel = e.target.closest('.camion-card-delete');
            if (btnDel) {
                camiones = camiones.filter(c => c.id !== id);
                guardar();
                renderListaCamiones();
                renderSelectCamiones();
                showToast('Camion eliminado.', 'info');
                return;
            }
            const camion = camiones.find(c => c.id === id);
            if (!camion) return;
            camionEditandoId = id;
            document.getElementById('modal-camion-titulo').textContent = 'Editar Camion';
            document.getElementById('cam-id').value = id;
            document.getElementById('cam-nombre').value = camion.nombre;
            document.getElementById('cam-patente').value = camion.patente || '';
            document.getElementById('cam-camionero').value = camion.camionero || '';
            document.getElementById('cam-peso').value = camion.peso;
            document.getElementById('cam-alto').value = camion.alto;
            document.getElementById('cam-largo').value = camion.largo;
            document.getElementById('cam-ancho').value = camion.ancho;
            document.getElementById('cam-cons-vacio').value = camion.consumoVacio;
            document.getElementById('cam-cons-cargado').value = camion.consumoLleno;
            document.getElementById('modal-camion')?.classList.remove('hidden');
        });

        // Modal Datos del Viaje
        document.getElementById('btn-cerrar-viaje')?.addEventListener('click', cerrarModalViaje);
        document.getElementById('btn-cancelar-viaje')?.addEventListener('click', cerrarModalViaje);

        document.getElementById('form-viaje')?.addEventListener('submit', e => {
            e.preventDefault();
            const cliente = document.getElementById('vj-cliente').value.trim();
            const remito = document.getElementById('vj-remito').value.trim();
            const camionId = parseInt(document.getElementById('vj-select-camion')?.value) || null;

            if (!cliente || !remito) {
                showToast('Completá cliente y remito.', 'error');
                return;
            }

            const datosExtra = { cliente, remito, camionId };

            if (idEnvioEditando !== null) {
                const idx = envios.findIndex(x => x.id === idEnvioEditando);
                if (idx !== -1) {
                    envios[idx] = { ...envios[idx], ...datosExtra };
                }
                showToast('Datos del viaje actualizados.', 'success');
                cancelarEdicion();
            } else if (rutaPendiente) {
                const nuevo = { id: contadorId++, ...rutaPendiente, ...datosExtra };
                envios.push(nuevo);
                showToast('Viaje guardado con éxito.', 'success');
                document.getElementById('form-envio')?.reset();
                rutaPendiente = null;
            }

            cerrarModalViaje();
            guardar();
            render();
        });

        document.getElementById('form-camion')?.addEventListener('submit', e => {
            e.preventDefault();
            const id = document.getElementById('cam-id').value;
            const nombre = document.getElementById('cam-nombre').value.trim();
            const patente = document.getElementById('cam-patente').value.trim().toUpperCase();
            const get = id => parseFloat(document.getElementById(id)?.value) || 0;

            if (!nombre) {
                showToast('Ponle un nombre al camion.', 'error');
                return;
            }

            const datos = {
                nombre,
                patente,
                camionero:    document.getElementById('cam-camionero').value.trim(),
                peso:         get('cam-peso') || 20,
                alto:         get('cam-alto') || 4.0,
                largo:        get('cam-largo') || 18,
                ancho:        get('cam-ancho') || 2.5,
                consumoVacio: get('cam-cons-vacio') || 25,
                consumoLleno: get('cam-cons-cargado') || 38
            };

            if (id) {
                const idx = camiones.findIndex(c => c.id === parseInt(id));
                if (idx !== -1) camiones[idx] = { ...camiones[idx], ...datos };
                showToast('Camion actualizado.', 'success');
            } else {
                camiones.push({ id: contadorCamiones++, ...datos });
                showToast('Camion registrado.', 'success');
            }

            cerrarModalCamion();
            guardar();
            renderListaCamiones();
            renderSelectCamiones();
        });

        // Detalle de viaje
        document.getElementById('lista-viajes')?.addEventListener('click', e => {
            const card = e.target.closest('.viaje-card');
            if (card) abrirDetalle(Number(card.dataset.id));
        });

        document.getElementById('btn-cerrar-detalle')?.addEventListener('click', cerrarDetalle);
        document.getElementById('btn-detalle-ver-mapa')?.addEventListener('click', () => {
            if (idEnvioDetalle !== null) {
                const id = idEnvioDetalle;
                cerrarDetalle();
                enfocarRutaEspecifica(id);
            }
        });

        document.getElementById('btn-detalle-estado')?.addEventListener('click', () => {
            if (idEnvioDetalle === null) return;
            const x = envios.find(item => item.id === idEnvioDetalle);
            if (!x) return;
            const estados = ['Pendiente', 'En Transito', 'Entregado'];
            x.estado = estados[(estados.indexOf(x.estado) + 1) % estados.length];
            guardar();
            render();
            cerrarDetalle();
            showToast(`Estado cambiado a ${x.estado}.`, 'info');
        });

        document.getElementById('btn-detalle-editar')?.addEventListener('click', () => {
            if (idEnvioDetalle !== null) iniciarEdicion(idEnvioDetalle);
        });

        document.getElementById('btn-detalle-eliminar')?.addEventListener('click', () => {
            if (idEnvioDetalle === null) return;
            envios = envios.filter(x => x.id !== idEnvioDetalle);
            guardar();
            render();
            cerrarDetalle();
            showToast('Ruta eliminada.', 'warning');
        });

        document.getElementById('detalle-contenido')?.addEventListener('click', e => {
            if (e.target.id === 'btn-detalle-cambiar-camion' || e.target.id === 'btn-detalle-asignar-camion') {
                if (idEnvioDetalle === null) return;
                const envio = envios.find(x => x.id === idEnvioDetalle);
                if (!envio) return;
                e.target.outerHTML = `<select id="vj-cambiar-camion-inline" class="field-input" style="margin-top:4px;font-size:0.85rem">
                    ${camiones.map(c => `<option value="${c.id}" ${c.id === envio.camionId ? 'selected' : ''}>${c.nombre} ${c.patente ? '(' + c.patente + ')' : ''}</option>`).join('')}
                </select>`;
                const sel = document.getElementById('vj-cambiar-camion-inline');
                sel?.focus();
                const aplicar = () => {
                    const nuevoId = parseInt(sel.value);
                    if (nuevoId && nuevoId !== envio.camionId) {
                        envio.camionId = nuevoId;
                        guardar();
                        render();
                        showToast(`Camion cambiado a ${(camiones.find(c => c.id === nuevoId) || {}).nombre}.`, 'success');
                    }
                    abrirDetalle(idEnvioDetalle);
                };
                sel?.addEventListener('change', aplicar);
                sel?.addEventListener('blur', () => { setTimeout(() => { if (document.getElementById('vj-cambiar-camion-inline')) abrirDetalle(idEnvioDetalle); }, 150); });
            }
        });

        // Filtro & Búsqueda
        document.getElementById('filtro-buscar')?.addEventListener('input', e => {
            filtroBuscar = e.target.value;
            renderListaViajes();
        });

        document.querySelectorAll('.filter-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                filtroEstado = btn.dataset.estado;
                renderListaViajes();
            });
        });

        // Overlays cerrar modales al hacer click afuera
        document.querySelectorAll('.modal-overlay').forEach(overlay => {
            overlay.addEventListener('click', e => {
                if (e.target === overlay) {
                    cerrarModalCamion();
                    cerrarDetalle();
                    cerrarModalViaje();
                }
            });
        });
    }

    // ═══════════════════════════════════════════════════════════
    // 11. UTILS GENERALES
    // ═══════════════════════════════════════════════════════════
    function haversine(c1, c2) {
        const R = 6371;
        const dLat = (c2[0] - c1[0]) * Math.PI / 180;
        const dLon = (c2[1] - c1[1]) * Math.PI / 180;
        const a = Math.sin(dLat/2)**2 + Math.cos(c1[0]*Math.PI/180) * Math.cos(c2[0]*Math.PI/180) * Math.sin(dLon/2)**2;
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    }

    function decodificarPolyline(encoded) {
        const coords = [];
        let index = 0, lat = 0, lng = 0;
        while (index < encoded.length) {
            let b, shift = 0, result = 0;
            do {
                b = encoded.charCodeAt(index++) - 63;
                result |= (b & 0x1f) << shift;
                shift += 5;
            } while (b >= 0x20);
            lat += (result & 1) ? ~(result >> 1) : (result >> 1);

            shift = 0; result = 0;
            do {
                b = encoded.charCodeAt(index++) - 63;
                result |= (b & 0x1f) << shift;
                shift += 5;
            } while (b >= 0x20);
            lng += (result & 1) ? ~(result >> 1) : (result >> 1);

            coords.push([lat / 1e5, lng / 1e5]);
        }
        return coords;
    }

    function formatoDistancia(km) {
        if (!km || isNaN(km)) return '—';
        return km >= 1000 ? `${(km/1000).toFixed(1).replace('.', ',')} mil km` : `${Math.round(km)} km`;
    }

    function formatoTiempo(h) {
        if (!h || isNaN(h)) return '—';
        if (h < 1) return `${Math.round(h * 60)} min`;
        const hh = Math.floor(h);
        const mm = Math.round((h - hh) * 60);
        return mm > 0 ? `${hh}h ${mm}min` : `${hh}h`;
    }

    function formatoFuel(km, pesoCarga = 0, camionId = null) {
        const camion = camionId ? camiones.find(c => c.id === camionId) : camiones[0];
        if (!camion || !km || !camion.consumoVacio || !camion.consumoLleno) return null;
        
        const capMax = camion.peso || 1;
        const cargaRatio = Math.min(1, Math.max(0, (pesoCarga || 0) / capMax));
        
        const consumoPor100km = camion.consumoVacio + (camion.consumoLleno - camion.consumoVacio) * cargaRatio;
        
        const litros = Math.round(km * consumoPor100km / 100);
        return `${litros} L`;
    }

    function showToast(msg, tipo = 'info') {
        const cont = document.getElementById('toast-container');
        if (!cont) return;
        const t = document.createElement('div');
        t.className = `toast ${tipo}`;
        t.textContent = msg;
        cont.appendChild(t);
        setTimeout(() => {
            t.style.opacity = '0';
            t.style.transform = 'translateX(20px)';
            t.style.transition = 'all 0.25s ease';
            setTimeout(() => t.remove(), 250);
        }, 3500);
    }

    // ═══════════════════════════════════════════════════════════
    // 12. INICIALIZACIÓN
    // ═══════════════════════════════════════════════════════════
    function init() {
        cargarDatos();
        actualizarConexion();
        initMapas();
        setupAutocompletado('origen', 'sugerencias-origen');
        setupAutocompletado('destino', 'sugerencias-destino');
        bindEvents();
        renderListaCamiones();
        render();

        if (camiones.length === 0) irATab('camiones');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
