let envios = JSON.parse(localStorage.getItem('envios')) || [];
let contadorId = parseInt(localStorage.getItem('contadorId')) || 1;

let mapa = null;
let marcadores = {};
const coordenadasCiudades = {};

const ciudadesBase = {
    'buenos aires': [-34.6037, -58.3816], 'cordoba': [-31.4201, -64.1888],
    'rosario': [-32.9468, -60.6506], 'mendoza': [-32.8895, -68.8458],
    'tucuman': [-26.8240, -65.2226], 'salta': [-24.7829, -65.4232],
    'santa fe': [-31.6333, -60.7000], 'mar del plata': [-38.0055, -57.5426],
    'posadas': [-27.3671, -55.8961], 'chaco': [-27.4516, -59.0234],
    'resistencia': [-27.4516, -59.0234], 'corrientes': [-27.4693, -58.8106],
    'formosa': [-26.1775, -58.1781], 'parana': [-31.7333, -60.5264],
    ' Entre Rios': [-31.7333, -60.5264], 'san juan': [-31.5375, -68.5364],
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
    ' sidney': [-33.8688, 151.2093], 'mumbai': [19.0760, 72.8777],
    'buenos aires': [-34.6037, -58.3816], 'capital federal': [-34.6037, -58.3816],
    'lanus': [-34.6989, -58.3926], 'avellaneda': [-34.6625, -58.3649],
    'quilmes': [-34.7263, -58.2548], 'la plata': [-34.9214, -57.9544],
    'moron': [-34.6537, -58.6198], 'san miguel': [-34.5437, -58.7123],
    'goya': [-29.1420, -59.2663], 'reconquista': [-29.1440, -59.6430],
    'venado tuerto': [-33.7512, -61.9697], 'rafaela': [-31.2644, -61.4867],
};

function coordsParaCiudad(nombre) {
    const lower = nombre.toLowerCase().trim();
    if (coordenadasCiudades[lower]) return coordenadasCiudades[lower];
    if (ciudadesBase[lower]) return ciudadesBase[lower];
    const keys = Object.keys(ciudadesBase);
    for (const key of keys) {
        if (lower.includes(key) || key.includes(lower)) return ciudadesBase[key];
    }
    return null;
}

function initMapa() {
    if (mapa) return;
    mapa = L.map('mapa', { zoomControl: true }).setView([-34.6037, -58.3816], 4);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; OpenStreetMap, &copy; CARTO',
        maxZoom: 19,
    }).addTo(mapa);
}

function colorEstado(estado) {
    if (estado === 'Pendiente') return '#fbbf24';
    if (estado === 'En Transito') return '#a78bfa';
    return '#34d399';
}

