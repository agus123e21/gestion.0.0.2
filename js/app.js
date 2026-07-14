let envios = JSON.parse(localStorage.getItem('envios')) || [];
let contadorId = parseInt(localStorage.getItem('contadorId')) || 1;

let mapa = null;
let marcadores = {};
let rutasPolylines = {};
let rutaSeleccionada = null;
const coordenadasCiudades = {};
let distanciaCache = {};

const ciudadesBase = {
    'buenos aires': [-34.6037, -58.3816], 'cordoba': [-31.4201, -64.1888],
    'rosario': [-32.9468, -60.6506], 'mendoza': [-32.8895, -68.8458],
    'tucuman': [-26.8240, -65.2226], 'salta': [-24.7829, -65.4232],
    'santa fe': [-31.6333, -60.7000], 'mar del plata': [-38.0055, -57.5426],
    'posadas': [-27.3671, -55.8961], 'chaco': [-27.4516, -59.0234],
    'resistencia': [-27.4516, -59.0234], 'corrientes': [-27.4693, -58.8106],
    'formosa': [-26.1775, -58.1781], 'parana': [-31.7333, -60.5264],
    'entre rios': [-31.7333, -60.5264], 'san juan': [-31.5375, -68.5364],
    'san luis': [-33.2950, -66.3453], 'la rioja': [-29.4167, -66.8500],
    'catamarca': [-28.4696, -65.7795], 'santiago del estero': [-27.7951, -64.2615],
    'jujuy': [-24.1880, -65.2995], 'neuquen': [-38.9516, -68.0591],
    'rio negro': [-41.1335, -63.0000], 'chubut': [-43.3000, -65.1000],
    'santa cruz': [-51.6226, -69.2181], 'tierra del fuego': [-54.8019, -68.3030],
    'la pampa': [-36.6167, -64.2833], 'brazil': [-14.2350, -51.9253],
    'brasil': [-14.2350, -51.9253], 'uruguay': [-32.5228, -55.7658],
    'paraguay': [-23.4425, -58.4438], 'chile': [-35.6751, -71.5430],
    'lima': [-12.0464, -77.0428], 'santiago': [-33.4489, -70.6693],
    'bogota': [4.7110, -74.0721], 'mexico': [19.4326, -99.1332],
    'medellin': [6.2476, -75.5658], 'cali': [3.4516, -76.5320],
    'quito': [-0.1807, -78.4678], 'caracas': [10.4806, -66.9036],
    'madrid': [40.4168, -3.7038], 'barcelona': [41.3874, 2.1686],
    'new york': [40.7128, -74.0060], 'miami': [25.7617, -80.1918],
    'los angeles': [34.0522, -118.2437], 'chicago': [41.8781, -87.6298],
    'londres': [51.5074, -0.1278], 'paris': [48.8566, 2.3522],
    'roma': [41.9028, 12.4964], 'berlin': [52.5200, 13.4050],
    'tokio': [35.6762, 139.6503], 'pekin': [39.9042, 116.4074],
    'dubai': [25.2048, 55.2708], 'shanghai': [31.2304, 121.4737],
    'bangkok': [13.7563, 100.5018], 'singapur': [1.3521, 103.8198],
    'sidney': [-33.8688, 151.2093], 'mumbai': [19.0760, 72.8777],
    'capital federal': [-34.6037, -58.3816],
    'lanus': [-34.6989, -58.3926], 'avellaneda': [-34.6625, -58.3649],
    'quilmes': [-34.7263, -58.2548], 'la plata': [-34.9214, -57.9544],
    'moron': [-34.6537, -58.6198], 'san miguel': [-34.5437, -58.7123],
    'goya': [-29.1420, -59.2663], 'reconquista': [-29.1440, -59.6430],
    'venado tuerto': [-33.7512, -61.9697], 'rafaela': [-31.2644, -61.4867],
};

function coordsParaCiudad(nombre) {
    if (!nombre) return null;
    const lower = nombre.toLowerCase().trim();
    if (coordenadasCiudades[lower]) return coordenadasCiudades[lower];
    if (ciudadesBase[lower]) return ciudadesBase[lower];
    for (const key of Object.keys(ciudadesBase)) {
        if (lower.includes(key) || key.includes(lower)) return ciudadesBase[key];
    }
    return null;
}

