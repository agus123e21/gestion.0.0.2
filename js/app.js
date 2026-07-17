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

    // Perfil de Camión Argentino Estándar
    let perfilCamion = {
        peso: 20,
        alto: 4.0,
        largo: 18,
        ancho: 2.5,
        consumoVacio: 25,     // Litros/100km sin carga
        consumoLleno: 38      // Litros/100km a carga completa (definida por perfilCamion.peso)
    };

    const KEY_GEO_CACHE = 'termate_geo_cache';
    const KEY_ENVIOS     = 'termate_envios';
    const KEY_CONTADOR   = 'termate_contador';
    const KEY_PERFIL     = 'termate_perfil';
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
        } catch {
            showToast('Almacenamiento lleno. Eliminá rutas viejas.', 'error');
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
            const p = localStorage.getItem(KEY_PERFIL);
            if (p) perfilCamion = { ...perfilCamion, ...JSON.parse(p) };
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
    async function obtenerRutaCamion(cOrigen, cDestino) {
        const headers = {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        };
        if (ORS_API_KEY) headers['Authorization'] = ORS_API_KEY;

        const body = {
            coordinates: [
                [cOrigen[1], cOrigen[0]], // lon, lat
                [cDestino[1], cDestino[0]]
            ],
            options: {
                profile_params: {
                    restrictions: {
                        height: perfilCamion.alto,
                        width: perfilCamion.ancho,
                        length: perfilCamion.largo,
                        weight: perfilCamion.peso,
                        axleload: Math.round(perfilCamion.peso / 3 * 10) / 10
                    }
                }
            }
        };

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

    async function resolverRuta(origen, destino) {
        const [coordsOrigen, coordsDestino] = await Promise.all([
            geocodificar(origen),
            geocodificar(destino)
        ]);

        if (!coordsOrigen) throw new Error(`Dirección de origen no resuelta.`);
        if (!coordsDestino) throw new Error(`Dirección de destino no resuelta.`);

        let dataRuta = null;
        let esAproximada = false;

        if (navigator.onLine) {
            try {
                dataRuta = await obtenerRutaCamion(coordsOrigen, coordsDestino);
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
                warnings: ['Sin red: Cálculo en línea recta.']
            };
            esAproximada = true;
        }

        if (esAproximada && navigator.onLine) {
            showToast('Ruta aproximada por límites de servicio.', 'warning');
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

        // 1. Mapa Full (Tab principal de Mapa)
        if (!mapaFull && document.getElementById('mapa')) {
            try {
                mapaFull = L.map('mapa', { zoomControl: true }).setView([-38.4, -63.6], 4);
                L.tileLayer(tileUrl, { attribution: osmAttrib, maxZoom: 19 }).addTo(mapaFull);
            } catch (err) {
                console.error(err);
            }
        }

        // 2. Mapa Inline (Tab Nueva Ruta - Desktop)
        if (!mapaInline && document.getElementById('mapa-inline')) {
            try {
                mapaInline = L.map('mapa-inline', { zoomControl: true }).setView([-38.4, -63.6], 4);
                L.tileLayer(tileUrl, { attribution: osmAttrib, maxZoom: 19 }).addTo(mapaInline);
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
            refMarcadores[e.id] = mDest;
            todosCoords.push(e.coordsDestino);

            // Origen
            if (e.coordsOrigen) {
                const mOr = L.marker(e.coordsOrigen, { icon: crearIconoOrigen() }).addTo(instanciaMapa);
                mOr.bindPopup(`<div class="popup-titulo" style="color:#10b981">Origen</div><div class="popup-linea">${e.origen}</div>`);
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
                e.producto.toLowerCase().includes(q)
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

    // Modal Camión
    function abrirModalPerfil() {
        const m = document.getElementById('modal-perfil');
        if (!m) return;
        
        document.getElementById('camion-peso').value = perfilCamion.peso;
        document.getElementById('camion-alto').value = perfilCamion.alto;
        document.getElementById('camion-largo').value = perfilCamion.largo;
        document.getElementById('camion-ancho').value = perfilCamion.ancho;
        document.getElementById('camion-consumo-vacio').value = perfilCamion.consumoVacio;
        document.getElementById('camion-consumo-cargado').value = perfilCamion.consumoLleno;
        
        m.classList.remove('hidden');
    }
    
    function cerrarModalPerfil() {
        document.getElementById('modal-perfil')?.classList.add('hidden');
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
                e.distancia ? ['Consumo estimado', formatoFuel(e.distancia, e.pesoCarga)] : null,
                ['Estado', e.estado]
            ].filter(Boolean).map(([k, v]) => 
                `<div class="detail-row">
                    <span class="detail-key">${k}</span>
                    <span class="detail-val">${v}</span>
                </div>`
            ).join('');
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

            if (!origen || !destino || !producto) {
                showToast('Completá origen, destino y carga.', 'error');
                return;
            }

            const btnText = document.getElementById('btn-submit-texto');
            const loader = document.getElementById('btn-submit-loader');
            const btn = document.getElementById('btn-submit-envio');

            btn.disabled = true;
            btnText.classList.add('hidden');
            loader.classList.remove('hidden');

            try {
                const dataRuta = await resolverRuta(origen, destino);

                // Actualizar panel de resultados
                const resPanel = document.getElementById('resultado-ruta');
                if (resPanel) {
                    document.getElementById('res-distancia').textContent = formatoDistancia(dataRuta.distancia);
                    document.getElementById('res-tiempo').textContent = formatoTiempo(dataRuta.tiempo);
                    document.getElementById('res-fuel').textContent = formatoFuel(dataRuta.distancia, pesoCarga) || '—';
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
                    const nuevo = {
                        id: contadorId++,
                        origen, destino, producto, pesoCarga, estado,
                        ...dataRuta,
                        fecha: new Date().toISOString()
                    };
                    envios.push(nuevo);
                    showToast('Ruta calculada con éxito.', 'success');
                    formEnvio.reset();
                } else {
                    const idx = envios.findIndex(x => x.id === idEnvioEditando);
                    if (idx !== -1) {
                        envios[idx] = { ...envios[idx], origen, destino, producto, pesoCarga, estado, ...dataRuta };
                    }
                    showToast('Ruta modificada con éxito.', 'success');
                    cancelarEdicion();
                }

                guardar();
                render();

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

        // Perfil camión
        const triggersPerfil = [
            document.getElementById('btn-perfil-camion'),
            document.getElementById('btn-perfil-camion-mobile')
        ];
        triggersPerfil.forEach(btn => btn?.addEventListener('click', abrirModalPerfil));
        document.getElementById('btn-cerrar-perfil')?.addEventListener('click', cerrarModalPerfil);
        document.getElementById('btn-cerrar-perfil-2')?.addEventListener('click', cerrarModalPerfil);

        document.getElementById('form-perfil')?.addEventListener('submit', e => {
            e.preventDefault();
            const get = id => parseFloat(document.getElementById(id)?.value) || 0;
            perfilCamion = {
                peso:         get('camion-peso') || 20,
                alto:         get('camion-alto') || 4.0,
                largo:        get('camion-largo') || 18,
                ancho:        get('camion-ancho') || 2.5,
                consumoVacio: get('camion-consumo-vacio') || 25,
                consumoLleno: get('camion-consumo-cargado') || 38
            };
            guardarPerfil();
            cerrarModalPerfil();
            showToast('Perfil actualizado.', 'success');
            render(); // Actualiza consumos calculados
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
                    cerrarModalPerfil();
                    cerrarDetalle();
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

    function formatoFuel(km, pesoCarga = 0) {
        if (!km || !perfilCamion.consumoVacio || !perfilCamion.consumoLleno) return null;
        
        // Peso relativo al máximo del camión
        const capMax = perfilCamion.peso || 1;
        const cargaRatio = Math.min(1, Math.max(0, (pesoCarga || 0) / capMax));
        
        // Consumo interpolado por 100km
        const consumoPor100km = perfilCamion.consumoVacio + (perfilCamion.consumoLleno - perfilCamion.consumoVacio) * cargaRatio;
        
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
        render();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
