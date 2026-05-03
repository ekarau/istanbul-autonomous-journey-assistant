document.addEventListener('DOMContentLoaded', async function () {

    // ============================================================
    //  PROBABILISTIC DELAY MODEL  —  Data & Simulation Layer
    //  COE017 Project | Data & Simulation Engineer Module
    // ============================================================

    const _df = (window.DELAY_FACTORS_DATA || {});

    // ============================================================
    //  BACKEND INTEGRATION LAYER
    // ============================================================
    const API_BASE = "https://istanbul-autonomous-journey-assistant.onrender.com";
    let BACKEND_INCIDENT_ZONES = null;

    async function fetchBackendJSON(path, options = {}) {
        const url = `${API_BASE}${path}`;
        const response = await fetch(url, {
            headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
            ...options
        });
        if (!response.ok) throw new Error(`Backend error ${response.status} on ${path}`);
        return await response.json();
    }

    async function loadBackendData() {
        try {
            const factors = await fetchBackendJSON('/api/delay-factors');
            if (factors && typeof factors === 'object') {
                if (factors.DELAY_FACTORS) DELAY_FACTORS = factors.DELAY_FACTORS;
                if (typeof factors.TRANSIT_INSULATION === 'number') TRANSIT_INSULATION = factors.TRANSIT_INSULATION;
                if (factors.CONFIDENCE_PARAMS) {
                    CONFIDENCE_BASE         = factors.CONFIDENCE_PARAMS.base ?? CONFIDENCE_BASE;
                    CONFIDENCE_PER_INCIDENT = factors.CONFIDENCE_PARAMS.perIncident ?? CONFIDENCE_PER_INCIDENT;
                    CONFIDENCE_LONG_ROUTE   = factors.CONFIDENCE_PARAMS.longRoute ?? CONFIDENCE_LONG_ROUTE;
                    CONFIDENCE_INTERCONT    = factors.CONFIDENCE_PARAMS.intercontinental ?? CONFIDENCE_INTERCONT;
                    CONFIDENCE_PEAK         = factors.CONFIDENCE_PARAMS.peak ?? CONFIDENCE_PEAK;
                    CONFIDENCE_MIN          = factors.CONFIDENCE_PARAMS.min ?? CONFIDENCE_MIN;
                }
            }
            console.log('[agent] Delay factors loaded from backend.');
        } catch (e) {
            console.warn('[agent] Backend delay factors unavailable; using local fallback.', e.message);
        }

        try {
            const incidents = await fetchBackendJSON('/api/incidents');
            BACKEND_INCIDENT_ZONES = Array.isArray(incidents) ? incidents : (incidents.incidents || incidents.zones || null);
            console.log('[agent] Incidents loaded from backend.');
        } catch (e) {
            console.warn('[agent] Backend incidents unavailable; using local fallback.', e.message);
        }
    }

    async function computeRouteRiskFromBackend(ctx) {
        try {
            const payload = {
                distance: ctx.distance,
                isIntercontinental: ctx.isIntercontinental,
                isWestSide: ctx.isWestSide,
                isTransit: ctx.isTransit,
                activeIncidents: ctx.activeIncidents
            };

            const result = await fetchBackendJSON('/api/analyze', {
                method: 'POST',
                body: JSON.stringify(payload)
            });

            if (result && typeof result.delay === 'number' && typeof result.confidence === 'number') {
                return {
                    delay: Math.round(result.delay),
                    confidence: Math.round(result.confidence),
                    activeFactors: result.activeFactors || result.active_factors || []
                };
            }
        } catch (e) {
            console.warn('[agent] Backend route analysis unavailable; using local model.', e.message);
        }
        return null;
    }

    let DELAY_FACTORS = _df.DELAY_FACTORS || {
        accident:         { base: 0.350, variance: 0.060 },
        rain:             { base: 0.180, variance: 0.055 },
        roadwork:         { base: 0.220, variance: 0.065 },
        breakdown:        { base: 0.140, variance: 0.045 },
        peakHour:         { base: 0.333, variance: 0.090 },
        intercontinental: { base: 0.418, variance: 0.095 },
        westSide:         { base: 0.343, variance: 0.085 },
        longRoute:        { base: 0.272, variance: 0.090 },
        normal:           { base: 0.022, variance: 0.015 }
    };

    let TRANSIT_INSULATION      = _df.TRANSIT_INSULATION || 0.55;
    const _cp                   = _df.CONFIDENCE_PARAMS || {};
    let CONFIDENCE_BASE         = _cp.base || 0.94;
    let CONFIDENCE_PER_INCIDENT = _cp.perIncident || 0.06;
    let CONFIDENCE_LONG_ROUTE   = _cp.longRoute || 0.08;
    let CONFIDENCE_INTERCONT    = _cp.intercontinental || 0.07;
    let CONFIDENCE_PEAK         = _cp.peak || 0.05;
    let CONFIDENCE_MIN          = _cp.min || 0.42;

    await loadBackendData();

    function getIncidentZones() {
        return (window.IncidentDetector && typeof window.IncidentDetector.getZones === 'function')
            ? window.IncidentDetector.getZones()
            : (BACKEND_INCIDENT_ZONES || _df.INCIDENT_ZONE_DEFAULTS || []);
    }

    function gaussianRandom() {
        let u = 0, v = 0;
        while (u === 0) u = Math.random();
        while (v === 0) v = Math.random();
        return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
    }

    function sampleFactor(key) {
        const f = DELAY_FACTORS[key];
        if (!f) return 0;

        const sampled = f.base + f.variance * gaussianRandom();
        return Math.max(0, Math.min(1, sampled));
    }

    function combinedDelayProbability(activeFactorKeys) {
        let complement = 1.0;
        activeFactorKeys.forEach(key => {
            complement *= (1 - sampleFactor(key));
        });
        return Math.max(0, Math.min(1, 1 - complement));
    }

    function getActiveIncidentsOnRoute(startLat, startLon, endLat, endLon) {
        const midLat = (startLat + endLat) / 2;
        const midLon = (startLon + endLon) / 2;
        const active = [];

        getIncidentZones().forEach(zone => {
            const dToStart = calculateDistance(startLat, startLon, zone.lat, zone.lon);
            const dToEnd   = calculateDistance(endLat, endLon, zone.lat, zone.lon);
            const dToMid   = calculateDistance(midLat, midLon, zone.lat, zone.lon);

            if (Math.min(dToStart, dToEnd, dToMid) <= zone.radius) {
                active.push(zone);
            }
        });

        return active;
    }

    function isPeakHour() {
        const now = new Date();
        const total = now.getHours() * 60 + now.getMinutes();
        return (total >= 450 && total <= 570) || (total >= 1020 && total <= 1200);
    }

    function computeRouteRisk(ctx) {
        const activeFactorKeys = [];

        if (ctx.activeIncidents.length === 0 && !ctx.isIntercontinental && !ctx.isWestSide) {
            activeFactorKeys.push('normal');
        }

        if (ctx.isIntercontinental) activeFactorKeys.push('intercontinental');
        if (ctx.isWestSide) activeFactorKeys.push('westSide');
        if (ctx.distance > 15) activeFactorKeys.push('longRoute');
        if (isPeakHour()) activeFactorKeys.push('peakHour');

        ctx.activeIncidents.forEach(inc => {
            if (!activeFactorKeys.includes(inc.factorKey)) {
                activeFactorKeys.push(inc.factorKey);
            }
        });

        let delayProb = combinedDelayProbability(activeFactorKeys);

        if (ctx.isTransit) {
            const roadKeys = ['accident', 'breakdown', 'roadwork', 'westSide'];
            const roadContrib = combinedDelayProbability(activeFactorKeys.filter(k => roadKeys.includes(k)));
            delayProb -= roadContrib * TRANSIT_INSULATION;
            delayProb = Math.max(0, delayProb);
        }

        let conf = CONFIDENCE_BASE;
        conf -= ctx.activeIncidents.length * CONFIDENCE_PER_INCIDENT;
        if (ctx.distance > 15) conf -= CONFIDENCE_LONG_ROUTE;
        if (ctx.isIntercontinental) conf -= CONFIDENCE_INTERCONT;
        if (isPeakHour()) conf -= CONFIDENCE_PEAK;
        conf += 0.02 * gaussianRandom();
        conf = Math.max(CONFIDENCE_MIN, Math.min(0.99, conf));

        return {
            delay: Math.round(delayProb * 100),
            confidence: Math.round(conf * 100),
            activeFactors: activeFactorKeys
        };
    }

    function buildInferenceMessage(ctx, risk) {
        const { distance, isIntercontinental, isWestSide, activeIncidents } = ctx;
        const peak = isPeakHour();
        const now = new Date();
        const timeStr = `${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')}`;

        let prefix = risk.delay >= 60 ? 'HIGH RISK DETECTED: '
                   : risk.delay >= 30 ? 'MODERATE RISK: '
                   : 'LOW RISK: ';

        let parts = [prefix];

        if (isIntercontinental && activeIncidents.find(i => i.type === 'accident')) {
            parts.push(`Bridge accident + intercontinental crossing → Ferry or Marmaray strongly advised.`);
        } else if (isIntercontinental) {
            parts.push(`Intercontinental route via Bosphorus detected.`);
        }

        if (isWestSide) parts.push(`Heavy E-5 / TEM congestion zone. Metrobus preferred.`);
        if (peak) parts.push(`Peak-hour window active (${timeStr}).`);

        activeIncidents.forEach(inc => {
            const impact = Math.round(sampleFactor(inc.factorKey) * 100);
            parts.push(`${inc.title} on route (+${impact}% local delay).`);
        });

        parts.push(`Route: ${distance.toFixed(1)} km | Delay probability: ${risk.delay}% | Confidence: ${risk.confidence}%`);
        return parts.join(' ').trim();
    }

    const map = L.map('map', { center: [41.0082, 28.9784], zoom: 12, zoomControl: false });

    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors &copy; CARTO'
    }).addTo(map);

    setTimeout(() => {
        map.invalidateSize();
    }, 500);

    window.map = map;
    window.userMarker = null;
    window.targetMarker = null;
    window.originMarker = null;
    window.routePath = null;
    window.altRoutePath = null;
    window.selectedLat = null;
    window.selectedLon = null;
    window.originLat = null;
    window.originLon = null;

    window.typeWriter = async function (text, elementId) {
        const el = document.getElementById(elementId);
        if (!el) return;

        el.innerHTML = "";

        for (let i = 0; i < text.length; i++) {
            el.innerHTML += text.charAt(i);
            await new Promise(r => setTimeout(r, 3));
        }
    };

    function calculateDistance(lat1, lon1, lat2, lon2) {
        const R = 6371;
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLon = (lon2 - lon1) * Math.PI / 180;

        const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(lat1 * Math.PI / 180) *
            Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) ** 2;

        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }

    const BOSPHORUS_KNOTS = [
        [40.965, 29.020],
        [41.000, 28.985],
        [41.025, 28.995],
        [41.045, 29.015],
        [41.080, 29.050],
        [41.115, 29.062],
        [41.180, 29.085],
        [41.230, 29.110]
    ];

    function bosphorusMidLng(lat) {
        if (lat <= BOSPHORUS_KNOTS[0][0]) return BOSPHORUS_KNOTS[0][1];

        const last = BOSPHORUS_KNOTS[BOSPHORUS_KNOTS.length - 1];
        if (lat >= last[0]) return last[1];

        for (let i = 0; i < BOSPHORUS_KNOTS.length - 1; i++) {
            const a = BOSPHORUS_KNOTS[i];
            const b = BOSPHORUS_KNOTS[i + 1];

            if (lat >= a[0] && lat <= b[0]) {
                const t = (lat - a[0]) / (b[0] - a[0]);
                return a[1] + t * (b[1] - a[1]);
            }
        }

        return last[1];
    }

    function isEuropeanSide(lat, lng) {
        return lng < bosphorusMidLng(lat);
    }

    function isIntercontinentalTrip(aLat, aLng, bLat, bLng) {
        return isEuropeanSide(aLat, aLng) !== isEuropeanSide(bLat, bLng);
    }

    const accidentIcon = L.divIcon({
        className: 'custom-div-icon',
        html: "<div style='color:#FF4D4D;font-size:24px;text-shadow:0 0 10px rgba(255,77,77,0.5)'><i class='fa-solid fa-triangle-exclamation'></i></div>",
        iconSize: [30, 30],
        iconAnchor: [15, 15]
    });

    L.marker([41.0456, 29.0344], { icon: accidentIcon })
        .addTo(map)
        .bindPopup("Accident: Bridge traffic stalled.");

    window.locateUser = function () {
        if (!navigator.geolocation) return;

        navigator.geolocation.getCurrentPosition(pos => {
            const { latitude, longitude } = pos.coords;

            if (window.userMarker) map.removeLayer(window.userMarker);

            window.userMarker = L.circleMarker([latitude, longitude], {
                radius: 10,
                fillColor: "#64FFDA",
                color: "#fff",
                weight: 2,
                opacity: 1,
                fillOpacity: 0.8
            }).addTo(map).bindPopup("Your Location").openPopup();

            map.flyTo([latitude, longitude], 15);
        });
    };

    const locateBtn = document.getElementById('locate-btn');
    if (locateBtn) {
        locateBtn.addEventListener('click', window.locateUser);
    }

    const destinationInput = document.getElementById('destination-input');
    const suggestionsList = document.getElementById('suggestions');
    const originInput = document.getElementById('origin-input');
    const originSuggestions = document.getElementById('origin-suggestions');

    function wireAutocomplete(inputEl, listEl, onPick) {
        if (!inputEl || !listEl) return;

        let timer;

        inputEl.addEventListener('input', () => {
            clearTimeout(timer);

            const query = inputEl.value;

            if (query.length < 3) {
                listEl.style.display = 'none';
                return;
            }

            timer = setTimeout(async () => {
                try {
                    const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${query}+Istanbul&limit=5`);
                    const data = await res.json();

                    if (data.length > 0) {
                        listEl.innerHTML = '';

                        data.forEach(item => {
                            const div = document.createElement('div');
                            div.className = 'suggestion-item';
                            div.innerText = item.display_name.split(',')[0];

                            div.addEventListener('click', () => {
                                inputEl.value = div.innerText;
                                listEl.style.display = 'none';
                                onPick(parseFloat(item.lat), parseFloat(item.lon), div.innerText);
                            });

                            listEl.appendChild(div);
                        });

                        listEl.style.display = 'block';
                    } else {
                        listEl.style.display = 'none';
                    }

                } catch (e) {
                    console.error(e);
                }
            }, 500);
        });

        inputEl.addEventListener('blur', () => {
            setTimeout(() => {
                listEl.style.display = 'none';
            }, 200);
        });
    }

    wireAutocomplete(destinationInput, suggestionsList, prepareDestination);
    wireAutocomplete(originInput, originSuggestions, prepareOrigin);

    function prepareDestination(lat, lon, name) {
        window.selectedLat = lat;
        window.selectedLon = lon;

        if (window.targetMarker) map.removeLayer(window.targetMarker);

        window.targetMarker = L.marker([lat, lon])
            .addTo(map)
            .bindPopup(`Target: ${name}`)
            .openPopup();

        if (destinationInput) destinationInput.value = name;

        map.flyTo([lat, lon], 14);

        if (typeof window.syncClearVisibility === 'function') {
            window.syncClearVisibility();
        }
    }

    function prepareOrigin(lat, lon, name) {
        window.originLat = lat;
        window.originLon = lon;

        if (window.originMarker) map.removeLayer(window.originMarker);

        const originIcon = L.divIcon({
            className: 'origin-pick-marker',
            html: '<div style="background:#2ECC71;width:14px;height:14px;border-radius:50%;border:3px solid white;box-shadow:0 0 12px rgba(46,204,113,0.7);"></div>',
            iconSize: [20, 20],
            iconAnchor: [10, 10]
        });

        window.originMarker = L.marker([lat, lon], { icon: originIcon })
            .addTo(map)
            .bindPopup(`Origin: ${name}`)
            .openPopup();

        if (originInput) originInput.value = name;

        if (typeof window.syncClearVisibility === 'function') {
            window.syncClearVisibility();
        }
    }

    async function reverseGeocode(lat, lon) {
        try {
            const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=16`);
            const data = await res.json();

            if (data && data.display_name) {
                return data.display_name.split(',').slice(0, 2).join(',').trim();
            }
        } catch (_) {}

        return `${lat.toFixed(3)}, ${lon.toFixed(3)}`;
    }

    map.on('click', function (e) {
        const lat = e.latlng.lat;
        const lon = e.latlng.lng;

        const html = `
            <div style="display:flex;flex-direction:column;gap:6px;font-family:Inter,sans-serif;min-width:170px;">
                <div style="font-size:0.7rem;color:#8892B0;letter-spacing:0.5px;text-transform:uppercase;">
                    ${lat.toFixed(4)}, ${lon.toFixed(4)}
                </div>
                <button class="map-pick-btn" data-pick="origin"
                        style="background:#2ECC71;border:0;color:#0A192F;padding:7px 10px;border-radius:6px;font-weight:700;cursor:pointer;font-size:0.78rem;text-align:left;">
                    <i class="fa-solid fa-circle-dot"></i> &nbsp;Set as Origin
                </button>
                <button class="map-pick-btn" data-pick="destination"
                        style="background:#FF4D4D;border:0;color:white;padding:7px 10px;border-radius:6px;font-weight:700;cursor:pointer;font-size:0.78rem;text-align:left;">
                    <i class="fa-solid fa-location-dot"></i> &nbsp;Set as Destination
                </button>
            </div>`;

        const popup = L.popup({ closeButton: true, autoPan: true })
            .setLatLng(e.latlng)
            .setContent(html)
            .openOn(map);

        setTimeout(() => {
            const node = popup.getElement();
            if (!node) return;

            node.querySelectorAll('.map-pick-btn').forEach(btn => {
                btn.addEventListener('click', async () => {
                    const pick = btn.dataset.pick;
                    map.closePopup();

                    const name = await reverseGeocode(lat, lon);

                    if (pick === 'origin') {
                        prepareOrigin(lat, lon, name);
                    } else {
                        prepareDestination(lat, lon, name);
                    }
                });
            });
        }, 30);
    });

    const searchBtn = document.getElementById('search-btn');

    if (searchBtn) {
        searchBtn.addEventListener('click', async function () {
            if (!window.selectedLat || !window.selectedLon) {
                const val = destinationInput ? destinationInput.value.trim() : '';

                if (!val) {
                    alert("Please select or enter a destination first.");
                    return;
                }

                const found = await geocodeQuery(val);

                if (!found) {
                    alert("Destination not found. Try a more specific address.");
                    return;
                }

                prepareDestination(found.lat, found.lon, found.name);
            }

            if (window.originLat == null && originInput && originInput.value.trim()) {
                const found = await geocodeQuery(originInput.value.trim());

                if (found) {
                    prepareOrigin(found.lat, found.lon, found.name);
                }
            }

            simulateAIDecision(window.selectedLat, window.selectedLon);
        });
    }

    async function geocodeQuery(query) {
        try {
            const q = encodeURIComponent(query + ' Istanbul');
            const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${q}&limit=1`);
            const data = await res.json();

            if (data.length > 0) {
                return {
                    lat: parseFloat(data[0].lat),
                    lon: parseFloat(data[0].lon),
                    name: data[0].display_name.split(',')[0]
                };
            }
        } catch (e) {
            console.error('[geocodeQuery]', e);
        }

        return null;
    }

    async function searchManually(query) {
        const found = await geocodeQuery(query);

        if (found) {
            prepareDestination(found.lat, found.lon, found.name);
            simulateAIDecision(window.selectedLat, window.selectedLon);
        } else {
            alert("Location not found.");
        }
    }

    window.searchManually = searchManually;

    function resolveStart() {
        if (window.originLat != null && window.originLon != null) {
            return { lat: window.originLat, lng: window.originLon };
        }

        if (window.userMarker) {
            return window.userMarker.getLatLng();
        }

        const originEl = document.getElementById('origin-input');

        if (originEl) {
            originEl.focus();
            originEl.style.outline = '2px solid #FF4D4D';

            setTimeout(() => {
                originEl.style.outline = '';
            }, 2500);
        }

        const statusEl = document.querySelector('.status-text');

        if (statusEl) {
            statusEl.innerHTML =
                '<span style="color:#FF4D4D;font-weight:700;">⚠ Please set a starting location.</span>' +
                ' Type an address in the origin field, click the map and choose "Set as Origin", ' +
                'or press the <i class="fa-solid fa-location-crosshairs"></i> GPS button.';
        }

        return null;
    }

    async function simulateAIDecision(tLat, tLon) {
        const start = resolveStart();
        if (!start) return;

        document.getElementById("ai-status").innerHTML = "Analyzing route with backend AI...";

        await new Promise(resolve => setTimeout(resolve, 100));

        try {
            const res = await fetch(`${API_BASE}/api/analyze`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    route: `${originInput.value || "Origin"} → ${destinationInput.value || "Destination"}`,
                    startLat: start.lat,
                    startLon: start.lng,
                    targetLat: tLat,
                    targetLon: tLon
                })
            });

            const data = await res.json();

            console.log("BACKEND RESULT:", data);

            if (data && (data.aiInference || data.delayPercent || data.confidence || data.expectedDelay)) {
                document.getElementById("ai-status").innerHTML = `
                    <b>Backend AI Sonucu:</b><br>
                    ${data.aiInference || "Backend route analysis completed."}<br><br>
                    <b>Gecikme Riski:</b> %${data.delayPercent ?? "-"}<br>
                    <b>Güven:</b> %${data.confidence ?? "-"}<br>
                    <b>Tahmini Gecikme:</b> ${data.expectedDelay ?? "-"} dk
                `;

                if (typeof data.delayPercent === "number" && typeof data.confidence === "number") {
                    updateStats(data.delayPercent, data.confidence);
                    updateTrafficBadge(data.delayPercent);
                }
            }

        } catch (e) {
            console.log("Backend çalışmadı, fallback çalışıyor", e);
        }

        const distance = calculateDistance(start.lat, start.lng, tLat, tLon);
        const isIntercontinental = isIntercontinentalTrip(start.lat, start.lng, tLat, tLon);
        const isWestSide = start.lng < 28.8 && tLon < 28.9;
        const activeIncidents = getActiveIncidentsOnRoute(start.lat, start.lng, tLat, tLon);

        const routeCtx = {
            distance,
            isIntercontinental,
            isWestSide,
            activeIncidents,
            isTransit: false
        };

        const backendRisk = await computeRouteRiskFromBackend(routeCtx);
        const risk = backendRisk || computeRouteRisk(routeCtx);

        const activeKeys = [];

        if (activeIncidents.length === 0 && !isIntercontinental && !isWestSide) activeKeys.push('normal');
        if (isIntercontinental) activeKeys.push('intercontinental');
        if (isWestSide) activeKeys.push('westSide');
        if (distance > 15) activeKeys.push('longRoute');
        if (isPeakHour()) activeKeys.push('peakHour');

        activeIncidents.forEach(inc => {
            if (!activeKeys.includes(inc.factorKey)) activeKeys.push(inc.factorKey);
        });

        const _hour = new Date().getHours();
        const _spd = (_hour >= 7 && _hour < 10) ? 49 : (_hour >= 17 && _hour < 20) ? 47 : 65;
        const baseCarTime = Math.round((distance / _spd) * 60 + 5);

        if (window.MathModel) {
            const routeVectors = [
                MathModel.buildFeatureVector(activeKeys),
                MathModel.buildFeatureVector(activeKeys.filter(k => k !== 'westSide')),
                MathModel.buildFeatureVector(activeKeys.filter(k => !['accident', 'breakdown', 'roadwork', 'westSide'].includes(k))),
                MathModel.buildFeatureVector(activeKeys.filter(k => !['accident', 'breakdown', 'roadwork', 'westSide', 'intercontinental'].includes(k)))
            ];

            window.lastMathResult = MathModel.computeFullModel({
                activeFactorKeys: activeKeys,
                baseTimeMin: baseCarTime,
                routeVectors
            });
        }

        await window.typeWriter(
            `AI analyzing ${distance.toFixed(1)} km route… scanning ${activeIncidents.length} incident zone(s)…`,
            'ai-status'
        );

        updateStats(risk.delay, risk.confidence);
        updateTrafficBadge(risk.delay);

        setTimeout(async () => {
            const msg = buildInferenceMessage(routeCtx, risk);
            await window.typeWriter(msg, 'ai-status');

            setTimeout(() => {
                drawDualRoutes([start.lat, start.lng], [tLat, tLon]);
                showContextRoutes(isIntercontinental, isWestSide, distance, activeIncidents);
            }, 1000);
        }, 2000);
    }

    function drawDualRoutes(start, end) {
        if (window.routePath) map.removeLayer(window.routePath);
        if (window.altRoutePath) map.removeLayer(window.altRoutePath);

        const mid1 = [
            (start[0] + end[0]) / 2 + 0.005,
            (start[1] + end[1]) / 2 + 0.005
        ];

        window.routePath = L.polyline([start, mid1, end], {
            color: '#64FFDA',
            weight: 6,
            opacity: 0.9,
            dashArray: '20, 1000',
            dashOffset: '1000'
        }).addTo(map);

        const mid2 = [
            (start[0] + end[0]) / 2 - 0.01,
            (start[1] + end[1]) / 2 - 0.01
        ];

        window.altRoutePath = L.polyline([start, mid2, end], {
            color: '#FF4D4D',
            weight: 4,
            opacity: 0.4,
            dashArray: '5, 10'
        }).addTo(map);

        let offset = 1000;

        const anim = setInterval(() => {
            offset -= 30;
            window.routePath.setStyle({ dashOffset: offset.toString() });

            if (offset <= 0) {
                clearInterval(anim);
                window.routePath.setStyle({ dashArray: '0' });
            }
        }, 20);

        map.fitBounds(window.routePath.getBounds(), { padding: [80, 80] });
    }

    let currentMode = 'best';

    document.querySelectorAll('.pill-mode').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.pill-mode').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentMode = btn.dataset.mode;

            if (window.selectedLat) {
                const start = resolveStart();
                if (!start) return;

                const dist = calculateDistance(start.lat, start.lng, window.selectedLat, window.selectedLon);
                const isI = isIntercontinentalTrip(start.lat, start.lng, window.selectedLat, window.selectedLon);
                const isW = start.lng < 28.8 && window.selectedLon < 28.9;
                const incs = getActiveIncidentsOnRoute(start.lat, start.lng, window.selectedLat, window.selectedLon);

                showContextRoutes(isI, isW, dist, incs);
            }
        });
    });

    function showContextRoutes(isInter, isWest, distance, activeIncidents = []) {
        const list = document.getElementById('routes-list');

        if (!list) return;

        const _h = new Date().getHours();
        const _cSpd = (_h >= 7 && _h < 10) ? 49 : (_h >= 17 && _h < 20) ? 47 : 65;
        const _tSpd = (_h >= 7 && _h < 10) ? 38 : (_h >= 17 && _h < 20) ? 36 : 52;

        const carTime = Math.round((distance / _cSpd) * 60 + 5);
        const transitTime = Math.round((distance / _tSpd) * 60 + 8);

        const carRisk = computeRouteRisk({
            distance,
            isIntercontinental: isInter,
            isWestSide: isWest,
            activeIncidents,
            isTransit: false
        });

        const transitRisk = computeRouteRisk({
            distance,
            isIntercontinental: isInter,
            isWestSide: isWest,
            activeIncidents,
            isTransit: true
        });

        const carDelayMin = Math.round(carTime * (carRisk.delay / 100));
        const transitDelayMin = Math.round(transitTime * (transitRisk.delay / 100));

        const allRoutes = [
            {
                mode: 'car',
                name: "via E80 Road",
                desc: `High-speed connection. Expected delay: +${carDelayMin} min. Congestion at bridge exits.`,
                total: carTime + carDelayMin,
                dist: (distance * 1.05).toFixed(1),
                icon: "fa-car",
                pathOffset: 0.006,
                color: '#4D94FF',
                delay: carRisk.delay,
                conf: carRisk.confidence
            },
            {
                mode: 'car',
                name: "via D100 Road",
                desc: `Alternative inner-city route. Expected delay: +${Math.round(carDelayMin * 0.8)} min.`,
                total: carTime + 10 + Math.round(carDelayMin * 0.8),
                dist: (distance * 0.98).toFixed(1),
                icon: "fa-car",
                pathOffset: -0.005,
                color: '#FFD700',
                delay: Math.round(carRisk.delay * 0.85),
                conf: Math.round(carRisk.confidence * 0.97)
            },
            {
                mode: 'transit',
                name: "via Subway & Metrobus",
                desc: `Optimal public transit. Road incidents: ${Math.round(transitRisk.delay * TRANSIT_INSULATION)}% absorbed by dedicated lanes.`,
                total: transitTime + transitDelayMin,
                dist: (distance * 0.95).toFixed(1),
                icon: "fa-train-subway",
                pathOffset: 0.002,
                color: '#64FFDA',
                delay: transitRisk.delay,
                conf: transitRisk.confidence
            },
            {
                mode: 'transit',
                name: "via Marmaray Line",
                desc: `Undersea rail — fully insulated from surface incidents.`,
                total: transitTime + 5,
                dist: (distance * 1.1).toFixed(1),
                icon: "fa-train-subway",
                pathOffset: -0.007,
                color: '#2ECC71',
                delay: Math.max(5, transitRisk.delay - 10),
                conf: Math.min(99, transitRisk.confidence + 4)
            }
        ];

        let geoFiltered = isInter ? allRoutes : allRoutes.filter(r => r.name !== 'via Marmaray Line');
        let filtered = currentMode === 'best' ? geoFiltered : geoFiltered.filter(r => r.mode === currentMode);

        if (filtered.length === 0) {
            list.innerHTML = `<div class="status-msg">No suitable routes for this mode.</div>`;
            return;
        }

        list.innerHTML = filtered.map(r => `
            <div class="route-item card" onclick="updateMapPath(${r.pathOffset}, '${r.color}'); updateStats(${r.delay}, ${r.conf})">
                <div class="route-main-row">
                    <div class="route-icon-box" style="background:${r.color}22;color:${r.color}">
                        <i class="fa-solid ${r.icon}"></i>
                    </div>
                    <div class="route-details">
                        <div class="route-title">${r.name}</div>
                        <div class="route-desc">${r.desc}</div>
                    </div>
                    <div class="route-time-col">
                        <div class="route-time-big" style="color:${r.color}">${r.total} min</div>
                        <div class="route-dist-small">${r.dist} km</div>
                    </div>
                </div>
            </div>
        `).join('');

        const best = filtered[0];

        updateMapPath(best.pathOffset, best.color);
        updateStats(best.delay, best.conf);

        const statusText = document.querySelector('.status-text');
        if (statusText) {
            statusText.innerHTML = `AI INFERENCE: Optimal path found — delay risk ${best.delay}%, confidence ${best.conf}%.`;
        }

        appendMathPanel();

        const baseKeys = [];

        if (isInter) baseKeys.push('intercontinental');
        if (isWest) baseKeys.push('westSide');
        if (distance > 15) baseKeys.push('longRoute');
        if (activeIncidents.some(i => i.type === 'accident')) baseKeys.push('accident');
        if (activeIncidents.some(i => i.type === 'roadwork')) baseKeys.push('roadwork');
        if (activeIncidents.some(i => i.type === 'breakdown')) baseKeys.push('breakdown');

        const _hr = new Date().getHours();

        if ((_hr >= 7 && _hr < 10) || (_hr >= 17 && _hr < 20)) {
            baseKeys.push('peakHour');
        }

        if (baseKeys.length === 0) baseKeys.push('normal');

        window.SUGGESTED_ROUTES = filtered.map(r => {
            let keys = baseKeys.slice();

            if (r.mode === 'transit') {
                keys = keys.filter(k => k !== 'accident' && k !== 'roadwork');

                if (r.name.toLowerCase().includes('marmaray')) {
                    keys = keys.filter(k => k !== 'intercontinental' && k !== 'breakdown');
                }
            }

            if (keys.length === 0) keys = ['normal'];

            return {
                name: r.name,
                activeKeys: keys,
                baseTimeMin: r.total,
                distanceKm: parseFloat(r.dist),
                transferCount: r.mode === 'transit'
                    ? (r.name.toLowerCase().includes('marmaray') ? 1 : 2)
                    : 0
            };
        });

        if (window.Optimizer && typeof window.Optimizer.appendOptimizerPanel === 'function') {
            try {
                window.Optimizer.appendOptimizerPanel();
            } catch (e) {
                console.warn('[agent] Optimizer panel failed:', e);
            }
        }

        if (window.SimulatedAnnealing && typeof window.SimulatedAnnealing.appendSAPanel === 'function') {
            try {
                window.SimulatedAnnealing.appendSAPanel();
            } catch (e) {
                console.warn('[agent] SA panel failed:', e);
            }
        }

        if (window.GeneticAlgorithm && typeof window.GeneticAlgorithm.appendGAPanel === 'function') {
            try {
                window.GeneticAlgorithm.appendGAPanel();
            } catch (e) {
                console.warn('[agent] GA panel failed:', e);
            }
        }
    }

    function appendMathPanel() {
        if (!window.lastMathResult) return;

        const list = document.getElementById('routes-list');
        if (!list) return;

        const m = window.lastMathResult;

        const severityColor = ['', '#2ECC71', '#FFA500', '#FF4D4D'];
        const severityLabel = ['', 'INFO', 'WARNING', 'CRITICAL'];

        const conclusionHTML = m.logicResult.conclusions.length === 0 ? '' : (() => {
            const baseFacts = new Set(
                (m.logicResult.facts || []).slice(0, Object.keys(m.featureVector || {}).length)
            );

            const isChained = c => !baseFacts.has(c.conclusion) &&
                !(window.DELAY_FACTORS && window.DELAY_FACTORS[c.conclusion]);

            return m.logicResult.conclusions.map(c => {
                const chained = isChained(c);
                const sColor = severityColor[c.severity] || '#64748b';
                const sLabel = severityLabel[c.severity] || 'INFO';

                const chainBadge = chained
                    ? `<span style="font-size:0.62rem;background:rgba(99,102,241,.18);color:#818CF8;padding:1px 5px;border-radius:4px;margin-left:4px;">⛓ chained</span>`
                    : '';

                return `
                    <div style="margin-top:6px;padding:6px 10px;border-radius:8px;border-left:3px solid ${sColor};background:rgba(255,255,255,0.03);font-size:0.72rem;color:var(--text-secondary);line-height:1.4;">
                        <span style="color:${sColor};font-weight:700;font-size:0.7rem;">
                            [${sLabel}]
                        </span>
                        ${chainBadge}
                        ${c.explanation}
                    </div>`;
            }).join('');
        })();

        const panel = document.createElement('div');
        panel.className = 'card';
        panel.style.marginTop = '12px';

        panel.innerHTML = `
            <div class="ai-header" style="margin-bottom:10px;">
                <i class="fa-solid fa-square-root-variable" style="color:var(--accent-color)"></i>
                <span style="font-size:0.8rem;">Mathematical Analysis</span>
            </div>

            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px;">
                <div style="text-align:center;padding:8px;background:rgba(255,255,255,0.03);border-radius:8px;">
                    <div style="font-size:0.65rem;color:var(--text-secondary);margin-bottom:4px;">‖x‖₂ Risk Norm</div>
                    <div style="font-size:1rem;font-weight:700;color:var(--accent-color);">${m.l2Risk}</div>
                </div>

                <div style="text-align:center;padding:8px;background:rgba(255,255,255,0.03);border-radius:8px;">
                    <div style="font-size:0.65rem;color:var(--text-secondary);margin-bottom:4px;">Linear Score (w·x)</div>
                    <div style="font-size:1rem;font-weight:700;color:var(--accent-color);">${(m.linearScore * 100).toFixed(1)}%</div>
                </div>
            </div>

            <div style="font-size:0.72rem;color:var(--text-secondary);line-height:1.9;margin-bottom:8px;">
                <span style="color:var(--text-primary);font-weight:600;">E[D]</span> = <span style="color:var(--accent-color);">${m.delayStats.E} min</span>
                &nbsp;|&nbsp;
                <span style="color:var(--text-primary);font-weight:600;">σ[D]</span> = <span style="color:var(--accent-color);">${m.delayStats.sigma} min</span>
                <br>
                <span style="color:var(--text-primary);font-weight:600;">95% CI</span>: [${m.delayStats.ciLow}, ${m.delayStats.ciHigh}] min
                &nbsp;|&nbsp;
                <span style="color:var(--text-primary);font-weight:600;">P(delay)</span>: ${(m.probabilityResult.prob * 100).toFixed(1)}%
            </div>

            <div style="font-size:0.7rem;color:var(--text-secondary);font-weight:600;margin-bottom:4px;text-transform:uppercase;letter-spacing:0.5px;">
                Logic Engine
                <span style="font-size:0.62rem;font-weight:400;text-transform:none;margin-left:6px;color:${m.logicResult.engine === 'fixpoint' ? '#818CF8' : '#64748b'};">
                    ${m.logicResult.engine === 'fixpoint'
                        ? '⛓ Fixpoint Forward Chaining (' + (m.logicResult.facts || []).length + ' facts)'
                        : 'Single-pass Modus Ponens'}
                </span>
            </div>

            ${conclusionHTML || '<div style="font-size:0.72rem;color:var(--text-secondary);padding:4px 0;">No rules fired — low risk state.</div>'}

            <div style="margin-top:10px;font-size:0.65rem;color:rgba(255,255,255,0.2);text-align:right;">
                Blended: α=0.70 × P_union + 0.30 × w·x
            </div>
        `;

        list.appendChild(panel);
    }

    window.updateMapPath = function (offset, color) {
        if (!window.routePath || !window.targetMarker) return;

        const start = window.originMarker
            ? window.originMarker.getLatLng()
            : (window.userMarker ? window.userMarker.getLatLng() : resolveStart());

        if (!start) return;

        const end = window.targetMarker.getLatLng();
        const midLat = (start.lat + end.lat) / 2 + offset;
        const midLng = (start.lng + end.lng) / 2 + offset;

        window.routePath.setLatLngs([
            [start.lat, start.lng],
            [midLat, midLng],
            [end.lat, end.lng]
        ]);

        window.routePath.setStyle({
            color,
            weight: 5,
            opacity: 0.8,
            dashArray: offset === 0 ? null : '5, 10'
        });
    };

    window.updateStats = updateStats;

    function updateStats(delay, confidence) {
        const delayBar = document.getElementById('delay-bar');
        const delayVal = document.getElementById('delay-val');
        const confidenceVal = document.getElementById('confidence-val');
        const sc = document.getElementById('confidence-stars');

        if (delayBar) delayBar.style.width = delay + "%";
        if (delayVal) delayVal.innerText = delay + "%";
        if (confidenceVal) confidenceVal.innerText = confidence + "%";

        if (!sc) return;

        let html = "";
        const filled = Math.floor(confidence / 20);

        for (let i = 1; i <= 5; i++) {
            html += i <= filled
                ? '<i class="fa-solid fa-star" style="color:#FFD700"></i>'
                : '<i class="fa-regular fa-star"></i>';
        }

        if (confidence > 90) {
            html += ' <span class="verified">VERIFIED</span>';
        }

        sc.innerHTML = html;
    }

    function updateTrafficBadge(delayPct) {
        const badge = document.getElementById('traffic-status-badge');
        if (!badge) return;

        let label;
        let pulse;
        let color;

        if (delayPct >= 60) {
            label = 'Live Traffic: Heavy';
            pulse = '<span class="pulse-red"></span>';
            color = '#FF4D4D';
        } else if (delayPct >= 30) {
            label = 'Live Traffic: Moderate';
            pulse = '<span class="pulse-orange" style="background:#FFA500;"></span>';
            color = '#FFA500';
        } else {
            label = 'Live Traffic: Clear';
            pulse = '<span class="pulse-green" style="background:#2ECC71;"></span>';
            color = '#2ECC71';
        }

        badge.innerHTML = `${pulse} ${label}`;
        badge.style.color = color;
    }

    (function seedTrafficBadge() {
        const now = new Date();
        const mins = now.getHours() * 60 + now.getMinutes();
        const peak = (mins >= 450 && mins <= 570) || (mins >= 1020 && mins <= 1200);
        const seedKeys = peak ? ['peakHour'] : ['normal'];
        const seed = combinedDelayProbability(seedKeys);

        updateTrafficBadge(Math.round(seed * 100));
    })();

    function initMapIncidents() {
        const iconMap = {
            accident: 'fa-car-burst',
            work: 'fa-road-circle-exclamation',
            roadwork: 'fa-road-circle-exclamation',
            breakdown: 'fa-bus',
            weather: 'fa-cloud-showers-heavy',
            rain: 'fa-cloud-showers-heavy'
        };

        getIncidentZones().forEach(inc => {
            const impact = Math.round(sampleFactor(inc.factorKey) * 100);
            const iconClass = iconMap[inc.type] || 'fa-triangle-exclamation';

            const iconHtml = `
                <div class="incident-marker">
                    <div class="incident-icon icon-${inc.type}">
                        <i class="fa-solid ${iconClass}"></i>
                    </div>
                </div>`;

            const customIcon = L.divIcon({
                html: iconHtml,
                className: '',
                iconSize: [32, 32],
                iconAnchor: [16, 16]
            });

            L.marker([inc.lat, inc.lon], { icon: customIcon })
                .addTo(map)
                .bindPopup(
                    `<strong>${inc.title}</strong><br>` +
                    `AI Impact Analysis: <strong>+${impact}% Delay</strong><br>` +
                    `Influence radius: ${inc.radius} km`
                );
        });
    }

    initMapIncidents();

    const benchBtn = document.getElementById('bench-btn');

    if (benchBtn && window.Evaluator && window.MetricsPanel) {
        benchBtn.addEventListener('click', () => {
            const N = parseInt(document.getElementById('bench-n').value, 10) || 50;
            const lambda = parseFloat(document.getElementById('bench-lambda').value);
            const target = document.getElementById('bench-output');

            window.MetricsPanel.mount(target);
            window.MetricsPanel.reset();

            const rows = window.Evaluator.run({
                N,
                lambda: Number.isFinite(lambda) ? lambda : 2.0,
                seed: 42,
                scenarioType: 'geo'
            });

            window.MetricsPanel.renderSummary(rows);
        });
    }

    const benchToggle = document.getElementById('bench-toggle-btn');
    const benchModal = document.getElementById('bench-modal');
    const benchClose = document.getElementById('bench-close-btn');

    if (benchToggle && benchModal) {
        benchToggle.addEventListener('click', ev => {
            ev.stopPropagation();
            benchModal.classList.toggle('hidden');
        });
    }

    if (benchClose && benchModal) {
        benchClose.addEventListener('click', () => {
            benchModal.classList.add('hidden');
        });
    }

    document.addEventListener('click', ev => {
        if (!benchModal || benchModal.classList.contains('hidden')) return;
        if (benchModal.contains(ev.target) || (benchToggle && benchToggle.contains(ev.target))) return;

        benchModal.classList.add('hidden');
    });

    function syncClearVisibility() {
        const oc = document.getElementById('origin-clear');
        const dc = document.getElementById('dest-clear');
        const oi = document.getElementById('origin-input');
        const di = document.getElementById('destination-input');

        if (oc && oi) {
            oc.classList.toggle('hidden', !oi.value && window.originLat == null);
        }

        if (dc && di) {
            dc.classList.toggle('hidden', !di.value && window.selectedLat == null);
        }
    }

    window.syncClearVisibility = syncClearVisibility;

    const originClear = document.getElementById('origin-clear');

    if (originClear) {
        originClear.addEventListener('click', () => {
            const oi = document.getElementById('origin-input');

            if (oi) oi.value = '';

            if (window.originMarker) {
                map.removeLayer(window.originMarker);
                window.originMarker = null;
            }

            window.originLat = null;
            window.originLon = null;

            syncClearVisibility();
        });
    }

    const destClear = document.getElementById('dest-clear');

    if (destClear) {
        destClear.addEventListener('click', () => {
            const di = document.getElementById('destination-input');

            if (di) di.value = '';

            if (window.targetMarker) {
                map.removeLayer(window.targetMarker);
                window.targetMarker = null;
            }

            if (window.routePath) {
                map.removeLayer(window.routePath);
                window.routePath = null;
            }

            if (window.altRoutePath) {
                map.removeLayer(window.altRoutePath);
                window.altRoutePath = null;
            }

            window.selectedLat = null;
            window.selectedLon = null;

            const list = document.getElementById('routes-list');
            if (list) list.innerHTML = '';

            const status = document.querySelector('.status-text');
            if (status) status.textContent = 'Waiting for destination...';

            syncClearVisibility();
        });
    }

    ['origin-input', 'destination-input'].forEach(id => {
        const el = document.getElementById(id);

        if (el) {
            el.addEventListener('input', syncClearVisibility);
        }
    });

    syncClearVisibility();
});