// ================================================================
//  math_model.js  —  Mathematical Modeler Module
//  COE017 Principles of AI  |  Istanbul Autonomous Journey Asst.
//  Role: Mathematical Modeler
// ================================================================
//
//  This module implements three independent mathematical pillars
//  that power the AI agent's delay estimation:
//
//  1. LINEAR ALGEBRA
//     Each route is encoded as a feature vector x ∈ ℝ⁹.
//     A weight vector w ∈ ℝ⁹ (derived from IBB data) transforms
//     it into a scalar delay score via the dot product w · x.
//     Multiple routes are compared using a route matrix R ∈ ℝ^(9×4)
//     and a score vector  s = Wᵀ R ∈ ℝ⁴.
//     The L2-norm ‖x‖₂ serves as a dimensionless risk magnitude.
//
//  2. PROBABILITY
//     Active factor probabilities are combined using the
//     independent-events complement rule:
//       P(delay) = 1 − ∏ᵢ (1 − pᵢ)
//     Expected delay:  E[D] = T_base × P(delay)
//     Standard dev:    σ[D] = T_base × √(Σ σᵢ²)
//     95 % CI:         [E[D] − 1.96·σ[D],  E[D] + 1.96·σ[D]]
//
//  3. PROPOSITIONAL LOGIC (Modus Ponens inference engine)
//     A small rule base evaluates route context and fires
//     conclusions using the Modus Ponens schema:
//       P, P → Q  ⊢  Q
//
//  Public API:  window.MathModel
//    .buildFeatureVector(activeFactorKeys)  → x (Float64Array)
//    .dotProduct(w, x)                      → scalar
//    .l2Norm(x)                             → scalar
//    .routeScoreMatrix(routeConditionMatrix) → Float64Array (scores)
//    .probabilityUnion(activeFactorKeys)    → { prob, mean, sigma }
//    .expectedDelay(baseTimeMin, activeKeys) → { E, sigma, ciLow, ciHigh }
//    .runLogicEngine(ctx)                   → { conclusions[], severity }
//    .computeFullModel(ctx)                 → combined result object
// ================================================================

