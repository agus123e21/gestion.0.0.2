# 🔌 Documentación de APIs Integradas — TerMate

Este documento detalla el funcionamiento técnico, endpoints, parámetros y formatos de respuesta de las APIs externas integradas en el sistema de gestión de fletes **TerMate**.

---

## 🗺️ 1. Geocodificación y Autocompletado

### 1.1 Nominatim (OpenStreetMap) — Búsqueda Federal
Utilizada como geocodificador principal para sugerencias federales en tiempo real y fallback de coordenadas. Está restringida a la República Argentina.

*   **Método:** `GET`
*   **Endpoint:** `https://nominatim.openstreetmap.org/search`
*   **Headers requeridos:**
    *   `User-Agent: TerMate/2.1` (Evita bloqueos de tráfico por parte de la OSM Foundation)

#### Parámetros de Consulta:
| Parámetro | Tipo | Valor / Ejemplo | Descripción |
| :--- | :--- | :--- | :--- |
| `q` | String | `Av. San Martin 450, Cordoba` | Texto de búsqueda ingresado por el usuario. |
| `format` | String | `json` | Formato de respuesta esperado. |
| `limit` | Integer | `5` | Límite máximo de sugerencias a retornar. |
| `countrycodes`| String | `ar` | Restringe los resultados únicamente a Argentina. |
| `addressdetails`| Integer| `1` | Desglosa la dirección en atributos (calle, ciudad, provincia). |

#### Ejemplo de Petición:
```http
GET https://nominatim.openstreetmap.org/search?q=Av+San+Martin+450&format=json&limit=5&countrycodes=ar&addressdetails=1
```

#### Ejemplo de Respuesta (Simplificada):
```json
[
  {
    "place_id": 284102941,
    "licence": "Data © OpenStreetMap contributors, ODbL 1.0.",
    "lat": "-31.416805",
    "lon": "-64.188544",
    "display_name": "Avenida General San Martín 450, Córdoba, Municipio de Córdoba, Departamento Capital, Córdoba, X5000, Argentina",
    "address": {
      "road": "Avenida General San Martín",
      "house_number": "450",
      "city": "Córdoba",
      "state": "Córdoba",
      "postcode": "X5000",
      "country": "Argentina",
      "country_code": "ar"
    }
  }
]
```

---

### 1.2 API Georef (Gobierno de la Nación Argentina)
Utilizada para la normalización oficial de direcciones públicas de catastro y nombres de calles bajo estándares gubernamentales del IGN.

*   **Método:** `GET`
*   **Endpoint:** `https://apis.datos.gob.ar/georef/api/v2.1/direcciones`

#### Parámetros de Consulta:
| Parámetro | Tipo | Valor / Ejemplo | Descripción |
| :--- | :--- | :--- | :--- |
| `direccion` | String | `Paseo Colon 850` | Calle y altura a normalizar. |
| `max` | Integer | `1` | Cantidad máxima de coincidencias. |
| `provincia` | String | `Buenos Aires` | (Opcional) Filtro por provincia. |

#### Ejemplo de Petición:
```http
GET https://apis.datos.gob.ar/georef/api/v2.1/direcciones?direccion=Av+Corrientes+1234&max=1
```

#### Ejemplo de Respuesta:
```json
{
  "direcciones": [
    {
      "calle": {
        "id": "0200701002360",
        "nombre": "CORRIENTES AV."
      },
      "altura": {
        "valor": 1234
      },
      "nomenclatura": "CORRIENTES AV. 1234, Ciudad Autónoma de Buenos Aires",
      "ubicacion": {
        "lat": -34.603784,
        "lon": -58.381561
      }
    }
  ]
}
```

---

## 🚛 2. Cálculo de Rutas y Enrutamiento Pesado

### 2.1 OpenRouteService (ORS) — Perfil HGV (Heavy Goods Vehicle)
Es la API principal de enrutamiento. Calcula la trayectoria óptima para vehículos de carga, evitando obstáculos físicos o legales en base a las dimensiones ingresadas por el gerente en el perfil de su camión.

*   **Método:** `POST`
*   **Endpoint:** `https://api.openrouteservice.org/v2/directions/driving-hgv`
*   **Headers requeridos:**
    *   `Content-Type: application/json`
    *   `Authorization: [TU_API_KEY]` (Opcional para entornos locales de pruebas, requerido en producción)

#### Estructura del Body (JSON):
```json
{
  "coordinates": [
    [-58.3815, -34.6037], 
    [-64.1885, -31.4168]
  ],
  "options": {
    "profile_params": {
      "restrictions": {
        "height": 4.0,
        "width": 2.5,
        "length": 18.0,
        "weight": 20.0,
        "axleload": 6.7
      }
    }
  }
}
```
*Nota: Las coordenadas en ORS se envían en formato `[Longitud, Latitud]`.*

#### Parámetros del Body:
| Campo | Tipo | Ejemplo | Descripción |
| :--- | :--- | :--- | :--- |
| `coordinates` | Array | `[[lon, lat], [lon, lat]]` | Lista de puntos de paso (origen y destino). |
| `height` | Float | `4.0` | Altura máxima del camión en metros. |
| `width` | Float | `2.5` | Ancho del camión en metros. |
| `length` | Float | `18.0` | Longitud total del camión en metros. |
| `weight` | Float | `20.0` | Peso total del camión cargado en toneladas. |
| `axleload` | Float | `6.7` | Carga máxima por eje en toneladas. |

