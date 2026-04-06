// Configuración del Mapa
const SOUTH_AMERICA_COORDS = [-20.0, -58.0]; // Centrado para ver Sudamérica
const ZOOM_LEVEL = 4.5;

const map = L.map('map', { 
    zoomControl: false,
    minZoom: 2,
    preferCanvas: true
}).setView(SOUTH_AMERICA_COORDS, ZOOM_LEVEL);
L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; CARTO', subdomains: 'abcd', maxZoom: 20
}).addTo(map);

// Variables Globales 
const flightState = {}; 
const statusText = document.getElementById('statusText');
const flightCountSpan = document.getElementById('flightCount');
const flightsList = document.getElementById('flightsList');
const statusContainer = document.querySelector('.status');
let currentFilter = 'ALL'; 
let showTrajectories = true;
let exploreGlobal = false;
const globalMarkersGroup = L.layerGroup().addTo(map);

// MACRO BBOX: Paraguay y países fronterizos (Para obtener datos REALES globales sin saturar la red gratuita)
const BBOX = { lamin: -32.0, lamax: -18.0, lomin: -65.0, lomax: -50.0 };
const OPENSKY_URL = `https://opensky-network.org/api/states/all?lamin=${BBOX.lamin}&lomin=${BBOX.lomin}&lamax=${BBOX.lamax}&lomax=${BBOX.lomax}`;

// Aerolíneas Válidas (Comerciales y Carga)
const VALID_AIRLINES = [
    // Comerciales
    'AZP', 'LAP', 'CMP', 'AEA', 'GLO', 'ARG', 'JAT', 'AVA',
    // Carga Pesada (Cargo)
    'GTI', 'FDX', 'UPS', 'DAE', 'LCO', 'MAA', 'TPA', 'KYE', 'CKS'
];

// --- SISTEMA DE ÍCONOS Y MODELOS ---
function getAircraftType(icao24) {
    if (!icao24) return 0;
    let hash = 0;
    for (let i = 0; i < icao24.length; i++) hash = icao24.charCodeAt(i) + ((hash << 5) - hash);
    return Math.abs(hash) % 4; 
}

const SVGS = {
    0: `<path d="M21 16V14L13 9V3.5C13 2.67 12.33 2 11.5 2C10.67 2 10 2.67 10 3.5V9L2 14V16L10 13.5V19L8 20.5V22L11.5 21L15 22V20.5L13 19V13.5L21 16Z" fill="COLOR"/>`,
    1: `<path d="M11.5 2C10.67 2 10 2.67 10 3.5V6L2 10V12L10 11V18L8 19.5V21L11.5 20L15 21V19.5L13 18V11L21 12V10L13 6V3.5C13 2.67 12.33 2 11.5 2Z" fill="COLOR"/><rect x="9" y="1" width="5" height="1" fill="COLOR"/>`, 
    2: `<path d="M22 15V13L13 8V3.5C13 2.67 12.33 2 11.5 2C10.67 2 10 2.67 10 3.5V8L1 13V15L10 12.5V18L7 20V22L11.5 20.5L16 22V20L13 18V12.5L22 15Z" fill="COLOR"/>`, 
    3: `<path d="M11.5 2C11 2 10.5 2.5 10.5 3.5V10L5 15V16L10.5 14V19L9 20.5V22L11.5 21L14 22V20.5L12.5 19V14L18 16V15L12.5 10V3.5C12.5 2.5 12 2 11.5 2Z" fill="COLOR"/>`
};

const MODELS = {
    0: ['Airbus A320neo', 'Boeing 737-800', 'Airbus A321', 'Embraer 190'], 
    1: ['Cessna 208 Caravan', 'ATR 72-600', 'Piper PA-34', 'Beechcraft King Air'], 
    2: ['Boeing 777-300ER', 'Airbus A330-200', 'Boeing 787-9 Dreamliner', 'Airbus A350-900'], 
    3: ['Gulfstream G650', 'Bombardier Challenger 350', 'Cessna Citation X', 'Dassault Falcon 8X'] 
};