function crearIcono(color) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="42" viewBox="0 0 32 42">
        <path d="M16 0C7.16 0 0 7.16 0 16c0 12 16 26 16 26s16-14 16-26C32 7.16 24.84 0 16 0z" fill="${color}" stroke="#0f172a" stroke-width="2"/>
        <circle cx="16" cy="16" r="7" fill="#0f172a"/>
    </svg>`;
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

function renderMapa() {
    if (!mapa) return;

    Object.values(marcadores).forEach(m => mapa.removeLayer(m));
    marcadores = {};

    const enviosConCoords = envios.filter(e => {
        const c = coordsParaCiudad(e.destino);
        if (c) { coordenadasCiudades[e.destino.toLowerCase().trim()] = c; }
        return c !== null;
    });

    enviosConCoords.forEach(e => {
        const coords = coordsParaCiudad(e.destino);
        const color = colorEstado(e.estado);

        const marker = L.marker(coords, { icon: crearIcono(color) }).addTo(mapa);
        marker.bindPopup(`
            <div class="popup-destino">${e.destino}</div>
            <div class="popup-info">Producto: ${e.producto}</div>
            <div class="popup-info">Cantidad: ${e.cantidad} uds</div>
            <div class="popup-info">Peso: ${e.peso} kg</div>
            <span class="popup-estado" style="${badgeColor(e.estado)}">${e.estado}</span>
        `);
        marcadores[e.id] = marker;
    });

    if (enviosConCoords.length > 0) {
        const grupo = L.featureGroup(Object.values(marcadores));
        mapa.fitBounds(grupo.getBounds().pad(0.2));
    }

    actualizarRastreoTiempoReal();
}

let simulacionInterval = null;
const posicionesSimuladas = {};

function actualizarRastreoTiempoReal() {
    if (simulacionInterval) clearInterval(simulacionInterval);

    const enTransito = envios.filter(e => e.estado === 'En Transito' && coordsParaCiudad(e.destino));

    enTransito.forEach(e => {
        const destino = coordsParaCiudad(e.destino);
        if (!posicionesSimuladas[e.id]) {
            posicionesSimuladas[e.id] = {
                lat: destino[0] + (Math.random() - 0.5) * 5,
                lng: destino[1] + (Math.random() - 0.5) * 5,
            };
        }
    });

    simulacionInterval = setInterval(() => {
        enTransito.forEach(e => {
            const destino = coordsParaCiudad(e.destino);
            const pos = posicionesSimuladas[e.id];
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
    const opciones = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    return new Date().toLocaleDateString('es-ES', opciones);
}

function actualizarKPIs() {
    const total = envios.length;
    const pendientes = envios.filter(e => e.estado === 'Pendiente').length;
    const transito = envios.filter(e => e.estado === 'En Transito').length;
    const entregados = envios.filter(e => e.estado === 'Entregado').length;

    document.getElementById('kpi-total').textContent = total;
    document.getElementById('kpi-pendiente').textContent = pendientes;
    document.getElementById('kpi-transito').textContent = transito;
    document.getElementById('kpi-entregado').textContent = entregados;
}

function claseBadge(estado) {
    if (estado === 'Pendiente') return 'badge-pendiente';
    if (estado === 'En Transito') return 'badge-transito';
    return 'badge-entregado';
}

function renderTabla() {
    const tbody = document.getElementById('tabla-envios');
    if (envios.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:#475569;padding:2rem;">No hay envios registrados</td></tr>';
        return;
    }
    tbody.innerHTML = envios.map(e => `
        <tr>
            <td>#${String(e.id).padStart(4, '0')}</td>
            <td>${e.destino}</td>
            <td>${e.producto}</td>
            <td>${e.cantidad}</td>
            <td>${e.peso} kg</td>
            <td><span class="badge ${claseBadge(e.estado)}">${e.estado}</span></td>
            <td class="acciones">
                <button class="btn-sm" onclick="cambiarEstado(${e.id})">Cambiar</button>
                <button class="btn-sm eliminar" onclick="eliminarEnvio(${e.id})">X</button>
            </td>
        </tr>
    `).join('');
}

function renderGrafico() {
    const contenedor = document.getElementById('grafico-barras');
    const pendientes = envios.filter(e => e.estado === 'Pendiente').length;
    const transito = envios.filter(e => e.estado === 'En Transito').length;
    const entregados = envios.filter(e => e.estado === 'Entregado').length;
    const maximo = Math.max(pendientes, transito, entregados, 1);

    const barras = [
        { label: 'Pendiente', valor: pendientes, color: '#fbbf24' },
        { label: 'Transito', valor: transito, color: '#a78bfa' },
        { label: 'Entregado', valor: entregados, color: '#34d399' },
    ];

    contenedor.innerHTML = barras.map(b => `
        <div class="barra-container">
            <div class="barra-valor" style="color:${b.color}">${b.valor}</div>
            <div class="barra" style="height:${(b.valor / maximo) * 120}px;background:${b.color}"></div>
            <div class="barra-label">${b.label}</div>
        </div>
    `).join('');
}

function renderRutas() {
    const contenedor = document.getElementById('lista-rutas');
    const activos = envios.filter(e => e.estado === 'En Transito');
    if (activos.length === 0) {
        contenedor.innerHTML = '<div style="color:#475569;font-size:0.85rem;padding:1rem 0;">Sin rutas activas</div>';
        return;
    }
    contenedor.innerHTML = activos.slice(0, 5).map(e => `
        <div class="ruta">
            <div class="ruta-dot" style="background:#a78bfa"></div>
            <span class="ruta-destino">${e.destino}</span>
            <span class="ruta-fecha">${e.producto}</span>
        </div>
    `).join('');
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
    const envio = {
        id: contadorId++,
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
    const envio = envios.find(e => e.id === id);
    if (!envio) return;
    const estados = ['Pendiente', 'En Transito', 'Entregado'];
    const idx = estados.indexOf(envio.estado);
    envio.estado = estados[(idx + 1) % estados.length];
    guardar();
    render();
}

function eliminarEnvio(id) {
    envios = envios.filter(e => e.id !== id);
    guardar();
    render();
}

document.getElementById('fecha-actual').textContent = fechaActual();
initMapa();
render();