function distanciaHaversine(c1, c2) {
    const R = 6371;
    const dLat = (c2[0] - c1[0]) * Math.PI / 180;
    const dLon = (c2[1] - c1[1]) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(c1[0] * Math.PI / 180) * Math.cos(c2[0] * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function formatoDistancia(km) {
    if (km >= 1000) return (km / 1000).toFixed(1).replace('.', ',') + ' mil km';
    return Math.round(km) + ' km';
}

function formatoTiempo(horas) {
    if (horas < 1) return Math.round(horas * 60) + ' min';
    const h = Math.floor(horas);
    const m = Math.round((horas - h) * 60);
    return h + 'h ' + m + 'min';
}

async function obtenerRutaOSRM(origen, destino) {
    const key = origen.toLowerCase().trim() + '|' + destino.toLowerCase().trim();
    if (distanciaCache[key]) return distanciaCache[key];

    const cOrigen = coordsParaCiudad(origen);
    const cDestino = coordsParaCiudad(destino);
    if (!cOrigen || !cDestino) return null;

    try {
        const url = 'https://router.project-osrm.org/route/v1/driving/'
            + cOrigen[1] + ',' + cOrigen[0] + ';'
            + cDestino[1] + ',' + cDestino[0]
            + '?overview=full&geometries=geojson';
        const res = await fetch(url);
        const data = await res.json();
        if (data.code === 'Ok' && data.routes && data.routes.length > 0) {
            var ruta = data.routes[0];
            var resultado = {
                distancia: ruta.distance / 1000,
                tiempo: ruta.time / 3600,
                coordenadas: ruta.geometry.coordinates.map(function(c) { return [c[1], c[0]]; }),
            };
            distanciaCache[key] = resultado;
            return resultado;
        }
    } catch (e) {}

    var dist = distanciaHaversine(cOrigen, cDestino);
    var resultado = {
        distancia: dist,
        tiempo: dist / 70,
        coordenadas: [cOrigen, cDestino],
    };
    distanciaCache[key] = resultado;
    return resultado;
}

function initMapa() {
    if (mapa) return;
    try {
        mapa = L.map('mapa', { zoomControl: true }).setView([-34.6037, -58.3816], 4);
        L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
            attribution: '&copy; OpenStreetMap, &copy; CARTO',
            maxZoom: 19,
        }).addTo(mapa);
        mapa.on('click', function() { deseleccionarRuta(); });
        setTimeout(function() { mapa.invalidateSize(); }, 200);
    } catch (e) {}
}

function colorEstado(estado) {
    if (estado === 'Pendiente') return '#fbbf24';
    if (estado === 'En Transito') return '#a78bfa';
    return '#34d399';
}

function crearIcono(color) {
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="42" viewBox="0 0 32 42">'
        + '<path d="M16 0C7.16 0 0 7.16 0 16c0 12 16 26 16 26s16-14 16-26C32 7.16 24.84 0 16 0z" fill="' + color + '" stroke="#0f172a" stroke-width="2"/>'
        + '<circle cx="16" cy="16" r="7" fill="#0f172a"/>'
        + '</svg>';
    return L.divIcon({
        html: svg,
        className: '',
        iconSize: [32, 42],
        iconAnchor: [16, 42],
        popupAnchor: [0, -36],
    });
}

function badgeColor(estado) {
    if (estado === 'Pendiente') return 'background:#78350f;color:#fbbf24;';
    if (estado === 'En Transito') return 'background:#4c1d95;color:#a78bfa;';
    return 'background:#064e3b;color:#34d399;';
}

function crearIconoOrigen() {
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 28 28">'
        + '<circle cx="14" cy="14" r="12" fill="#38bdf8" stroke="#0f172a" stroke-width="2"/>'
        + '<text x="14" y="19" text-anchor="middle" fill="#0f172a" font-size="14" font-weight="bold">O</text>'
        + '</svg>';
    return L.divIcon({
        html: svg,
        className: '',
        iconSize: [28, 28],
        iconAnchor: [14, 14],
        popupAnchor: [0, -16],
    });
}