#### Ejemplo de Respuesta:
```json
{
  "routes": [
    {
      "summary": {
        "distance": 695240.5,
        "duration": 29840.0
      },
      "geometry": "i~_bFzzg`Jj@hC`@vD...",
      "warnings": [
        {
          "code": 3,
          "message": "Ruta calculada contiene restricciones de peso en Puente Vial Nacional."
        }
      ]
    }
  ]
}
```
*   `summary.distance`: Distancia total en metros (se divide por `1000` en JS para mostrar en km).
*   `summary.duration`: Duración del viaje en segundos (se divide por `3600` para mostrar en horas).
*   `geometry`: Cadena codificada mediante el algoritmo **Encoded Polyline** (precisión de 5 decimales) que contiene la lista secuencial de coordenadas de la ruta.

---

### 2.2 OSRM (Open Source Routing Machine) — Fallback Estándar
API secundaria de enrutamiento en tiempo real. Utilizada cuando la API de ORS falla o no tiene cobertura de red de camiones disponible en ese segmento específico. Calcula rutas para automóviles y carece de filtrado por dimensiones.

*   **Método:** `GET`
*   **Endpoint:** `https://router.project-osrm.org/route/v1/driving/{lon_origen},{lat_origen};{lon_destino},{lat_destino}`

#### Parámetros de Consulta:
| Parámetro | Tipo | Valor / Ejemplo | Descripción |
| :--- | :--- | :--- | :--- |
| `overview` | String | `full` | Retorna la geometría completa de la ruta. |
| `geometries` | String | `geojson` | Formato de respuesta de la línea de ruta. |

#### Ejemplo de Petición:
```http
GET https://router.project-osrm.org/route/v1/driving/-58.3815,-34.6037;-64.1885,-31.4168?overview=full&geometries=geojson
```

#### Ejemplo de Respuesta:
```json
{
  "code": "Ok",
  "routes": [
    {
      "distance": 698240.2,
      "duration": 26450.0,
      "geometry": {
        "coordinates": [
          [-58.3815, -34.6037],
          [-58.3892, -34.6081],
          [-64.1885, -31.4168]
        ],
        "type": "LineString"
      }
    }
  ]
}
```

---

## 🛢️ 3. Cálculo de Consumo Real de Combustible

El consumo promedio de un camión en ruta no es constante; varía drásticamente según la carga útil transportada. TerMate utiliza un modelo de **interpolación lineal** configurable por el gerente desde la sección de ajustes:

### Variables de Entrada:
*   $C_{\text{vacío}}$: Consumo del camión sin carga en $\text{L}/100\text{ km}$ (ej: $25\text{ L}$).
*   $C_{\text{lleno}}$: Consumo del camión a carga máxima en $\text{L}/100\text{ km}$ (ej: $38\text{ L}$).
*   $P_{\text{máx}}$: Capacidad máxima de carga del camión en toneladas (ej: $20\text{ tn}$).
*   $P_{\text{carga}}$: Peso actual de la carga asignada al viaje en toneladas.
*   $D$: Distancia total calculada para la ruta en kilómetros.

### Ecuación de Consumo por Viaje:
El consumo se ajusta proporcionalmente al porcentaje de capacidad de carga utilizada:

$$C_{\text{estimado}} = \left( C_{\text{vacío}} + (C_{\text{lleno}} - C_{\text{vacío}}) \times \min\left(1, \frac{P_{\text{carga}}}{P_{\text{máx}}}\right) \right) \times \frac{D}{100}$$

#### Ejemplo Práctico:
Para un viaje de **$500\text{ km}$**, con un camión de capacidad máxima de **$20\text{ tn}$**, consumo vacío de **$25\text{ L}$**, consumo cargado de **$38\text{ L}$**, transportando una carga de **$10\text{ tn}$** (50% de su capacidad):

1.  **Ratio de Carga:** $\frac{10}{20} = 0.5$ (50%)
2.  **Consumo Ajustado:** $25 + (38 - 25) \times 0.5 = 31.5\text{ L}/100\text{ km}$
3.  **Total Consumido:** $31.5 \times \frac{500}{100} = 157.5\text{ L}$ (mostrado como `~158 L`)

---

## 📴 4. Fallback de Enrutamiento (Fuera de Línea)

Cuando el dispositivo de celular se encuentra **sin señal de red (offline)** y se ingresa una dirección cacheada, el sistema activa el cálculo por **Fórmula de Haversine** (distancia del círculo máximo).

$$\text{d} = 2R \arcsin \left( \sqrt{\sin^2\left(\frac{\Delta \text{lat}}{2}\right) + \cos(\text{lat}_1)\cos(\text{lat}_2)\sin^2\left(\frac{\Delta \text{lon}}{2}\right)} \right)$$

*   Donde $R = 6371\text{ km}$ (Radio medio de la Tierra).
*   **Velocidad de simulación por defecto:** $70\text{ km/h}$ para vehículos de carga pesada.
*   **Trayectoria:** Línea recta directa entre el punto de origen y destino.