function getAircraftModel(icao24, type) {
    if(!icao24) return MODELS[type][0];
    let hash = 0;
    for (let i=0; i<icao24.length; i++) hash += icao24.charCodeAt(i);
    return MODELS[type][hash % MODELS[type].length];
}

const getAirplaneSvg = (type, color) => `
<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" class="airplane-icon">
    ${SVGS[type].replace(/COLOR/g, color)}
</svg>`;

function createRotatedIcon(type, heading) {
    return L.divIcon({
        html: `<div class="icon-rotator" style="transform: rotate(${heading || 0}deg); transform-origin: center center;">${getAirplaneSvg(type, '#06b6d4')}</div>`,
        className: 'custom-airplane-icon',
        iconSize: [24, 24],
        iconAnchor: [12, 12]
    });
}

// --- AEROPUERTOS Y TABLEROS ---
const AIRPORTS = {
    'ASU': { name: 'Silvio Pettirossi Int.', lat: -25.240, lng: -57.518, code: 'ASU / SGAS' },
    'AGT': { name: 'Guaraní International', lat: -25.455, lng: -54.843, code: 'AGT / SGME' },
    'ENO': { name: 'Tte. Amin Ayub Gonzalez', lat: -27.228, lng: -55.836, code: 'ENO / SGEN' }
};

Object.keys(AIRPORTS).forEach(key => {
    const apt = AIRPORTS[key];
    const icon = L.divIcon({
        html: `<div class="airport-icon-container" title="${apt.name}"><i class="ph-fill ph-broadcast"></i></div>`,
        className: '', iconSize: [32, 32], iconAnchor: [16, 16]
    });
    L.marker([apt.lat, apt.lng], {icon: icon})
     .addTo(map)
     .on('click', () => openAirportModal(key));
});

// Modal Logic
const modal = document.getElementById('airportModal');
const boardTableBody = document.getElementById('boardTableBody');
let currentAirport = null;
let currentTab = 'arrivals'; 

document.getElementById('closeModal').addEventListener('click', () => modal.classList.add('hidden'));

document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
        currentTab = e.target.getAttribute('data-tab');
        renderBoard();
    });
});

function openAirportModal(aptKey) {
    currentAirport = AIRPORTS[aptKey];
    document.getElementById('modalAirportTitle').innerText = currentAirport.name;
    document.getElementById('modalAirportCode').innerText = currentAirport.code;
    modal.classList.remove('hidden');
    renderBoard();
}

const AIRLINE_LINKS = {
    'Copa Airlines': 'https://www.copaair.com/',
    'LATAM Paraguay': 'https://www.latamairlines.com/',
    'Paranair': 'https://www.paranair.com/',
    'Aerolíneas Argentinas': 'https://www.aerolineas.com.ar/',
    'Air Europa': 'https://www.aireuropa.com/',
    'Gol': 'https://www.voegol.com.br/',
    'JetSmart': 'https://jetsmart.com/'
};

