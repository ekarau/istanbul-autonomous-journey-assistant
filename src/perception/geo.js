// ================================================================
//  geo.js  —  Perception: Geospatial Utilities
//  COE017 Principles of AI  |  Istanbul Autonomous Journey Asst.
//  Role: Data & Simulation Engineer / Perception Layer
// ================================================================
//
//  FIX (Architecture §4.2 — Defect 2):
//  Previously used ES module `export` syntax which is incompatible
//  with plain <script> loading in index.html and was therefore
//  never actually executed.  Converted to IIFE that exposes an
//  API on window.GeoUtils so all other modules can call it without
//  a module bundler.
// ================================================================

(function () {
    'use strict';

    /**
     * haversineDistance
     * -----------------
     * Calculates the great-circle distance between two coordinates
     * using the Haversine formula.
     *
     * @param {{ lat: number, lng: number }} coord1
     * @param {{ lat: number, lng: number }} coord2
     * @returns {number}  distance in kilometres
     */
    function haversineDistance(coord1, coord2) {
        const R = 6371; // Earth radius in km
        const toRad = deg => (deg * Math.PI) / 180;

        const dLat = toRad(coord2.lat - coord1.lat);
        const dLon = toRad(coord2.lng - coord1.lng);
        const lat1 = toRad(coord1.lat);
        const lat2 = toRad(coord2.lat);

        const a =
            Math.sin(dLat / 2) ** 2 +
            Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);

        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }

    // ── Bosphorus centre-line knots (piecewise-linear) ────────────
    //  Each entry is [lat, midLng].  Enables accurate Europe/Asia
    //  detection along the curved strait rather than a single
    //  longitude threshold.
    const BOSPHORUS_KNOTS = [
        [40.965, 29.020], [41.000, 28.985], [41.025, 28.995],
        [41.045, 29.015], [41.080, 29.050], [41.115, 29.062],
        [41.180, 29.085], [41.230, 29.110]
    ];

    function bosphorusMidLng(lat) {
        if (lat <= BOSPHORUS_KNOTS[0][0]) return BOSPHORUS_KNOTS[0][1];
        const last = BOSPHORUS_KNOTS[BOSPHORUS_KNOTS.length - 1];
        if (lat >= last[0]) return last[1];
        for (let i = 0; i < BOSPHORUS_KNOTS.length - 1; i++) {
            const a = BOSPHORUS_KNOTS[i], b = BOSPHORUS_KNOTS[i + 1];
            if (lat >= a[0] && lat <= b[0]) {
                const t = (lat - a[0]) / (b[0] - a[0]);
                return a[1] + t * (b[1] - a[1]);
            }
        }
        return last[1];
    }

    /**
     * isEuropeanSide
     * Returns true if the coordinate is west of the Bosphorus.
     */
    function isEuropeanSide(lat, lng) {
        return lng < bosphorusMidLng(lat);
    }

    /**
     * isIntercontinental
     * Returns true if the two coordinates are on opposite sides
     * of the Bosphorus strait.
     *
     * @param {{ lat, lng }} coord1
     * @param {{ lat, lng }} coord2
     */
    function isIntercontinental(coord1, coord2) {
        return isEuropeanSide(coord1.lat, coord1.lng) !==
               isEuropeanSide(coord2.lat, coord2.lng);
    }

    /**
     * isWestSide
     * Returns true if a coordinate is deep in the E-5 / TEM
     * congestion zone (west of 28.8°E).
     */
    function isWestSide(coord) {
        return coord.lng < 28.8;
    }

    // ── Public API ────────────────────────────────────────────────
    window.GeoUtils = {
        haversineDistance,
        bosphorusMidLng,
        isEuropeanSide,
        isIntercontinental,
        isWestSide,
        BOSPHORUS_KNOTS
    };

    console.info('[GeoUtils] Perception module loaded — COE017');
})();