function enfocarRuta(id) {
    if (!mapa) return;

    try {
        Object.keys(rutasPolylines).forEach(function(key) {
            var poly = rutasPolylines[key];
            if (!poly) return;
            if (Number(key) === id) return;
            poly.setStyle({ weight: 2, opacity: 0.25 });
        });

        Object.keys(marcadores).forEach(function(key) {
            var m = marcadores[key];
            if (!m) return;
            if (Number(key) === id) { m.setOpacity(1); return; }
            if (String(key).includes('_origen')) {
                var envioId = Number(String(key).replace('_origen', ''));
                if (envioId === id) { m.setOpacity(1); return; }
            }
            m.setOpacity(0.3);
        });

        var poly = rutasPolylines[id];
        if (poly) {
            poly.setStyle({ weight: 6, opacity: 1 });
            poly.bringToFront();
            mapa.fitBounds(poly.getBounds(), { padding: [50, 50], maxZoom: 8 });
            rutaSeleccionada = id;

            if (marcadores[id]) {
                marcadores[id].openPopup();
            }
        } else {
            if (marcadores[id]) {
                mapa.setView(marcadores[id].getLatLng(), 6);
                marcadores[id].openPopup();
            }
        }

        var panel = document.getElementById('mapa');
        if (panel) {
            panel.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    } catch (e) {}
}

function deseleccionarRuta() {
    if (!mapa || rutaSeleccionada === null) return;

    try {
        Object.keys(rutasPolylines).forEach(function(key) {
            var poly = rutasPolylines[key];
            if (!poly) return;
            var envio = envios.find(function(e) { return e.id === Number(key); });
            if (envio) {
                var w = envio.estado === 'En Transito' ? 4 : 3;
                poly.setStyle({ weight: w, opacity: 0.8 });
            }
        });

        Object.keys(marcadores).forEach(function(key) {
            if (marcadores[key]) marcadores[key].setOpacity(1);
        });

        rutaSeleccionada = null;
    } catch (e) {}
}

async function renderMapa() {
    if (!mapa) return;

    try {
        Object.values(marcadores).forEach(function(m) { mapa.removeLayer(m); });
        Object.values(rutasPolylines).forEach(function(p) { mapa.removeLayer(p); });
        marcadores = {};
        rutasPolylines = {};

        var enviosConCoords = envios.filter(function(e) {
            var cDestino = coordsParaCiudad(e.destino);
            if (cDestino) coordenadasCiudades[e.destino.toLowerCase().trim()] = cDestino;
            if (e.origen) {
                var cOrigen = coordsParaCiudad(e.origen);
                if (cOrigen) coordenadasCiudades[e.origen.toLowerCase().trim()] = cOrigen;
            }
            return cDestino !== null;
        });

        var todosCoords = [];

        for (var i = 0; i < enviosConCoords.length; i++) {
            var e = enviosConCoords[i];
            var coordsDestino = coordsParaCiudad(e.destino);
            var color = colorEstado(e.estado);

            var markerDestino = L.marker(coordsDestino, { icon: crearIcono(color) }).addTo(mapa);
            var popupHtml = '<div class="popup-destino">' + e.destino + '</div>'
                + '<div class="popup-info">Producto: ' + e.producto + '</div>'
                + '<div class="popup-info">Cantidad: ' + e.cantidad + ' uds</div>'
                + '<div class="popup-info">Peso: ' + e.peso + ' kg</div>'
                + '<span class="popup-estado" style="' + badgeColor(e.estado) + '">' + e.estado + '</span>';
            markerDestino.bindPopup(popupHtml);
            marcadores[e.id] = markerDestino;
            todosCoords.push(coordsDestino);

            if (e.origen) {
                var coordsOrigen = coordsParaCiudad(e.origen);
                if (coordsOrigen) {
                    var markerOrigen = L.marker(coordsOrigen, { icon: crearIconoOrigen() }).addTo(mapa);
                    markerOrigen.bindPopup('<div class="popup-destino" style="color:#38bdf8">Origen: ' + e.origen + '</div>');
                    marcadores[e.id + '_origen'] = markerOrigen;
                    todosCoords.push(coordsOrigen);

                    var ruta = await obtenerRutaOSRM(e.origen, e.destino);
                    if (ruta) {
                        e._distancia = ruta.distancia;
                        e._tiempo = ruta.tiempo;

                        var lineaColor = e.estado === 'En Transito' ? '#a78bfa' : e.estado === 'Pendiente' ? '#fbbf24' : '#34d399';
                        var polyline = L.polyline(ruta.coordenadas, {
                            color: lineaColor,
                            weight: e.estado === 'En Transito' ? 4 : 3,
                            opacity: 0.8,
                            dashArray: e.estado === 'Pendiente' ? '8, 8' : null,
                        }).addTo(mapa);
                        rutasPolylines[e.id] = polyline;

                        popupHtml += '<div class="popup-ruta">'
                            + '<div class="popup-distancia">' + formatoDistancia(ruta.distancia) + '</div>'
                            + '<div class="popup-tiempo">Est. ' + formatoTiempo(ruta.tiempo) + ' - ' + e.origen + '</div>'
                            + '</div>';
                        markerDestino.setPopupContent(popupHtml);
                    }
                }
            }
        }

        if (todosCoords.length > 0) {
            var grupo = L.featureGroup(todosCoords.map(function(c) { return L.marker(c); }));
            mapa.fitBounds(grupo.getBounds().pad(0.15));
        }

        actualizarRastreoTiempoReal();
    } catch (e) {}
}

var simulacionInterval = null;
var posicionesSimuladas = {};

function actualizarRastreoTiempoReal() {
    if (simulacionInterval) clearInterval(simulacionInterval);

    var enTransito = envios.filter(function(e) { return e.estado === 'En Transito' && coordsParaCiudad(e.destino); });

    enTransito.forEach(function(e) {
        var destino = coordsParaCiudad(e.destino);
        if (!posicionesSimuladas[e.id]) {
            posicionesSimuladas[e.id] = {
                lat: destino[0] + (Math.random() - 0.5) * 5,
                lng: destino[1] + (Math.random() - 0.5) * 5,
            };
        }
    });

    simulacionInterval = setInterval(function() {
        enTransito.forEach(function(e) {
            var destino = coordsParaCiudad(e.destino);
            var pos = posicionesSimuladas[e.id];
            if (!pos || !marcadores[e.id]) return;
            pos.lat += (destino[0] - pos.lat) * 0.08 + (Math.random() - 0.5) * 0.15;
            pos.lng += (destino[1] - pos.lng) * 0.08 + (Math.random() - 0.5) * 0.15;
            marcadores[e.id].setLatLng([pos.lat, pos.lng]);
        });
    }, 2000);
}

function guardar() {
    localStorage.setItem('envios', JSON.stringify(envios));
    localStorage.setItem('contadorId', contadorId);
}

function fechaActual() {
    var opciones = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    return new Date().toLocaleDateString('es-ES', opciones);
}

function actualizarKPIs() {
    document.getElementById('kpi-total').textContent = envios.length;
    document.getElementById('kpi-pendiente').textContent = envios.filter(function(e) { return e.estado === 'Pendiente'; }).length;
    document.getElementById('kpi-transito').textContent = envios.filter(function(e) { return e.estado === 'En Transito'; }).length;
    document.getElementById('kpi-entregado').textContent = envios.filter(function(e) { return e.estado === 'Entregado'; }).length;
}

function claseBadge(estado) {
    if (estado === 'Pendiente') return 'badge-pendiente';
    if (estado === 'En Transito') return 'badge-transito';
    return 'badge-entregado';
}

function renderTabla() {
    var tbody = document.getElementById('tabla-envios');
    if (envios.length === 0) {
        tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;color:#475569;padding:2rem;">No hay envios registrados</td></tr>';
        return;
    }
    tbody.innerHTML = envios.map(function(e) {
        var dist = e._distancia ? formatoDistancia(e._distancia) : '-';
        var tieneRuta = e.origen && coordsParaCiudad(e.origen) && coordsParaCiudad(e.destino);
        return '<tr>'
            + '<td>#' + String(e.id).padStart(4, '0') + '</td>'
            + '<td>' + (e.origen || '-') + '</td>'
            + '<td>' + e.destino + '</td>'
            + '<td><span class="distancia-badge">' + dist + '</span></td>'
            + '<td>' + e.producto + '</td>'
            + '<td>' + e.cantidad + '</td>'
            + '<td>' + e.peso + ' kg</td>'
            + '<td><span class="badge ' + claseBadge(e.estado) + '">' + e.estado + '</span></td>'
            + '<td class="acciones">'
            + (tieneRuta ? '<button class="btn-sm btn-detalle" onclick="enfocarRuta(' + e.id + ')">Detalle</button>' : '')
            + '<button class="btn-sm" onclick="cambiarEstado(' + e.id + ')">Cambiar</button>'
            + '<button class="btn-sm eliminar" onclick="eliminarEnvio(' + e.id + ')">X</button>'
            + '</td></tr>';
    }).join('');
}

function renderGrafico() {
    var contenedor = document.getElementById('grafico-barras');
    var pendientes = envios.filter(function(e) { return e.estado === 'Pendiente'; }).length;
    var transito = envios.filter(function(e) { return e.estado === 'En Transito'; }).length;
    var entregados = envios.filter(function(e) { return e.estado === 'Entregado'; }).length;
    var maximo = Math.max(pendientes, transito, entregados, 1);

    var barras = [
        { label: 'Pendiente', valor: pendientes, color: '#fbbf24' },
        { label: 'Transito', valor: transito, color: '#a78bfa' },
        { label: 'Entregado', valor: entregados, color: '#34d399' },
    ];

    contenedor.innerHTML = barras.map(function(b) {
        return '<div class="barra-container">'
            + '<div class="barra-valor" style="color:' + b.color + '">' + b.valor + '</div>'
            + '<div class="barra" style="height:' + (b.valor / maximo) * 120 + 'px;background:' + b.color + '"></div>'
            + '<div class="barra-label">' + b.label + '</div>'
            + '</div>';
    }).join('');
}

function renderRutas() {
    var contenedor = document.getElementById('lista-rutas');
    var activos = envios.filter(function(e) { return e.estado === 'En Transito'; });
    if (activos.length === 0) {
        contenedor.innerHTML = '<div style="color:#475569;font-size:0.85rem;padding:1rem 0;">Sin rutas activas</div>';
        return;
    }
    contenedor.innerHTML = activos.slice(0, 5).map(function(e) {
        var dist = e._distancia ? formatoDistancia(e._distancia) : '';
        return '<div class="ruta ruta-clickable" onclick="enfocarRuta(' + e.id + ')">'
            + '<div class="ruta-dot" style="background:#a78bfa"></div>'
            + '<span class="ruta-destino">' + (e.origen || '?') + ' &rarr; ' + e.destino + '</span>'
            + '<span class="ruta-fecha">' + dist + '</span>'
            + '</div>';
    }).join('');
}

function render() {
    actualizarKPIs();
    renderTabla();
    renderGrafico();
    renderRutas();
    renderMapa();
}

document.getElementById('form-envio').addEventListener('submit', function(e) {
    e.preventDefault();
    var envio = {
        id: contadorId++,
        origen: document.getElementById('origen').value.trim(),
        destino: document.getElementById('destino').value.trim(),
        producto: document.getElementById('producto').value.trim(),
        cantidad: parseInt(document.getElementById('cantidad').value),
        peso: parseFloat(document.getElementById('peso').value),
        estado: document.getElementById('estado').value,
    };
    envios.push(envio);
    guardar();
    render();
    this.reset();
});

function cambiarEstado(id) {
    var envio = envios.find(function(e) { return e.id === id; });
    if (!envio) return;
    var estados = ['Pendiente', 'En Transito', 'Entregado'];
    var idx = estados.indexOf(envio.estado);
    envio.estado = estados[(idx + 1) % estados.length];
    guardar();
    render();
}

function eliminarEnvio(id) {
    envios = envios.filter(function(e) { return e.id !== id; });
    guardar();
    render();
}

document.getElementById('fecha-actual').textContent = fechaActual();
initMapa();
render();