function generateDummySchedules(tabType) {
    const airlines = Object.keys(AIRLINE_LINKS);
    const cities = ['Buenos Aires', 'São Paulo', 'Santiago', 'Panamá', 'Madrid', 'Santa Cruz', 'Montevideo', 'Bogotá'];
    let rows = '';
    const numFlights = tabType === 'scheduled' ? 8 : (Math.floor(Math.random() * 5) + 3); 
    let baseTime = new Date();
    
    for(let i=0; i<numFlights; i++) {
        if (tabType === 'scheduled') {
            baseTime = new Date(baseTime.getTime() + (Math.random() * 2880 + 120) * 60000); // 2 a 48 hs al futuro
        } else {
            baseTime = new Date(baseTime.getTime() + (Math.random() * 45 + 15) * 60000); 
        }
        
        let timeStr = "";
        if (tabType === 'scheduled') {
            const days = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
            timeStr = `${days[baseTime.getDay()]} ${baseTime.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}`;
        } else {
            timeStr = baseTime.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
        }

        const airline = airlines[Math.floor(Math.random() * airlines.length)];
        const flightNum = airline.substring(0,2).toUpperCase() + Math.floor(Math.random() * 900 + 100);
        const city = cities[Math.floor(Math.random() * cities.length)];
        const link = AIRLINE_LINKS[airline];
        
        let statusObj = { text: 'En Horario', class: 'status-ontime' };
        if (tabType === 'scheduled') {
            statusObj = { text: 'Confirmado', class: 'status-ontime' };
        } else {
            const rand = Math.random();
            if (rand > 0.8) statusObj = { text: 'Demorado', class: 'status-delayed' };
            else if (rand > 0.5 && tabType === 'departures') statusObj = { text: 'Abordando', class: 'status-boarding' };
        }

        rows += `<tr>
            <td><strong>${flightNum}</strong><br>
                <a href="${link}" target="_blank" class="airline-link" title="Ir a la web para Reservar o Check-in">
                    ${airline} <i class="ph ph-arrow-square-out"></i>
                </a>
            </td>
            <td>${city}</td><td>${timeStr}</td>
            <td><span class="status-badge ${statusObj.class}">${statusObj.text}</span></td>
        </tr>`;
    }
    return rows;
}
function renderBoard() {
    boardTableBody.innerHTML = `<tr><td colspan="4" style="text-align:center"><i class="ph ph-spinner ph-spin"></i> Cargando...</td></tr>`;
    setTimeout(() => { boardTableBody.innerHTML = generateDummySchedules(currentTab); }, 400);
}


// --- LÓGICA DE FILTROS GLOBALES ---
document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
        currentFilter = e.target.getAttribute('data-filter');
        if(window.lastFlightsData) {
            updateFlightSidebarAndMap(window.lastFlightsData);
        }
    });
});

// PREDICCIÓN GEODÉSICA Larga Distancia
function getCardinalDirection(angle) {
    const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    return dirs[Math.round(angle / 45) % 8];
}

function getHaversineDistance(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
}

function predictDestination(lat, lng, track) {
    if (!lat || !lng || track === null) return null;
    let closestApt = null;
    let minDistance = 9999;

    for (let key in AIRPORTS) {
        let apt = AIRPORTS[key];
        let dLat = apt.lat - lat;
        let dLng = apt.lng - lng;
        let distDeg = Math.hypot(dLat, dLng); 
        
        // Ahora permitimos distancias enormes (aprox 6000km)
        if (distDeg > 55) continue; 

        let phi1 = lat * Math.PI/180, phi2 = apt.lat * Math.PI/180;
        let dL = (apt.lng - lng) * Math.PI/180;
        let y = Math.sin(dL) * Math.cos(phi2);
        let x = Math.cos(phi1)*Math.sin(phi2) - Math.sin(phi1)*Math.cos(phi2)*Math.cos(dL);
        let brng = Math.atan2(y, x) * 180 / Math.PI;
        brng = (brng + 360) % 360;

        let diff = Math.abs(brng - track);
        if (diff > 180) diff = 360 - diff;
        
        // El margen de error es menor mientras mas lejos este
        let tolerance = distDeg > 15 ? 5 : 12;

        if (diff <= tolerance && distDeg < minDistance) {
            closestApt = key;
            minDistance = distDeg;
        }
    }
    return closestApt;
}


// --- ENGINE ANIMACIÓN (60 FPS) ---
let lastFrameTime = performance.now();
function animateMap() {
    const now = performance.now();
    const dt = (now - lastFrameTime) / 1000; 
    lastFrameTime = now;

    Object.values(flightState).forEach(flight => {
        if (!flight.velocity || !flight.track || !flight.visible) return;
        
        // Movimiento trigonométrico predictivo + LERP corrector hacia el dato real del servidor
        const distanceDegrees = (flight.velocity * dt) / 111320; 
        flight.lat += Math.cos(flight.track * Math.PI / 180) * distanceDegrees;
        flight.lng += Math.sin(flight.track * Math.PI / 180) * distanceDegrees;
        
        // Suave corrección (Glide) para empalmar con la lectura del satélite cada 5 seg
        flight.lat += (flight.targetLat - flight.lat) * 0.05;
        flight.lng += (flight.targetLng - flight.lng) * 0.05;

        if (flight.marker) {
            flight.marker.setLatLng([flight.lat, flight.lng]);
        }
        if (flight.line && flight.destLat && flight.destLng) {
            flight.line.setLatLngs([ [flight.lat, flight.lng], [flight.destLat, flight.destLng] ]);
        }
    });
    requestAnimationFrame(animateMap);
}
requestAnimationFrame(animateMap);

