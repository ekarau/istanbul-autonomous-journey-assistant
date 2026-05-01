// ================================================================
//  probability.js  —  Probability Utilities
//  COE017 Principles of AI  |  Istanbul Autonomous Journey Asst.
//  Role: Mathematical Modeler (Tuğba)
// ================================================================
//
//  FIX (Requirements — probability.js was a TODO stub):
//  Probability functions already existed in math_model.js but
//  were never exposed as a standalone module.  This file wraps
//  them via window.ProbabilityUtils and adds a Gaussian sampler
//  and an entropy function for academic completeness.
// ================================================================

(function () {
    'use strict';

    // Read delay params from single source of truth
    function getParams() {
        return (window.DELAY_FACTORS_DATA && window.DELAY_FACTORS_DATA.DELAY_FACTORS)
            || window.DELAY_FACTORS
            || {};
    }

    /**
     * gaussianRandom
     * --------------
     * Box-Muller transform — produces N(0,1) random variate.
     * @returns {number}
     */
    function gaussianRandom() {
        let u = 0, v = 0;
        while (u === 0) u = Math.random();
        while (v === 0) v = Math.random();
        return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
    }

    /**
     * sampleFactor
     * ------------
     * Draws a single delay probability for a given factor key
     * using Gaussian noise around the base value.
     *
     * @param {string} key  — factor key (e.g. 'accident')
     * @returns {number}    — sampled probability in [0, 1]
     */
    function sampleFactor(key) {
        const p = getParams();
        const f = p[key];
        if (!f) return 0;
        const sampled = f.base + f.variance * gaussianRandom();
        return Math.max(0, Math.min(1, sampled));
    }

    /**
     * probabilityUnion
     * ----------------
     * Independent-events complement rule:
     *   P(A₁ ∪ A₂ ∪ … ∪ Aₙ) = 1 − ∏ (1 − P(Aᵢ))
     *
     * @param {string[]} activeFactorKeys
     * @returns {{ prob: number, mean: number, sigma: number }}
     */
    function probabilityUnion(activeFactorKeys) {
        if (mm()) return mm().probabilityUnion(activeFactorKeys);
        const p = getParams();
        let complement = 1.0;
        let varianceSum = 0;
        activeFactorKeys.forEach(k => {
            const f = p[k];
            if (!f) return;
            complement  *= (1 - f.base);
            varianceSum += f.variance ** 2;
        });
        const prob  = Math.max(0, Math.min(1, 1 - complement));
        const sigma = Math.sqrt(varianceSum);
        return { prob, mean: prob, sigma };
    }

    /**
     * expectedDelay
     * -------------
     * E[D] = T_base × P(delay)
     * σ[D] = T_base × √(Σ σᵢ²)
     * 95% CI: [E[D] − 1.96·σ[D],  E[D] + 1.96·σ[D]]
     *
     * @param {number}   baseTimeMin
     * @param {string[]} activeKeys
     * @returns {{ E: number, sigma: number, ciLow: number, ciHigh: number }}
     */
    function expectedDelay(baseTimeMin, activeKeys) {
        if (mm()) return mm().expectedDelay(baseTimeMin, activeKeys);
        const { prob, sigma } = probabilityUnion(activeKeys);
        const E      = Math.round(baseTimeMin * prob);
        const sigmaD = Math.round(baseTimeMin * sigma);
        return {
            E,
            sigma:  sigmaD,
            ciLow:  Math.max(0, E - Math.round(1.96 * sigmaD)),
            ciHigh: E + Math.round(1.96 * sigmaD)
        };
    }

    /**
     * shannonEntropy
     * --------------
     * H(p) = −p·log₂(p) − (1−p)·log₂(1−p)
     * Quantifies uncertainty in a binary delay event.
     *
     * @param {number} p  — probability in (0, 1)
     * @returns {number}  — entropy in bits
     */
    function shannonEntropy(p) {
        if (p <= 0 || p >= 1) return 0;
        return -(p * Math.log2(p) + (1 - p) * Math.log2(1 - p));
    }

    function mm() { return window.MathModel || null; }

    // ── Public API ────────────────────────────────────────────────
    window.ProbabilityUtils = {
        gaussianRandom,
        sampleFactor,
        probabilityUnion,
        expectedDelay,
        shannonEntropy
    };

    console.info('[ProbabilityUtils] Module loaded — COE017 Mathematical Modeler');
})();
