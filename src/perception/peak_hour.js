// ================================================================
//  peak_hour.js  —  Perception: Peak Hour Detection
//  COE017 Principles of AI  |  Istanbul Autonomous Journey Asst.
//  Role: Data & Simulation Engineer / Perception Layer
// ================================================================
//
//  FIX (Architecture §4.2 — Defect 2):
//  Converted from ES module to IIFE.  Reads peak windows from
//  window.DELAY_FACTORS_DATA (delay_factors.js) so the time
//  windows are defined in exactly one place.
// ================================================================

(function () {
    'use strict';

    /**
     * isPeakHour
     * ----------
     * Returns true if the given date/time falls within Istanbul's
     * defined peak traffic windows:
     *   Morning: 07:30 – 09:30
     *   Evening: 17:00 – 20:00
     *
     * Window boundaries are read from window.DELAY_FACTORS_DATA
     * (populated by delay_factors.js) with inline fallback values.
     *
     * @param {Date} [date=new Date()]
     * @returns {boolean}
     */
    function isPeakHour(date) {
        const now = date || new Date();
        const totalMinutes = now.getHours() * 60 + now.getMinutes();

        const windows = (window.DELAY_FACTORS_DATA && window.DELAY_FACTORS_DATA.PEAK_WINDOWS)
            || [
                { start: 7 * 60 + 30, end: 9 * 60 + 30 },
                { start: 17 * 60,     end: 20 * 60      }
            ];

        return windows.some(w => totalMinutes >= w.start && totalMinutes <= w.end);
    }

    /**
     * getPeakLabel
     * ------------
     * Human-readable label for the current traffic period.
     * @returns {string}  e.g. "Morning Peak", "Evening Peak", "Off-Peak"
     */
    function getPeakLabel(date) {
        const now = date || new Date();
        const h = now.getHours();
        if (h >= 7  && h < 10)  return 'Morning Peak';
        if (h >= 17 && h < 20)  return 'Evening Peak';
        if (h >= 22 || h < 6)   return 'Night (low traffic)';
        return 'Off-Peak';
    }

    // ── Public API ────────────────────────────────────────────────
    window.PeakHour = {
        isPeakHour,
        getPeakLabel
    };

    console.info('[PeakHour] Perception module loaded — COE017');
})();