function isAirlineMatching(callsign) {
    if (!callsign) return false;
    let up = callsign.trim().toUpperCase();
    for (let prefix of VALID_AIRLINES) {
        if (up.startsWith(prefix)) return true;
    }
    return false;
}

// --- ACTUALIZACIÓN DE PROCESAMIENTO ESTRICTO ---
function updateFlightSidebarAndMap(flights) {
    window.lastFlightsData = flights;

    let validParaguayFlights = [];
    flights.forEach(f => {
        const callsign = (f[1] || '').trim();
        const onGround = f[8];

        if (!onGround && isAirlineMatching(callsign)) {
            let hdg = f[10] || 0;
            let pDest = predictDestination(f[6], f[5], hdg);
            if (pDest !== null) {
                f.__predictedDest = pDest;
                validParaguayFlights.push(f);
            }
        }
    });

    if (validParaguayFlights.length === 0) {
        flightCountSpan.innerText = "0";
        flightsList.innerHTML = `<li class="loading-state"><i class="ph ph-radar"></i><p>Ningún vuelo en camino detectado en la región continental.</p></li>`;
        Object.keys(flightState).forEach(icao24 => {
            map.removeLayer(flightState[icao24].marker);
            delete flightState[icao24];
        });
        return;
    }

    let listHTML = '';
    const currentIcao24s = new Set();
    let visibleCount = 0;

    validParaguayFlights.forEach(flight => {
        const icao24 = flight[0];
        const callsign = (flight[1] || '').trim();
        const origin = flight[2] || 'Desc.';
        let targetLng = flight[5];
        let targetLat = flight[6];
        const altitude = flight[7] !== null ? Math.round(flight[7]) + 'm' : 'N/A';
        const velocity = flight[9] !== null ? flight[9] : 0; 
        const heading = flight[10] || 0;
        const predictedApt = flight.__predictedDest;
        const matchesFilter = currentFilter === 'ALL' || currentFilter === predictedApt;

        if (!targetLat || !targetLng) return;

        currentIcao24s.add(icao24);
        const type = getAircraftType(icao24);
        const modelStr = getAircraftModel(icao24, type);
        
        let etaStr = "N/A";
        let elapsedStr = "N/A";
        let destLat = null, destLng = null;
        const cardinalStr = getCardinalDirection(heading);
        
        if (predictedApt && AIRPORTS[predictedApt]) {
            const apt = AIRPORTS[predictedApt];
            destLat = apt.lat; destLng = apt.lng;
            const distanceKm = getHaversineDistance(targetLat, targetLng, destLat, destLng);
            const speedKmh = velocity * 3.6 || 1;
            const etaMins = Math.round((distanceKm / speedKmh) * 60);
            etaStr = etaMins > 60 ? `${Math.floor(etaMins/60)}h ${etaMins%60}m` : `${etaMins}m`;
        }
        let hashData = 0;
        for (let i = 0; i < icao24.length; i++) hashData += icao24.charCodeAt(i);
        const elapsedTotalMins = (hashData % 300) + 30; 
        elapsedStr = elapsedTotalMins > 60 ? `${Math.floor(elapsedTotalMins/60)}h ${elapsedTotalMins%60}m` : `${elapsedTotalMins}m`;

        const popupText = `<strong>${callsign}</strong><br><small>${modelStr}</small><hr>Destino: ${predictedApt} (ETA: ${etaStr})<br>Curso: ${Math.round(heading)}° ${cardinalStr}<br>Altitud: ${altitude}<br>Vel.: ${Math.round(velocity*3.6)} km/h`;

        if (flightState[icao24]) {
            flightState[icao24].targetLat = targetLat;
            flightState[icao24].targetLng = targetLng;
            if (Math.hypot(flightState[icao24].lat - targetLat, flightState[icao24].lng - targetLng) > 0.5) { 
                flightState[icao24].lat = targetLat; flightState[icao24].lng = targetLng;
            }
            flightState[icao24].velocity = velocity;
            flightState[icao24].track = heading;
            flightState[icao24].predictedDest = predictedApt;
            flightState[icao24].visible = matchesFilter;
            flightState[icao24].destLat = destLat;
            flightState[icao24].destLng = destLng;

            flightState[icao24].marker.setIcon(createRotatedIcon(type, heading));
            flightState[icao24].marker.getPopup().setContent(popupText);
            
            if (matchesFilter) {
                if (!map.hasLayer(flightState[icao24].marker)) map.addLayer(flightState[icao24].marker);
                if (showTrajectories && flightState[icao24].line && !map.hasLayer(flightState[icao24].line)) {
                    map.addLayer(flightState[icao24].line);
                } else if (!showTrajectories && flightState[icao24].line && map.hasLayer(flightState[icao24].line)) {
                    map.removeLayer(flightState[icao24].line);
                }
            } else {
                if (map.hasLayer(flightState[icao24].marker)) map.removeLayer(flightState[icao24].marker);
                if (flightState[icao24].line && map.hasLayer(flightState[icao24].line)) map.removeLayer(flightState[icao24].line);
            }
        } else {
            const marker = L.marker([targetLat, targetLng], { icon: createRotatedIcon(type, heading) })
                .bindPopup(popupText);

            let line = null;
            if (destLat && destLng) {
                line = L.polyline([[targetLat, targetLng], [destLat, destLng]], { color: '#06b6d4', dashArray: '4, 10', weight: 2, opacity: 0.6 });
            }
            
            if (matchesFilter) {
                marker.addTo(map);
                if (showTrajectories && line) line.addTo(map);
            }
            
            flightState[icao24] = {
                marker: marker, line: line, lat: targetLat, lng: targetLng, targetLat: targetLat, targetLng: targetLng,
                destLat: destLat, destLng: destLng,
                velocity: velocity, track: heading, type: type, predictedDest: predictedApt, visible: matchesFilter
            };
        }

        if (matchesFilter) {
            visibleCount++;
            let iconClass = type === 1 ? 'ph-airplane' : 'ph-airplane-in-flight'; 
            listHTML += `
                <li class="flight-card" onclick="focusOnFlight('${icao24}')">
                    <div class="fc-header" style="margin-bottom:8px">
                        <span class="fc-callsign"><i class="ph-fill ${iconClass}"></i> ${callsign}</span>
                        <span style="background:rgba(16, 185, 129, 0.2); color:var(--success-color); padding: 2px 6px; border-radius: 8px; font-size: 10px;">Hacia ${predictedApt}</span>
                    </div>
                    <div style="font-size:11px; color:var(--text-secondary); margin-bottom:12px;">${modelStr} | ${origin}</div>
                    <div class="fc-details">
                        <div class="fc-stat">
                            <i class="ph ph-trend-up"></i>
                            <div class="fc-stat-content">
                                <span class="fc-stat-label">Altitud</span><span class="fc-stat-val">${altitude}</span>
                            </div>
                        </div>
                        <div class="fc-stat">
                            <i class="ph ph-compass"></i>
                            <div class="fc-stat-content">
                                <span class="fc-stat-label">Curso</span><span class="fc-stat-val">${Math.round(heading)}° ${cardinalStr}</span>
                            </div>
                        </div>
                        <div class="fc-stat">
                            <i class="ph ph-gauge"></i>
                            <div class="fc-stat-content">
                                <span class="fc-stat-label">Velocidad</span><span class="fc-stat-val">${Math.round(velocity*3.6)} km/h</span>
                            </div>
                        </div>
                        <div class="fc-stat">
                            <i class="ph ph-timer"></i>
                            <div class="fc-stat-content">
                                <span class="fc-stat-label">En Aire</span><span class="fc-stat-val">${elapsedStr}</span>
                            </div>
                        </div>
                        <div class="fc-stat">
                            <i class="ph ph-flag-checkered"></i>
                            <div class="fc-stat-content">
                                <span class="fc-stat-label">Llegada (ETA)</span><span class="fc-stat-val">${etaStr}</span>
                            </div>
                        </div>
                    </div>
                </li>
            `;
        }
    });

    if (visibleCount === 0 && validParaguayFlights.length > 0) {
        listHTML = `<li class="loading-state"><i class="ph ph-funnel"></i><p>Ningún vuelo coincide con tu filtro.</p></li>`;
    }
    flightsList.innerHTML = listHTML;
    flightCountSpan.innerText = visibleCount;
    const mobileBadge = document.getElementById('mobileBadge');
    if (mobileBadge) mobileBadge.innerText = visibleCount;

    Object.keys(flightState).forEach(icao24 => {
        if (!currentIcao24s.has(icao24)) {
            if (flightState[icao24].marker) map.removeLayer(flightState[icao24].marker);
            if (flightState[icao24].line) map.removeLayer(flightState[icao24].line);
            delete flightState[icao24];
        }
    });

    statusText.innerText = 'Radar Largo Alcance';
    statusContainer.classList.remove('error');
}

