// ================================================================
//  delay_factors.js  —  Single Source of Truth for Delay Constants
//  COE017 Principles of AI  |  Istanbul Autonomous Journey Asst.
//  Role: Data & Simulation Engineer (Selvinaz)
// ================================================================
//
//  FIX (Architecture §4.2 — Defect 3):
//  Previously this file was never loaded anywhere; the same constants
//  were duplicated inside agent.js and math_model.js independently,
//  with no guarantee they stayed in sync.
//
//  This file is now:
//    1. Loaded via <script> in index.html BEFORE all other modules.
//    2. Exposes everything on window.* so agent.js, math_model.js,
//       optimizer.js, and simulated_annealing.js all read from
//       the same object.
//    3. math_model.js reads window.DELAY_FACTORS_DATA if present
//       (see the updated DELAY_PARAMS initialisation block there).
//
//  All values derived from real IBB / TÜİK data.
//  Kaynak ve metodoloji: docs/data-sources.md
// ================================================================

(function () {
    'use strict';

    // ── Delay factor coefficients ──────────────────────────────────
    // Her koşul için:
    //   base     → olasılıksal gecikme oranı (0–1)
    //   variance → Gaussian örnekleme için standart sapma
    //
    // peakHour   → IBB Saatlik Trafik Yoğunluk Verisi (2024)
    //              Araç-ağırlıklı hız: serbest akış 68.7 km/h
    //              Akşam piki (18:00): 45.8 km/h → oran 0.333
    //
    // normal     → IBB Trafik Endeksi hafta içi minimum → 0.022
    //
    // rain       → Ocak–Temmuz hız farkı + literatür düzeltmesi → 0.18
    //
    // accident   → TÜİK 2022-24 İST ort. ~69 kaza/gün
    //              Şerit kapama kapasite modeli → 0.35
    //
    // intercontinental → peakHour × 1.4 (köprü/tünel darboğazı)
    //
    // westSide   → E-5/TEM bölgesi; peakHour × 1.15
    //
    // roadwork   → UKOME literatürü → +%22
    //
    // breakdown  → Tek şerit kapama modeli → +%14
    //
    // longRoute  → IBB midday delay ratio (>15 km) → 0.272
    // ──────────────────────────────────────────────────────────────
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

    // ── Transit insulation ─────────────────────────────────────────
    // Transit araçlar yol incident'larından %55 korunur (dedicated lane)
    const TRANSIT_INSULATION = 0.55;

    // ── Confidence score parametreleri ────────────────────────────
    const CONFIDENCE_PARAMS = {
        base:            0.94,
        perIncident:     0.06,
        longRoute:       0.08,
        intercontinental: 0.07,
        peak:            0.05,
        min:             0.42
    };

    // ── Peak hour pencereleri (dakika cinsinden) ───────────────────
    // Sabah 07:30–09:30, akşam 17:00–20:00
    const PEAK_WINDOWS = [
        { start: 7 * 60 + 30, end: 9 * 60 + 30 },
        { start: 17 * 60,     end: 20 * 60      }
    ];

    // ── Incident zone'ları ve etki yarıçapları (km) ───────────────
    const INCIDENT_ZONE_DEFAULTS = [
        { lat: 41.045, lon: 29.034, type: 'accident',  factorKey: 'accident',  radius: 3.0,
          title: 'Chain Accident: 15 Temmuz Şehitler Bridge' },
        { lat: 41.062, lon: 28.810, type: 'work',       factorKey: 'roadwork',  radius: 2.5,
          title: 'Road Work: TEM Mahmutbey' },
        { lat: 41.068, lon: 29.010, type: 'breakdown',  factorKey: 'breakdown', radius: 1.5,
          title: 'Breakdown: Zincirlikuyu E-5' },
        { lat: 41.160, lon: 29.050, type: 'weather',    factorKey: 'rain',      radius: 5.0,
          title: 'Bad Weather Conditions: Sarıyer' }
    ];

    // ── Expose on window (browser) ────────────────────────────────
    window.DELAY_FACTORS_DATA = {
        DELAY_FACTORS,
        TRANSIT_INSULATION,
        CONFIDENCE_PARAMS,
        PEAK_WINDOWS,
        INCIDENT_ZONE_DEFAULTS
    };

    // Legacy flat aliases so any existing code that directly reads
    // window.DELAY_FACTORS, window.TRANSIT_INSULATION etc. still works.
    window.DELAY_FACTORS        = DELAY_FACTORS;
    window.TRANSIT_INSULATION   = TRANSIT_INSULATION;
    window.CONFIDENCE_PARAMS    = CONFIDENCE_PARAMS;
    window.PEAK_WINDOWS         = PEAK_WINDOWS;
    window.INCIDENT_ZONE_DEFAULTS = INCIDENT_ZONE_DEFAULTS;

    console.info('[DelayFactors] Single-source constants loaded — COE017 Data & Simulation Engineer');
    console.table(
        Object.entries(DELAY_FACTORS).map(([k, v]) => ({
            factor: k, base: v.base, variance: v.variance
        }))
    );
})();
