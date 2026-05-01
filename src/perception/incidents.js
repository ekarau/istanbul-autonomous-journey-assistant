// ================================================================
//  incidents.js  —  Perception: Traffic Incident Detection
//  COE017 Principles of AI  |  Istanbul Autonomous Journey Asst.
//  Role: Data & Simulation Engineer / Perception Layer
// ================================================================
//
//  FIX (Architecture §4.2 — Defect 2):
//  Converted from ES module to IIFE.  Reads incident zone data
//  from window.DELAY_FACTORS_DATA (delay_factors.js) so the zone
//  list has a single canonical definition.
// ================================================================

(function () {
    'use strict';

    // ── Inline fallback (same data as incidents-snapshot.json) ────
    const FALLBACK_ZONES = [
        { lat: 41.045, lon: 29.034, type: 'accident',  factorKey: 'accident',  radius: 3.0,
          title: 'Chain Accident: 15 Temmuz Şehitler Bridge' },
        { lat: 41.062, lon: 28.810, type: 'work',       factorKey: 'roadwork',  radius: 2.5,
          title: 'Road Work: TEM Mahmutbey' },
        { lat: 41.068, lon: 29.010, type: 'breakdown',  factorKey: 'breakdown', radius: 1.5,
          title: 'Breakdown: Zincirlikuyu E-5' },
        { lat: 41.160, lon: 29.050, type: 'weather',    factorKey: 'rain',      radius: 5.0,
          title: 'Bad Weather Conditions: Sarıyer' }
    ];

    // Active zones — populated from JSON on load, fallback used if fetch fails
    let _zones = FALLBACK_ZONES;

    // ── Load incidents-snapshot.json ──────────────────────────────
    //  Fetch the snapshot file so the project uses the actual IBB
    //  incident data rather than the hardcoded inline copy.
    //  On success: _zones is replaced with the JSON incidents array.
    //  On failure: _zones stays as FALLBACK_ZONES (silent degradation).
    (function loadSnapshot() {
        const url = '../assets/data/incidents-snapshot.json';
        fetch(url)
            .then(res => {
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                return res.json();
            })
            .then(data => {
                if (Array.isArray(data.incidents) && data.incidents.length > 0) {
                    _zones = data.incidents;
                    console.info(
                        `[IncidentDetector] Loaded ${_zones.length} incidents from snapshot`,
                        `(source: ${data.source || 'incidents-snapshot.json'},`,
                        `date: ${data.snapshot_date || 'unknown'})`
                    );
                }
            })
            .catch(err => {
                console.warn('[IncidentDetector] Could not load snapshot, using fallback zones:', err.message);
            });
    })();

    /**
     * getZones — returns the currently active incident zones.
     * After page load this will be the JSON snapshot data;
     * during the brief fetch window it returns FALLBACK_ZONES.
     */
    function getZones() {
        return _zones;
    }

    /**
     * getActiveIncidentsOnRoute
     * -------------------------
     * Returns incident zones whose influence radius intersects the
     * straight-line path between start and end (checked at start,
     * midpoint, and end).
     *
     * @param {Array<{lat,lng}>} routePoints  — array of coordinate objects
     * @param {Function}         distanceFn   — (coord1, coord2) → km
     * @returns {object[]}  matching incident zone objects
     */
    function getActiveIncidentsOnRoute(routePoints, distanceFn) {
        if (!Array.isArray(routePoints) || typeof distanceFn !== 'function') return [];
        const zones = getZones();
        return zones.filter(zone =>
            routePoints.some(pt =>
                distanceFn(pt, { lat: zone.lat, lng: zone.lon }) <= zone.radius
            )
        );
    }

    // ── Public API ────────────────────────────────────────────────
    window.IncidentDetector = {
        getZones,
        getActiveIncidentsOnRoute
    };

    console.info('[IncidentDetector] Perception module loaded — COE017');
})();