const mobileFlightsToggle = document.getElementById('mobileFlightsToggle');
const closeSidebarMobile = document.getElementById('closeSidebarMobile');
const sidebar = document.querySelector('.sidebar');
const mobileBadge = document.getElementById('mobileBadge');

if (mobileFlightsToggle) {
    mobileFlightsToggle.addEventListener('click', () => {
        sidebar.classList.add('open');
        mobileFlightsToggle.style.display = 'none';
    });
}
if (closeSidebarMobile) {
    closeSidebarMobile.addEventListener('click', () => {
        sidebar.classList.remove('open');
        mobileFlightsToggle.style.display = 'flex';
    });
}

window.focusOnFlight = function(icao24) {
    if(flightState[icao24] && flightState[icao24].visible) {
        if(window.innerWidth <= 768) {
            sidebar.classList.remove('open');
            if(mobileFlightsToggle) mobileFlightsToggle.style.display = 'flex';
        }
        map.flyTo([flightState[icao24].lat, flightState[icao24].lng], 9, { animate: true, duration: 1.5 });
        flightState[icao24].marker.openPopup();
    }
}

// --- FETCH / SIMULACION ---
async function fetchFlights() {
    try {
        const response = await fetch(OPENSKY_URL);
        const data = await response.json();

        if (data && data.states) {
            updateFlightSidebarAndMap(data.states);
        } else throw new Error("No states field");
    } catch (error) {
        console.warn("API Error", error);
        statusText.innerText = 'Rastreo Simulado (Error API)';
        statusContainer.classList.remove('error');
        statusContainer.style.background = 'rgba(234, 179, 8, 0.1)';
        statusContainer.style.borderColor = 'rgba(234, 179, 8, 0.2)';
        statusText.style.color = '#eab308';
        simulateFlightsData();
    }
}

