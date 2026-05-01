// ================================================================
//  route_decision.js  —  Route Evaluation Helper
//  COE017 Principles of AI  |  Istanbul Autonomous Journey Asst.
//  Role: Lead Developer
// ================================================================
//
//  FIX (Architecture §4.2 — Defect 2):
//  Previously used ES module `import` syntax which is incompatible
//  with plain <script> loading and was therefore dead code.
//  Converted to IIFE; all dependencies read from window:
//    - window.GeoUtils       (geo.js)
//    - window.IncidentDetector (incidents.js)
//    - window.PeakHour       (peak_hour.js)
// ================================================================

(function () {
    'use strict';

    /**
     * evaluateRoute
     * -------------
     * Scores a single route candidate and returns a recommendation.
     *
     * @param {{
     *   name          : string,
     *   points        : Array<{lat,lng}>,
     *   baseDurationMin: number
     * }} route
     *
     * @returns {{
     *   score          : number,
     *   recommendation : string,
     *   message        : string,
     *   incidents      : object[],
     *   distance       : number
     * }}
     */
    function evaluateRoute(route) {
        const geo       = window.GeoUtils;
        const detector  = window.IncidentDetector;
        const peakUtils = window.PeakHour;

        if (!geo || !detector || !peakUtils) {
            console.error('[RouteDecision] Required perception modules not loaded.');
            return null;
        }

        const { name, points, baseDurationMin } = route;

        // Calculate total distance via haversine along waypoints
        let distance = 0;
        for (let i = 0; i < points.length - 1; i++) {
            distance += geo.haversineDistance(points[i], points[i + 1]);
        }

        const incidents = detector.getActiveIncidentsOnRoute(points, geo.haversineDistance);
        const peak      = peakUtils.isPeakHour();
        const intercont = geo.isIntercontinental(points[0], points[points.length - 1]);

        // Scoring: start at 100, deduct for each risk factor
        let score = 100;
        score -= distance * 2;
        score -= incidents.length * 10;
        if (peak)      score -= 15;
        if (intercont) score -= 20;

        const recommendation =
            score > 70 ? 'Recommended' :
            score > 40 ? 'Acceptable'  : 'Avoid';

        // Build explanation string (mirrors inference_message logic)
        const incidentText = incidents.length > 0
            ? `${incidents.length} trafik olayı tespit edildi`
            : 'Aktif trafik olayı tespit edilmedi';
        const peakText = peak ? 'Yoğun saat aralığında' : 'Yoğun saat dışında';

        const message = [
            `Rota: ${name}`,
            `Mesafe: ${distance.toFixed(2)} km`,
            `Tahmini Süre: ${baseDurationMin} dakika`,
            `Trafik Durumu: ${incidentText}`,
            `Zaman Durumu: ${peakText}`,
            `Skor: ${score.toFixed(0)}`,
            `Öneri: ${recommendation}`
        ].join('\n');

        return { score, recommendation, message, incidents, distance };
    }

    // ── Public API ────────────────────────────────────────────────
    window.RouteDecision = { evaluateRoute };

    console.info('[RouteDecision] Module loaded — COE017');
})();