(function () {
    'use strict';

    // ============================================================
    //  FACTOR DEFINITIONS  (matches app.js DELAY_FACTORS)
    //  base  = mean delay probability derived from IBB data
    //  variance = σᵢ of the Gaussian noise term
    // ============================================================

    const FACTOR_INDEX = {
        accident:         0,
        rain:             1,
        roadwork:         2,
        breakdown:        3,
        peakHour:         4,
        intercontinental: 5,
        westSide:         6,
        longRoute:        7,
        normal:           8
    };

    const FACTOR_KEYS = Object.keys(FACTOR_INDEX); // length = 9 → vector dimension

    const DELAY_PARAMS = {
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

    // ============================================================
    //  SECTION 1 — LINEAR ALGEBRA
    // ============================================================
    //
    //  Weight vector w ∈ ℝ⁹ is derived by normalising each factor's
    //  base delay probability against the maximum (intercontinental =
    //  0.418), then scaling to [0, 1]:
    //
    //      wᵢ = base_i / max(base_j, j ∈ 1..9)
    //
    //  This gives a dimensionless importance ranking that can be
    //  used independently of the stochastic probability layer.
    // ============================================================

    const MAX_BASE = Math.max(...FACTOR_KEYS.map(k => DELAY_PARAMS[k].base));

    // Normalised weight vector (fixed, data-derived)
    const WEIGHT_VECTOR = new Float64Array(
        FACTOR_KEYS.map(k => DELAY_PARAMS[k].base / MAX_BASE)
    );

    /**
     * buildFeatureVector
     * ------------------
     * Encodes which factors are active for a given route as a
     * binary vector x ∈ {0,1}⁹.
     *
     * @param {string[]} activeFactorKeys  — e.g. ['accident', 'peakHour']
     * @returns {Float64Array}  x of length 9
     */
    function buildFeatureVector(activeFactorKeys) {
        const x = new Float64Array(FACTOR_KEYS.length);
        activeFactorKeys.forEach(k => {
            if (k in FACTOR_INDEX) x[FACTOR_INDEX[k]] = 1.0;
        });
        return x;
    }

    /**
     * dotProduct — w · x
     * ------------------
     * The weighted delay score for a single route.
     * Range: [0, 1] (since both w and x live in [0,1]⁹).
     *
     * @param {Float64Array} w  weight vector (length 9)
     * @param {Float64Array} x  feature vector (length 9)
     * @returns {number}
     */
    function dotProduct(w, x) {
        let sum = 0;
        for (let i = 0; i < w.length; i++) sum += w[i] * x[i];
        return sum;
    }

    /**
     * l2Norm — ‖x‖₂
     * --------------
     * Euclidean norm of the feature vector.
     * Measures the "distance from zero risk" in factor space.
     * Used as a dimensionless composite risk indicator.
     *
     * @param {Float64Array} x
     * @returns {number}
     */
    function l2Norm(x) {
        let sum = 0;
        for (let i = 0; i < x.length; i++) sum += x[i] * x[i];
        return Math.sqrt(sum);
    }

    /**
     * routeScoreMatrix
     * ----------------
     * Compares N routes simultaneously using matrix–vector product.
     *
     *   Given a route condition matrix R ∈ ℝ^(d × N)
     *   where each column rⱼ is the feature vector of route j,
     *   the score vector is:
     *
     *       s = Wᵀ R  ∈ ℝᴺ
     *
     *   where W is the diagonal weight matrix diag(w).
     *   This reduces to:  sⱼ = w · rⱼ  for each route j.
     *
     * @param {Float64Array[]} routeFeatureVectors  — array of column vectors
     * @returns {Float64Array}  score per route, higher = higher delay risk
     */
    function routeScoreMatrix(routeFeatureVectors) {
        return new Float64Array(routeFeatureVectors.map(r => dotProduct(WEIGHT_VECTOR, r)));
    }

    // ============================================================
    //  SECTION 2 — PROBABILITY
    // ============================================================
    //
    //  Model:
    //    Each factor i has an independent probability pᵢ of causing
    //    a delay, sampled from a Gaussian with mean μᵢ = base_i
    //    and variance σᵢ² (Box-Muller, in app.js).
    //
    //  Joint probability (complement rule):
    //    P(at least one delay) = 1 − ∏ᵢ (1 − pᵢ)
    //
    //  Expected delay (minutes):
    //    E[D] = T_base × P
    //
    //  Variance of D under independence:
    //    Var[D] = T_base² × Σᵢ σᵢ²
    //    σ[D]   = T_base × √(Σᵢ σᵢ²)
    //
    //  95 % Confidence Interval:
    //    CI = [ E[D] − 1.96·σ[D],  E[D] + 1.96·σ[D] ]
    // ============================================================

    /**
     * probabilityUnion
     * ----------------
     * Returns the combined delay probability and the aggregate
     * distribution parameters for a set of active factors.
     *
     * @param {string[]} activeFactorKeys
     * @returns {{ prob: number, meanProb: number, sigmaProb: number }}
     */
    function probabilityUnion(activeFactorKeys) {
        let complement = 1.0;
        let sigmaSquaredSum = 0;

        activeFactorKeys.forEach(k => {
            const p = DELAY_PARAMS[k];
            if (!p) return;
            complement      *= (1 - p.base);
            sigmaSquaredSum += p.variance * p.variance;
        });

        const prob = Math.max(0, Math.min(1, 1 - complement));
        return {
            prob,
            meanProb:  prob,
            sigmaProb: Math.sqrt(sigmaSquaredSum)  // propagated σ in probability space
        };
    }

    /**
     * expectedDelay
     * -------------
     * Computes E[D], σ[D], and the 95 % confidence interval
     * for the delay in minutes.
     *
     * @param {number}   baseTimeMin      base travel time (minutes, no delay)
     * @param {string[]} activeFactorKeys
     * @returns {{ E: number, sigma: number, ciLow: number, ciHigh: number, prob: number }}
     */
    function expectedDelay(baseTimeMin, activeFactorKeys) {
        const { prob, sigmaProb } = probabilityUnion(activeFactorKeys);

        const E     = baseTimeMin * prob;
        const sigma = baseTimeMin * sigmaProb;

        return {
            prob,
            E:      Math.round(E * 10) / 10,
            sigma:  Math.round(sigma * 10) / 10,
            ciLow:  Math.max(0, Math.round((E - 1.96 * sigma) * 10) / 10),
            ciHigh: Math.round((E + 1.96 * sigma) * 10) / 10
        };
    }

    // ============================================================
    //  SECTION 3 — PROPOSITIONAL LOGIC ENGINE (Modus Ponens)
    // ============================================================
    //
    //  Each rule has the form:
    //    premises : string[]   — conditions that must all be true
    //    conclusion : string   — derived fact if all premises hold
    //    severity  : number    — 1 (info), 2 (warning), 3 (critical)
    //
    //  Inference:  ∀ rule r:  if all r.premises ⊆ activeFacts
    //                         then conclude r.conclusion   (Modus Ponens)
    //
    //  The engine iterates rules in priority order and fires
    //  all that apply (forward chaining, single pass).
    // ============================================================

    const LOGIC_RULES = [
        {
            premises:    ['isAccident', 'isIntercontinental'],
            conclusion:  'FERRY_OR_MARMARAY_STRONGLY_ADVISED',
            severity:    3,
            explanation: 'Bridge accident detected on intercontinental route. Surface crossing blocked.'
        },
        {
            premises:    ['isPeakHour', 'isIntercontinental'],
            conclusion:  'EXPECT_BRIDGE_BOTTLENECK',
            severity:    2,
            explanation: 'Peak hour + Bosphorus crossing → significant bottleneck at bridge exits.'
        },
        {
            premises:    ['isWestSide', 'isPeakHour'],
            conclusion:  'PREFER_METROBUS',
            severity:    2,
            explanation: 'E-5/TEM zone under peak congestion. Dedicated Metrobus lane preferred.'
        },
        {
            premises:    ['isHighDelay'],
            conclusion:  'CONSIDER_ALTERNATIVE_MODE',
            severity:    2,
            explanation: 'Delay probability > 60 %. Switching transport mode may save significant time.'
        },
        {
            premises:    ['isAccident', 'isRain'],
            conclusion:  'INCIDENT_RISK_AMPLIFIED',
            severity:    3,
            explanation: 'Wet roads + existing accident → secondary incident probability elevated.'
        },
        {
            premises:    ['isLongRoute', 'isHighDelay'],
            conclusion:  'MULTI_ZONE_DELAY_LIKELY',
            severity:    2,
            explanation: 'Route > 15 km with high baseline delay crosses multiple congestion zones.'
        },
        {
            premises:    ['isNormal'],
            conclusion:  'LOW_RISK_PROCEED',
            severity:    1,
            explanation: 'No significant incidents detected. Normal traffic conditions.'
        }
    ];

    /**
     * runLogicEngine
     * --------------
     * Evaluates all rules against the current route context and
     * returns fired conclusions with their explanations.
     *
     * @param {{ activeFactorKeys: string[], delayPercent: number }} ctx
     * @returns {{ conclusions: {conclusion:string, severity:number, explanation:string}[], maxSeverity: number }}
     */
    function runLogicEngine(ctx) {
        // Build the set of atomic facts from context
        const facts = new Set();

        ctx.activeFactorKeys.forEach(k => {
            if (k === 'accident')         facts.add('isAccident');
            if (k === 'rain')             facts.add('isRain');
            if (k === 'roadwork')         facts.add('isRoadwork');
            if (k === 'breakdown')        facts.add('isBreakdown');
            if (k === 'peakHour')         facts.add('isPeakHour');
            if (k === 'intercontinental') facts.add('isIntercontinental');
            if (k === 'westSide')         facts.add('isWestSide');
            if (k === 'longRoute')        facts.add('isLongRoute');
            if (k === 'normal')           facts.add('isNormal');
        });

        if (ctx.delayPercent >= 60) facts.add('isHighDelay');

        // Forward chaining — fire all rules whose premises are satisfied
        const conclusions = [];
        LOGIC_RULES.forEach(rule => {
            const premisesSatisfied = rule.premises.every(p => facts.has(p));
            if (premisesSatisfied) {
                conclusions.push({
                    conclusion:  rule.conclusion,
                    severity:    rule.severity,
                    explanation: rule.explanation
                });
            }
        });

        const maxSeverity = conclusions.reduce((m, c) => Math.max(m, c.severity), 0);
        return { conclusions, maxSeverity };
    }

    // ============================================================
    //  SECTION 4 — COMBINED MODEL  (public entry point)
    // ============================================================
    //
    //  Merges the three pillars into a single result that app.js
    //  can consume to enrich the AI decision panel.
    //
    //  Combined delay score (α-blend):
    //    final_score = α × P_union  +  (1−α) × (w·x / ‖w‖₁)
    //  where α = 0.70 (probability layer weighted higher because
    //  it incorporates the stochastic noise term).
    // ============================================================

    const ALPHA = 0.70;                           // blend weight for probability layer
    const W_L1  = WEIGHT_VECTOR.reduce((a, v) => a + v, 0); // L1 norm of w (for normalisation)

    /**
     * computeFullModel
     * ----------------
     * Master function called by app.js after route context is built.
     *
     * @param {{
     *   activeFactorKeys : string[],
     *   baseTimeMin      : number,
     *   routeVectors     : Float64Array[]   // one per suggested route
     * }} ctx
     *
     * @returns {{
     *   featureVector    : Float64Array,
     *   l2Risk           : number,           // ‖x‖₂  — risk magnitude
     *   linearScore      : number,           // w·x normalised to [0,1]
     *   probabilityResult: { prob, meanProb, sigmaProb },
     *   delayStats       : { E, sigma, ciLow, ciHigh, prob },
     *   routeRankScores  : Float64Array,     // score per route (lower = better)
     *   logicResult      : { conclusions[], maxSeverity },
     *   finalDelayPct    : number,           // 0–100 blended estimate
     *   summaryLines     : string[]          // human-readable report
     * }}
     */
    function computeFullModel(ctx) {
        const { activeFactorKeys, baseTimeMin, routeVectors = [] } = ctx;

        // ── 1. Linear algebra ──────────────────────────────────
        const x           = buildFeatureVector(activeFactorKeys);
        const l2Risk      = l2Norm(x);
        const rawDot      = dotProduct(WEIGHT_VECTOR, x);
        const linearScore = W_L1 > 0 ? rawDot / W_L1 : 0; // normalise to [0,1]

        // Multi-route scoring (if route vectors provided)
        const routeRankScores = routeVectors.length > 0
            ? routeScoreMatrix(routeVectors)
            : new Float64Array(0);

        // ── 2. Probability layer ───────────────────────────────
        const probabilityResult = probabilityUnion(activeFactorKeys);
        const delayStats        = expectedDelay(baseTimeMin, activeFactorKeys);

        // ── 3. Logic engine ────────────────────────────────────
        const logicResult = runLogicEngine({
            activeFactorKeys,
            delayPercent: Math.round(probabilityResult.prob * 100)
        });

        // ── 4. Blended final score ─────────────────────────────
        //  final = α × P_union  +  (1−α) × linearScore
        const blended      = ALPHA * probabilityResult.prob + (1 - ALPHA) * linearScore;
        const finalDelayPct = Math.min(100, Math.round(blended * 100));

        // ── 5. Human-readable summary lines ───────────────────
        const summaryLines = [
            `[LINEAR ALGEBRA]  Feature vector: x ∈ ℝ⁹, ‖x‖₂ = ${l2Risk.toFixed(3)}`,
            `[LINEAR ALGEBRA]  Weighted score (w·x): ${rawDot.toFixed(3)} → normalised: ${(linearScore * 100).toFixed(1)}%`,
            `[PROBABILITY]     P(delay) = 1 − ∏(1−pᵢ) = ${(probabilityResult.prob * 100).toFixed(1)}%`,
            `[PROBABILITY]     E[D] = ${delayStats.E} min  |  σ[D] = ${delayStats.sigma} min`,
            `[PROBABILITY]     95% CI → [${delayStats.ciLow}, ${delayStats.ciHigh}] min`,
            `[BLENDED MODEL]   Final delay estimate: ${finalDelayPct}%  (α=${ALPHA} probability, ${(1 - ALPHA)} linear)`,
            ...logicResult.conclusions.map(c =>
                `[LOGIC Modus P.]  ${c.conclusion}: ${c.explanation}`
            )
        ];

        return {
            featureVector:     x,
            l2Risk:            Math.round(l2Risk * 1000) / 1000,
            linearScore:       Math.round(linearScore * 1000) / 1000,
            probabilityResult,
            delayStats,
            routeRankScores,
            logicResult,
            finalDelayPct,
            summaryLines
        };
    }

    // ============================================================
    //  PUBLIC API
    // ============================================================

    window.MathModel = {
        // Constants (read-only access for app.js)
        FACTOR_KEYS,
        FACTOR_INDEX,
        DELAY_PARAMS,
        WEIGHT_VECTOR,

        // Linear algebra
        buildFeatureVector,
        dotProduct,
        l2Norm,
        routeScoreMatrix,

        // Probability
        probabilityUnion,
        expectedDelay,

        // Logic
        runLogicEngine,

        // Master function
        computeFullModel
    };

    console.info('[MathModel] Module loaded — COE017 Mathematical Modeler');
    console.table(
        FACTOR_KEYS.map(k => ({
            factor:   k,
            weight_w: (WEIGHT_VECTOR[FACTOR_INDEX[k]]).toFixed(4),
            base_p:   DELAY_PARAMS[k].base,
            sigma:    DELAY_PARAMS[k].variance
        }))
    );

})();