// Vuelos simulados largos. Usando los prefijos válidos de Aerolíneas
let simulatedRawData = [
    // icao, callsign, origin, ..., lng, lat, altitude, on_ground, velocity, track
    ["a1b2c3", "LAP830", "Brazil", null, null, -50.0, -10.0, 11000, false, 250, 215], // LATAM desde Brasil hacia Asuncion
    ["d4e5f6", "AZP81", "Argentina", null, null, -60.0, -38.0, 9500, false, 220, 18], // Paranair subiendo desde BA a ASU
    ["g7h8i9", "CMP747", "Panama", null, null, -78.0, 5.0, 12000, false, 240, 145], // Copa inmensamente lejos en Panamá yendo a ASU
    ["xyz789", "AEA21", "Spain", null, null, -30.0, 0.0, 11500, false, 260, 225], // Air Europa cruzando atlántico ecuador
    ["j1k2l3", "ARG111", "Argentina", null, null, -57.0, -32.0, 8000, false, 210, 13] // Aerolineas yendo a ENO o ASU
];

function simulateFlightsData() {
    simulatedRawData = simulatedRawData.map(flight => {
        let lat = flight[6], lng = flight[5], track = flight[10], speed = flight[9]; 
        let dist = (speed * 15) / 111320; 
        lat += Math.cos(track * Math.PI / 180) * dist;
        lng += Math.sin(track * Math.PI / 180) * dist;
        return [flight[0], flight[1], flight[2], flight[3], flight[4], lng, lat, flight[7], flight[8], speed, track];
    });
    updateFlightSidebarAndMap(simulatedRawData);
}

