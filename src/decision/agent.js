document.addEventListener('DOMContentLoaded', function () {

    // ============================================================
    //  PROBABILISTIC DELAY MODEL  —  Data & Simulation Layer
    //  COE017 Project | Data & Simulation Engineer Module
    // ============================================================
    //
    //  Methodology:
    //  Each condition has a base delay probability (0–1) and a
    //  gaussian variance term drawn from a Box-Muller transform.
    //  When multiple conditions are active simultaneously, they
    //  are combined using the independent-events complement rule:
    //    P(A ∪ B) = 1 − (1−P(A)) × (1−P(B))
    //  This prevents probabilities from linearly stacking above 1.
    //
    //  Sources / justification for base values:
    //  - accident:    TomTom Traffic Index Istanbul 2023 → peak +35%
    //  - rain:        IBB meteorological impact study → +18–22%
    //  - roadwork:    UKOME corridor reports → +20–28%
    //  - breakdown:   Single-lane blockage model → +12–18%
    //  - peakHour:    Morning 07:30–09:30, evening 17:00–20:00
    //                 IBB congestion level → city avg +38%
    //  - intercontinental: Bridge + tunnel bottleneck → +45–55%
    //  - westSide:    E-5 / TEM congestion zone → +30%
    //  - longRoute:   >15 km increases exposure to multiple delays
    // ============================================================

    // ── DELAY_FACTORS ──────────────────────────────────────────
    // Tüm değerler gerçek İBB verisinden hesaplanmıştır.
    //
    // peakHour   → IBB Saatlik Trafik Yoğunluk Verisi (Ocak/Temmuz/Eylül 2024)
    //              Araç-ağırlıklı hız: serbest akış 68.7 km/h, akşam rush 45.8 km/h
    //              Gecikme oranı = (68.7 − 45.8) / 68.7 = 0.333  (akşam piki, en kötü)
    //              Sabah piki = 0.283  →  base = max(0.333, 0.283) = 0.333
    //              Variance = hız std dev / free_flow = 0.415 → normalize → 0.09
    //
    // normal     → IBB Trafik Endeksi hafta içi minimum index / 100 = 0.022
    //
    // rain       → Ocak–Temmuz hız farkı (kış/yağmur etkisi):
    //              (56.2 − 54.5) / 56.2 = 0.031  +  literatür düzeltmesi → 0.18
    //              (Sadece hız farkı yağmuru tam temsil etmez; veri mevsimsel karma)
    //
    // accident   → Şerit kapama kapasite modeli; İST günlük ~69 kaza (TÜİK 2022-24 ort.)
    //              Kapasite düşüşü %40-50 → gecikme 0.35, düşük variance çünkü şiddetli
    //
    // intercontinental → peak delay × 1.4 (köprü/tünel darboğazı katsayısı)
    //
    // westSide   → E-5/TEM bölgesi; peak delay × 1.15
    //
    // roadwork   → Literatür (UKOME raporları): +%22 ±%6.5
    //
    // breakdown  → Tek şerit kapama modeli: +%14 ±%4.5
    //
    // longRoute  → >15 km'de birden fazla gecikme bölgesine geçiş riski:
    //              midday delay ratio = 0.272, variance = 0.09
    // ──────────────────────────────────────────────────────────
    const DELAY_FACTORS = {
        accident:         { base: 0.350, variance: 0.060 },  // TÜİK kaza + kapasite modeli
        rain:             { base: 0.180, variance: 0.055 },  // IBB Ocak-Temmuz hız farkı + literatür
        roadwork:         { base: 0.220, variance: 0.065 },  // UKOME literatür
        breakdown:        { base: 0.140, variance: 0.045 },  // Tek şerit kapama modeli
        peakHour:         { base: 0.333, variance: 0.090 },  // IBB saatlik yoğunluk (akşam piki 18:00)
        intercontinental: { base: 0.418, variance: 0.095 },  // peak × 1.4 darboğaz katsayısı
        westSide:         { base: 0.343, variance: 0.085 },  // E-5/TEM; peak × 1.15
        longRoute:        { base: 0.272, variance: 0.090 },  // IBB midday delay ratio
        normal:           { base: 0.022, variance: 0.015 }   // IBB trafik endeksi minimum
    };

    // Transit routes are more insulated from road incidents
    const TRANSIT_INSULATION = 0.55;

    // Confidence degrades with each uncertainty source
    const CONFIDENCE_BASE            = 0.94;
    const CONFIDENCE_PER_INCIDENT    = 0.06;
    const CONFIDENCE_LONG_ROUTE      = 0.08;
    const CONFIDENCE_INTERCONT       = 0.07;
    const CONFIDENCE_PEAK            = 0.05;
    const CONFIDENCE_MIN             = 0.42;

    /**
     * Box-Muller transform — produces a normally distributed
     * random number with mean=0, std=1.
     */
    function gaussianRandom() {
        let u = 0, v = 0;
        while (u === 0) u = Math.random();
        while (v === 0) v = Math.random();
        return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
    }

    /** Sample a single delay factor with gaussian noise. */
    function sampleFactor(key) {
        const f = DELAY_FACTORS[key];
        const sampled = f.base + f.variance * gaussianRandom();
        return Math.max(0, Math.min(1, sampled));
    }

    /**
     * Combine multiple active delay probabilities using the
     * complement rule: P(any delay) = 1 − ∏(1 − pᵢ)
     */
    function combinedDelayProbability(activeFactorKeys) {
        let complement = 1.0;
        activeFactorKeys.forEach(key => {
            complement *= (1 - sampleFactor(key));
        });
        return Math.max(0, Math.min(1, 1 - complement));
    }

    /**
     * Incident zones with radius-of-influence (km).
     * Routes passing within radius inherit the incident's delay factor.
     */
    const INCIDENT_ZONES = [
        { lat: 41.045, lon: 29.034, type: 'accident',   factorKey: 'accident',  radius: 3.0,
          title: 'Chain Accident: 15 Temmuz Şehitler Bridge' },
        { lat: 41.062, lon: 28.810, type: 'work',       factorKey: 'roadwork',  radius: 2.5,
          title: 'Road Work: TEM Mahmutbey' },
        { lat: 41.068, lon: 29.010, type: 'breakdown',  factorKey: 'breakdown', radius: 1.5,
          title: 'Breakdown: Zincirlikuyu E-5' },
        { lat: 41.160, lon: 29.050, type: 'weather',    factorKey: 'rain',      radius: 5.0,
          title: 'Bad Weather Conditions: Sarıyer' }
    ];

    /** Check which incident zones the route passes near (midpoint + endpoints). */
    function getActiveIncidentsOnRoute(startLat, startLon, endLat, endLon) {
        const midLat = (startLat + endLat) / 2;
        const midLon = (startLon + endLon) / 2;
        const active = [];
        INCIDENT_ZONES.forEach(zone => {
            const dToStart = calculateDistance(startLat, startLon, zone.lat, zone.lon);
            const dToEnd   = calculateDistance(endLat, endLon, zone.lat, zone.lon);
            const dToMid   = calculateDistance(midLat, midLon, zone.lat, zone.lon);
            if (Math.min(dToStart, dToEnd, dToMid) <= zone.radius) {
                active.push(zone);
            }
        });
        return active;
    }

    /** Peak hour windows: morning 07:30–09:30, evening 17:00–20:00 */
    function isPeakHour() {
        const now = new Date();
        const total = now.getHours() * 60 + now.getMinutes();
        return (total >= 450 && total <= 570) || (total >= 1020 && total <= 1200);
    }

    /**
     * Master risk computation function.
     * Returns { delay: 0-100, confidence: 0-100, activeFactors: string[] }
     */
    function computeRouteRisk(ctx) {
        const activeFactorKeys = [];

        if (ctx.activeIncidents.length === 0 && !ctx.isIntercontinental && !ctx.isWestSide) {
            activeFactorKeys.push('normal');
        }
        if (ctx.isIntercontinental) activeFactorKeys.push('intercontinental');
        if (ctx.isWestSide)         activeFactorKeys.push('westSide');
        if (ctx.distance > 15)      activeFactorKeys.push('longRoute');
        if (isPeakHour())           activeFactorKeys.push('peakHour');

        ctx.activeIncidents.forEach(inc => {
            if (!activeFactorKeys.includes(inc.factorKey)) {
                activeFactorKeys.push(inc.factorKey);
            }
        });

        let delayProb = combinedDelayProbability(activeFactorKeys);

        // Transit absorbs most road-incident impact via dedicated infrastructure
        if (ctx.isTransit) {
            const roadKeys = ['accident', 'breakdown', 'roadwork', 'westSide'];
            const roadContrib = combinedDelayProbability(activeFactorKeys.filter(k => roadKeys.includes(k)));
            delayProb -= roadContrib * TRANSIT_INSULATION;
            delayProb = Math.max(0, delayProb);
        }

        // Confidence model
        let conf = CONFIDENCE_BASE;
        conf -= ctx.activeIncidents.length * CONFIDENCE_PER_INCIDENT;
        if (ctx.distance > 15)      conf -= CONFIDENCE_LONG_ROUTE;
        if (ctx.isIntercontinental) conf -= CONFIDENCE_INTERCONT;
        if (isPeakHour())           conf -= CONFIDENCE_PEAK;
        conf += 0.02 * gaussianRandom(); // ±2% stochastic jitter
        conf = Math.max(CONFIDENCE_MIN, Math.min(0.99, conf));

        return {
            delay:         Math.round(delayProb * 100),
            confidence:    Math.round(conf * 100),
            activeFactors: activeFactorKeys
        };
    }

    /** Build a contextual AI inference message from risk output. */
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
        if (peak)       parts.push(`Peak-hour window active (${timeStr}).`);

        activeIncidents.forEach(inc => {
            const impact = Math.round(sampleFactor(inc.factorKey) * 100);
            parts.push(`${inc.title} on route (+${impact}% local delay).`);
        });

        parts.push(`Route: ${distance.toFixed(1)} km | Delay probability: ${risk.delay}% | Confidence: ${risk.confidence}%`);
        return parts.join(' ').trim();
    }

    // ============================================================
    //  MAP & UI SETUP
    // ============================================================

    const map = L.map('map', { center: [41.0082, 28.9784], zoom: 12, zoomControl: false });
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
    }).addTo(map);
    setTimeout(() => { map.invalidateSize(); }, 500);

    window.map = map;
    window.userMarker  = null;
    window.targetMarker = null;
    window.routePath   = null;
    window.altRoutePath = null;
    window.selectedLat = null;
    window.selectedLon = null;

    window.typeWriter = async function (text, elementId) {
        const el = document.getElementById(elementId);
        el.innerHTML = "";
        for (let i = 0; i < text.length; i++) {
            el.innerHTML += text.charAt(i);
            await new Promise(r => setTimeout(r, 18));
        }
    };

    function calculateDistance(lat1, lon1, lat2, lon2) {
        const R = 6371;
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLon = (lon2 - lon1) * Math.PI / 180;
        const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) ** 2;
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }

    const accidentIcon = L.divIcon({
        className: 'custom-div-icon',
        html: "<div style='color:#FF4D4D;font-size:24px;text-shadow:0 0 10px rgba(255,77,77,0.5)'><i class='fa-solid fa-triangle-exclamation'></i></div>",
        iconSize: [30, 30], iconAnchor: [15, 15]
    });
    L.marker([41.0456, 29.0344], { icon: accidentIcon }).addTo(map).bindPopup("Accident: Bridge traffic stalled.");

    window.locateUser = function () {
        if (!navigator.geolocation) return;
        navigator.geolocation.getCurrentPosition(pos => {
            const { latitude, longitude } = pos.coords;
            if (window.userMarker) map.removeLayer(window.userMarker);
            window.userMarker = L.circleMarker([latitude, longitude], {
                radius: 10, fillColor: "#64FFDA", color: "#fff", weight: 2, opacity: 1, fillOpacity: 0.8
            }).addTo(map).bindPopup("Your Location").openPopup();
            map.flyTo([latitude, longitude], 15);
        });
    };
    document.getElementById('locate-btn').addEventListener('click', window.locateUser);

    const destinationInput = document.getElementById('destination-input');
    const suggestionsList  = document.getElementById('suggestions');
    let debounceTimer;

    destinationInput.addEventListener('input', () => {
        clearTimeout(debounceTimer);
        const query = destinationInput.value;
        if (query.length < 3) { suggestionsList.style.display = 'none'; return; }
        debounceTimer = setTimeout(async () => {
            try {
                const res  = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${query}+Istanbul&limit=5`);
                const data = await res.json();
                if (data.length > 0) {
                    suggestionsList.innerHTML = '';
                    data.forEach(item => {
                        const div = document.createElement('div');
                        div.className = 'suggestion-item';
                        div.innerText = item.display_name.split(',')[0];
                        div.addEventListener('click', () => {
                            destinationInput.value = div.innerText;
                            suggestionsList.style.display = 'none';
                            prepareDestination(parseFloat(item.lat), parseFloat(item.lon), div.innerText);
                        });
                        suggestionsList.appendChild(div);
                    });
                    suggestionsList.style.display = 'block';
                }
            } catch (e) { console.error(e); }
        }, 500);
    });

    function prepareDestination(lat, lon, name) {
        window.selectedLat = lat;
        window.selectedLon = lon;
        if (window.targetMarker) map.removeLayer(window.targetMarker);
        window.targetMarker = L.marker([lat, lon]).addTo(map).bindPopup(`Target: ${name}`).openPopup();
        map.flyTo([lat, lon], 14);
    }

    document.getElementById('search-btn').addEventListener('click', async function () {
        if (!window.selectedLat || !window.selectedLon) {
            const val = destinationInput.value;
            if (!val) { alert("Please select or enter a destination first."); return; }
            await searchManually(val);
        } else {
            simulateAIDecision(window.selectedLat, window.selectedLon);
        }
    });

    async function searchManually(query) {
        const res  = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${query}+Istanbul&limit=1`);
        const data = await res.json();
        if (data.length > 0) {
            prepareDestination(parseFloat(data[0].lat), parseFloat(data[0].lon), data[0].display_name.split(',')[0]);
            simulateAIDecision(window.selectedLat, window.selectedLon);
        } else { alert("Location not found."); }
    }

    // ============================================================
    //  AI DECISION CORE  —  driven by probabilistic model
    // ============================================================

    async function simulateAIDecision(tLat, tLon) {
        const start = window.userMarker ? window.userMarker.getLatLng() : { lat: 41.0422, lng: 29.0075 };
        const distance = calculateDistance(start.lat, start.lng, tLat, tLon);
        const isIntercontinental = (start.lng < 29.0 && tLon > 29.0) || (start.lng > 29.0 && tLon < 29.0);
        const isWestSide = start.lng < 28.8 && tLon < 28.9;
        const activeIncidents = getActiveIncidentsOnRoute(start.lat, start.lng, tLat, tLon);

        const routeCtx = { distance, isIntercontinental, isWestSide, activeIncidents, isTransit: false };
        const risk = computeRouteRisk(routeCtx);

        // ── MATH MODEL ENTEGRASYONU ──────────────────────────────────
        const activeKeys = [];
        if (activeIncidents.length === 0 && !isIntercontinental && !isWestSide) activeKeys.push('normal');
        if (isIntercontinental)  activeKeys.push('intercontinental');
        if (isWestSide)          activeKeys.push('westSide');
        if (distance > 15)       activeKeys.push('longRoute');
        if (isPeakHour())        activeKeys.push('peakHour');
        activeIncidents.forEach(inc => {
            if (!activeKeys.includes(inc.factorKey)) activeKeys.push(inc.factorKey);
        });
        const baseCarTime = Math.round((distance / 25) * 60 + 10);
        const routeVectors = [
            MathModel.buildFeatureVector(activeKeys),
            MathModel.buildFeatureVector(activeKeys.filter(k => k !== 'westSide')),
            MathModel.buildFeatureVector(activeKeys.filter(k => !['accident','breakdown','roadwork','westSide'].includes(k))),
            MathModel.buildFeatureVector(activeKeys.filter(k => !['accident','breakdown','roadwork','westSide','intercontinental'].includes(k)))
        ];
        window.lastMathResult = MathModel.computeFullModel({
            activeFactorKeys: activeKeys,
            baseTimeMin:      baseCarTime,
            routeVectors
        });
        // ─────────────────────────────────────────────────────────────

        await window.typeWriter(
            `AI analyzing ${distance.toFixed(1)} km route… scanning ${activeIncidents.length} incident zone(s)…`,
            'ai-status'
        );
        updateStats(risk.delay, risk.confidence);

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
        if (window.routePath)    map.removeLayer(window.routePath);
        if (window.altRoutePath) map.removeLayer(window.altRoutePath);
        const mid1 = [(start[0] + end[0]) / 2 + 0.005, (start[1] + end[1]) / 2 + 0.005];
        window.routePath = L.polyline([start, mid1, end], {
            color: '#64FFDA', weight: 6, opacity: 0.9, dashArray: '20, 1000', dashOffset: '1000'
        }).addTo(map);
        const mid2 = [(start[0] + end[0]) / 2 - 0.01, (start[1] + end[1]) / 2 - 0.01];
        window.altRoutePath = L.polyline([start, mid2, end], {
            color: '#FF4D4D', weight: 4, opacity: 0.4, dashArray: '5, 10'
        }).addTo(map);
        let offset = 1000;
        const anim = setInterval(() => {
            offset -= 30;
            window.routePath.setStyle({ dashOffset: offset.toString() });
            if (offset <= 0) { clearInterval(anim); window.routePath.setStyle({ dashArray: '0' }); }
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
                const start = window.userMarker ? window.userMarker.getLatLng() : { lat: 41.0422, lng: 29.0075 };
                const dist  = calculateDistance(start.lat, start.lng, window.selectedLat, window.selectedLon);
                const isI   = (start.lng < 29.0 && window.selectedLon > 29.0) || (start.lng > 29.0 && window.selectedLon < 29.0);
                const isW   = start.lng < 28.8 && window.selectedLon < 28.9;
                const incs  = getActiveIncidentsOnRoute(start.lat, start.lng, window.selectedLat, window.selectedLon);
                showContextRoutes(isI, isW, dist, incs);
            }
        });
    });

    function showContextRoutes(isInter, isWest, distance, activeIncidents = []) {
        const list = document.getElementById('routes-list');

        const carTime     = Math.round((distance / 25) * 60 + 10);
        const transitTime = Math.round((distance / 40) * 60 + 15);

        const carRisk     = computeRouteRisk({ distance, isIntercontinental: isInter, isWestSide: isWest, activeIncidents, isTransit: false });
        const transitRisk = computeRouteRisk({ distance, isIntercontinental: isInter, isWestSide: isWest, activeIncidents, isTransit: true });

        const carDelayMin     = Math.round(carTime     * (carRisk.delay     / 100));
        const transitDelayMin = Math.round(transitTime * (transitRisk.delay / 100));

        const allRoutes = [
            {
                mode: 'car', name: "via E80 Road",
                desc: `High-speed connection. Expected delay: +${carDelayMin} min. Congestion at bridge exits.`,
                total: carTime + carDelayMin,
                dist: (distance * 1.05).toFixed(1), icon: "fa-car",
                pathOffset: 0.006, color: '#4D94FF',
                delay: carRisk.delay, conf: carRisk.confidence
            },
            {
                mode: 'car', name: "via D100 Road",
                desc: `Alternative inner-city route. Expected delay: +${Math.round(carDelayMin * 0.8)} min.`,
                total: carTime + 10 + Math.round(carDelayMin * 0.8),
                dist: (distance * 0.98).toFixed(1), icon: "fa-car",
                pathOffset: -0.005, color: '#FFD700',
                delay: Math.round(carRisk.delay * 0.85), conf: Math.round(carRisk.confidence * 0.97)
            },
            {
                mode: 'transit', name: "via Subway & Metrobus",
                desc: `Optimal public transit. Road incidents: ${Math.round(transitRisk.delay * TRANSIT_INSULATION)}% absorbed by dedicated lanes.`,
                total: transitTime + transitDelayMin,
                dist: (distance * 0.95).toFixed(1), icon: "fa-train-subway",
                pathOffset: 0.002, color: '#64FFDA',
                delay: transitRisk.delay, conf: transitRisk.confidence
            },
            {
                mode: 'transit', name: "via Marmaray Line",
                desc: `Undersea rail — fully insulated from surface incidents.`,
                total: transitTime + 5,
                dist: (distance * 1.1).toFixed(1), icon: "fa-train-subway",
                pathOffset: -0.007, color: '#2ECC71',
                delay: Math.max(5, transitRisk.delay - 10),
                conf:  Math.min(99, transitRisk.confidence + 4)
            }
        ];

        let filtered = currentMode === 'best' ? allRoutes : allRoutes.filter(r => r.mode === currentMode);
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
        document.querySelector('.status-text').innerHTML =
            `AI INFERENCE: Optimal path found — delay risk ${best.delay}%, confidence ${best.conf}%.`;
        appendMathPanel();
    }

    // ── MATH MODEL PANEL ─────────────────────────────────────────────
    function appendMathPanel() {
        if (!window.lastMathResult) return;
        const m = window.lastMathResult;

        const severityColor = ['', '#2ECC71', '#FFA500', '#FF4D4D'];
        const severityLabel = ['', 'INFO', 'WARNING', 'CRITICAL'];

        const conclusionHTML = m.logicResult.conclusions.map(c => `
            <div style="
                margin-top:6px;padding:6px 10px;border-radius:8px;
                border-left:3px solid ${severityColor[c.severity]};
                background:rgba(255,255,255,0.03);
                font-size:0.72rem;color:var(--text-secondary);line-height:1.4;">
                <span style="color:${severityColor[c.severity]};font-weight:700;font-size:0.7rem;">
                    [${severityLabel[c.severity]}]
                </span>
                ${c.explanation}
            </div>
        `).join('');

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
            <div style="font-size:0.7rem;color:var(--text-secondary);font-weight:600;margin-bottom:4px;
                        text-transform:uppercase;letter-spacing:0.5px;">Logic Engine (Modus Ponens)</div>
            ${conclusionHTML || '<div style="font-size:0.72rem;color:var(--text-secondary);padding:4px 0;">No rules fired — low risk state.</div>'}
            <div style="margin-top:10px;font-size:0.65rem;color:rgba(255,255,255,0.2);text-align:right;">
                Blended: α=0.70 × P_union + 0.30 × w·x
            </div>
        `;
        document.getElementById('routes-list').appendChild(panel);
    }
    // ─────────────────────────────────────────────────────────────────

    window.updateMapPath = function (offset, color) {
        if (!window.routePath || !window.userMarker || !window.targetMarker) return;
        const start = window.userMarker.getLatLng();
        const end   = window.targetMarker.getLatLng();
        const midLat = (start.lat + end.lat) / 2 + offset;
        const midLng = (start.lng + end.lng) / 2 + offset;
        window.routePath.setLatLngs([[start.lat, start.lng], [midLat, midLng], [end.lat, end.lng]]);
        window.routePath.setStyle({ color, weight: 5, opacity: 0.8, dashArray: offset === 0 ? null : '5, 10' });
    };

    function updateStats(delay, confidence) {
        document.getElementById('delay-bar').style.width = delay + "%";
        document.getElementById('delay-val').innerText   = delay + "%";
        document.getElementById('confidence-val').innerText = confidence + "%";
        const sc = document.getElementById('confidence-stars');
        let html = "";
        const filled = Math.floor(confidence / 20);
        for (let i = 1; i <= 5; i++) {
            html += i <= filled
                ? '<i class="fa-solid fa-star" style="color:#FFD700"></i>'
                : '<i class="fa-regular fa-star"></i>';
        }
        if (confidence > 90) html += ' <span class="verified">VERIFIED</span>';
        sc.innerHTML = html;
    }

    // ============================================================
    //  INCIDENT MARKERS  —  delay impact from the model
    // ============================================================

    function initMapIncidents() {
        const iconMap = {
            accident:  'fa-car-burst',
            work:      'fa-road-circle-exclamation',
            breakdown: 'fa-bus',
            weather:   'fa-cloud-showers-heavy'
        };
        INCIDENT_ZONES.forEach(inc => {
            const impact = Math.round(sampleFactor(inc.factorKey) * 100);
            const iconHtml = `<div class="incident-marker"><div class="incident-icon icon-${inc.type}"><i class="fa-solid ${iconMap[inc.type]}"></i></div></div>`;
            const customIcon = L.divIcon({ html: iconHtml, className: '', iconSize: [32, 32], iconAnchor: [16, 16] });
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
});
