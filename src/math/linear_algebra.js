// ================================================================
//  linear_algebra.js  —  Linear Algebra Utilities
//  COE017 Principles of AI  |  Istanbul Autonomous Journey Asst.
//  Role: Mathematical Modeler (Tuğba)
// ================================================================
//
//  FIX (Requirements — linear_algebra.js was a TODO stub):
//  The actual implementations (dotProduct, l2Norm, routeScoreMatrix)
//  already existed inside math_model.js but were never exposed as a
//  standalone module.  This file now wraps them into window.LinearAlgebra
//  by delegating to window.MathModel, which must be loaded first.
//
//  This satisfies the "modular separation" requirement without
//  duplicating any mathematics.
// ================================================================

(function () {
    'use strict';

    /**
     * Lazily resolve MathModel — safe to call after DOMContentLoaded.
     * Returns the MathModel API or null if not yet loaded.
     */
    function mm() { return window.MathModel || null; }

    /**
     * dotProduct
     * ----------
     * Computes w · x  (standard inner product in ℝⁿ).
     *
     * @param {Float64Array|number[]} w  weight vector
     * @param {Float64Array|number[]} x  feature vector
     * @returns {number}
     */
    function dotProduct(w, x) {
        if (mm()) return mm().dotProduct(w, x);
        // Standalone fallback (for unit tests loaded without math_model.js)
        let sum = 0;
        const len = Math.min(w.length, x.length);
        for (let i = 0; i < len; i++) sum += w[i] * x[i];
        return sum;
    }

    /**
     * l2Norm
     * ------
     * Computes the Euclidean norm ‖x‖₂ = √(Σ xᵢ²).
     *
     * @param {Float64Array|number[]} x
     * @returns {number}
     */
    function l2Norm(x) {
        if (mm()) return mm().l2Norm(x);
        let sum = 0;
        for (let i = 0; i < x.length; i++) sum += x[i] * x[i];
        return Math.sqrt(sum);
    }

    /**
     * routeScoreMatrix
     * ----------------
     * Given a list of route feature vectors (each ∈ ℝ⁹),
     * returns a score vector s = Wᵀ R  ∈ ℝᵐ.
     *
     * @param {Array<Float64Array|number[]>} routeVectors  columns of R
     * @returns {Float64Array}  score per route
     */
    function routeScoreMatrix(routeVectors) {
        if (mm()) return mm().routeScoreMatrix(routeVectors);
        // Fallback: needs WEIGHT_VECTOR — cannot compute standalone.
        console.warn('[LinearAlgebra] MathModel not loaded; cannot compute routeScoreMatrix.');
        return new Float64Array(routeVectors.length);
    }

    /**
     * cosineSimilarity
     * ----------------
     * cos θ = (a · b) / (‖a‖₂ · ‖b‖₂)
     * Useful for comparing two route risk profiles.
     *
     * @param {Float64Array|number[]} a
     * @param {Float64Array|number[]} b
     * @returns {number}  value in [−1, 1]
     */
    function cosineSimilarity(a, b) {
        const nA = l2Norm(a), nB = l2Norm(b);
        if (nA === 0 || nB === 0) return 0;
        return dotProduct(a, b) / (nA * nB);
    }

    /**
     * matMulVec
     * ---------
     * Multiplies an (m × n) matrix M by a vector v ∈ ℝⁿ → ℝᵐ.
     * M is stored row-major as an array of row arrays.
     *
     * @param {number[][]} M
     * @param {number[]}   v
     * @returns {Float64Array}
     */
    function matMulVec(M, v) {
        return new Float64Array(M.map(row => dotProduct(row, v)));
    }

    // ── Public API ────────────────────────────────────────────────
    window.LinearAlgebra = {
        dotProduct,
        l2Norm,
        routeScoreMatrix,
        cosineSimilarity,
        matMulVec
    };

    console.info('[LinearAlgebra] Module loaded — COE017 Mathematical Modeler');
})();