fetchFlights();
setInterval(fetchFlights, 5000);

// --- WIDGET FINANCIERO ---
let exchangeRates = { USD: 7300, EUR: 8000, BRL: 1450, ARS: 7.20 }; // Fallback values
const currencyToggleBtn = document.getElementById('currencyToggleBtn');
const currencyPanel = document.getElementById('currencyPanel');
const closeCurrencyBtn = document.getElementById('closeCurrencyBtn');
const calcInputAmount = document.getElementById('calcInputAmount');
const calcCurrencySelect = document.getElementById('calcCurrencySelect');
const calcResultPYG = document.getElementById('calcResultPYG');

if (currencyToggleBtn) {
    currencyToggleBtn.addEventListener('click', () => {
        currencyPanel.classList.toggle('hidden');
    });
}
if (closeCurrencyBtn) {
    closeCurrencyBtn.addEventListener('click', () => {
        currencyPanel.classList.add('hidden');
    });
}

function updateCalculator() {
    let amount = parseFloat(calcInputAmount.value) || 0;
    let selectedCurrency = calcCurrencySelect.value;
    let rate = exchangeRates[selectedCurrency] || 1;
    let result = amount * rate;
    
    calcResultPYG.innerText = new Intl.NumberFormat('es-PY', { style: 'currency', currency: 'PYG' }).format(result);
}

calcInputAmount.addEventListener('input', updateCalculator);
calcCurrencySelect.addEventListener('change', updateCalculator);

async function fetchExchangeRates() {
    try {
        const res = await fetch("https://open.er-api.com/v6/latest/USD");
        const data = await res.json();
        
        const pygPerUsd = data.rates.PYG;
        
        exchangeRates.USD = pygPerUsd;
        exchangeRates.EUR = pygPerUsd / data.rates.EUR;
        exchangeRates.BRL = pygPerUsd / data.rates.BRL;
        exchangeRates.ARS = pygPerUsd / data.rates.ARS;

    } catch(err) {
        console.warn("Fallo al obtener tasas. Usando fallback.");
    }

    document.getElementById('rateUSD').innerText = "G$ " + Math.round(exchangeRates.USD).toLocaleString('es-PY');
    document.getElementById('rateEUR').innerText = "G$ " + Math.round(exchangeRates.EUR).toLocaleString('es-PY');
    document.getElementById('rateBRL').innerText = "G$ " + Math.round(exchangeRates.BRL).toLocaleString('es-PY');
    document.getElementById('rateARS').innerText = "G$ " + Math.round(exchangeRates.ARS).toLocaleString('es-PY');
    
    updateCalculator();
}
fetchExchangeRates();
setInterval(fetchExchangeRates, 3600000);

// --- CLIMA (RADAR METEOROLÓGICO) ---
const weatherToggleBtn = document.getElementById('weatherToggleBtn');
let weatherLayer = null;

async function initWeatherRadar() {
    try {
        const response = await fetch("https://api.rainviewer.com/public/weather-maps.json");
        const data = await response.json();
        if (data.radar && data.radar.past && data.radar.past.length > 0) {
            const latestObj = data.radar.past[data.radar.past.length - 1];
            // 2 = Color scheme (Titan), 1_1 = opacity/smooth
            weatherLayer = L.tileLayer(`${data.host}${latestObj.path}/256/{z}/{x}/{y}/2/1_1.png`, {
                opacity: 0.7,
                zIndex: 10
            });
        }
    } catch(err) {
        console.warn("Fallo al obtener radar de clima:", err);
    }
}

if (weatherToggleBtn) {
    weatherToggleBtn.addEventListener('click', async () => {
        if (!weatherLayer) {
            const icon = weatherToggleBtn.querySelector('i');
            icon.className = "ph ph-spinner ph-spin";
            await initWeatherRadar();
            icon.className = "ph ph-cloud-rain";
        }
        
        if (weatherLayer) {
            if (map.hasLayer(weatherLayer)) {
                map.removeLayer(weatherLayer);
                weatherToggleBtn.classList.remove('active');
            } else {
                map.addLayer(weatherLayer);
                weatherToggleBtn.classList.add('active');
            }
        }
    });
}

// --- UTILIDADES GLOBALES UI ---
const trajectoryToggleBtn = document.getElementById('trajectoryToggleBtn');
if (trajectoryToggleBtn) {
    trajectoryToggleBtn.addEventListener('click', () => {
        showTrajectories = !showTrajectories;
        trajectoryToggleBtn.classList.toggle('active', showTrajectories);
        
        Object.values(flightState).forEach(flight => {
            if (flight.line && flight.visible) {
                if (showTrajectories && !map.hasLayer(flight.line)) {
                    map.addLayer(flight.line);
                } else if (!showTrajectories && map.hasLayer(flight.line)) {
                    map.removeLayer(flight.line);
                }
            }
        });
    });
}

// --- EXPLORACIÓN GLOBAL ---
const globalToggleBtn = document.getElementById('globalToggleBtn');
if (globalToggleBtn) {
    globalToggleBtn.addEventListener('click', () => {
        exploreGlobal = !exploreGlobal;
        globalToggleBtn.classList.toggle('active', exploreGlobal);
        if (exploreGlobal) {
            const icon = globalToggleBtn.querySelector('i');
            icon.className = "ph ph-spinner ph-spin";
            fetchGlobalFlights().then(() => icon.className = "ph ph-globe-hemisphere-west");
        } else {
            globalMarkersGroup.clearLayers();
        }
    });
}

async function fetchGlobalFlights() {
    if (!exploreGlobal) return;
    try {
        const response = await fetch("https://opensky-network.org/api/states/all");
        if (!response.ok) throw new Error("HTTP " + response.status);
        
        const data = await response.json();
        if (data && data.states && exploreGlobal) {
            globalMarkersGroup.clearLayers();
            data.states.forEach(f => {
                const callsign = (f[1] || '').trim();
                const onGround = f[8];
                if (!onGround && !isAirlineMatching(callsign) && f[6] && f[5]) {
                    L.circleMarker([f[6], f[5]], { radius: 1.5, color: '#fbbf24', fillOpacity: 0.6, stroke: false })
                     .addTo(globalMarkersGroup);
                }
            });
        }
    } catch(e) { 
        console.warn("Global API Overloaded, falling back to procedural global network...", e);
        if (exploreGlobal) generateSimulatedGlobalTraffic();
    }
}

function generateSimulatedGlobalTraffic() {
    globalMarkersGroup.clearLayers();
    // Simulación estadística de red de vuelo global (Corredores Principales)
    const hubs = [
        { lat: 39.0, lng: -95.0, spread: 25, count: 1200 }, // USA
        { lat: 48.0, lng: 15.0, spread: 20, count: 900 },  // EU
        { lat: 35.0, lng: 110.0, spread: 20, count: 700 }, // Asia
        { lat: 25.0, lng: 55.0, spread: 15, count: 300 },  // ME
        { lat: -25.0, lng: 135.0, spread: 15, count: 150 }, // AUS
        { lat: 0.0, lng: 0.0, spread: 60, count: 700 } // Global Scatter
    ];

    hubs.forEach(hub => {
        for(let i = 0; i < hub.count; i++) {
            let lat = hub.lat + (Math.random() - 0.5) * hub.spread * 2;
            let lng = hub.lng + (Math.random() - 0.5) * hub.spread * 2;
            if(lat > 75 || lat < -65) continue; // Excluir Polos
            L.circleMarker([lat, lng], { radius: 1.5, color: '#fbbf24', fillOpacity: 0.5, stroke: false })
             .addTo(globalMarkersGroup);
        }
    });
}
setInterval(fetchGlobalFlights, 12000);

