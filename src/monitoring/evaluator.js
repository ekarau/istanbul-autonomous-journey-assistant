// ================================================================
//  evaluator.js  —  Evaluation Specialist Module
//  COE017 Principles of AI  |  Istanbul Autonomous Journey Asst.
//  Role: Evaluation Specialist
// ================================================================
//
//  Goal: empirically compare any registered optimizer against the
//  greedy baseline on a population of synthetic Istanbul scenarios.
//
//  Methodology (mirrors tests/optimizer_benchmark.html, but as a
//  reusable library so the same numbers can drive both the offline
//  HTML harness and the live in-app metrics panel):
//
//    1. Build N seeded scenarios. Each scenario is a small menu of
//       candidate factor-subsets (≈ candidate routes) plus a base
//       travel time in minutes.
//    2. Ask every optimizer to pick the cheapest candidate under
//          cost(x) = E[D](x)  +  λ · ‖feature(x)‖₂
//       (delay minutes + risk magnitude penalty — single source of
//        truth, identical to the benchmark page).
//    3. Aggregate per optimizer:
//          meanDelay, stdDelay     (minutes, on the chosen route)
//          meanCost,  stdCost      (cost function value)
//          winRate                 (fraction of scenarios won)
//          improvementPct          (% delay reduction vs greedy)
//          avgIters                (search effort)
//
//  The greedy baseline is *always* registered, so this module is
//  fully usable BEFORE the Optimization Specialist's SA / GA module
//  exists. As soon as window.Optimizers.<name> is defined, it is
//  picked up automatically and compared.
//
//  Public API:  window.Evaluator
//    .run({ N, lambda, seed })          → results[]
//    .ALL_FACTORS                       → factor key list
//    .greedyBaseline(scenario)          → reference optimizer
//    .costOf(scenario, factorSet, λ)    → scalar
//    .generateScenario(rng)             → scenario object
// ================================================================

(function () {
    'use strict';

    if (typeof window.MathModel === 'undefined') {
        console.warn('[Evaluator] MathModel not loaded yet — evaluator will fail when run.');
    }

    // ── Factor universe (must match MathModel.FACTOR_KEYS) ─────────
    const ALL_FACTORS = [
        'accident', 'rain', 'roadwork', 'breakdown',
        'peakHour', 'intercontinental', 'westSide', 'longRoute', 'normal'
    ];

    // ── Reference greedy baseline ──────────────────────────────────
    // Picks the candidate factor-set with the lowest raw E[D].
    // Intentionally context-free: it ignores λ, so it is a fair
    // "do-nothing-clever" anchor for any smarter optimizer.
    function greedyBaseline(scenario) {
        let best = null;
        let bestCost = Infinity;
        scenario.candidateFactorSets.forEach(set => {
            const e = window.MathModel.expectedDelay(scenario.baseTimeMin, set).E;
            if (e < bestCost) { bestCost = e; best = set; }
        });
        return { chosenFactorSet: best, iterations: scenario.candidateFactorSets.length };
    }

    // ── Cost function (single source of truth) ────────────────────
    //   cost = E[D]  +  λ · ‖x‖₂
    function costOf(scenario, factorSet, lambda) {
        const e    = window.MathModel.expectedDelay(scenario.baseTimeMin, factorSet).E;
        const norm = window.MathModel.l2Norm(window.MathModel.buildFeatureVector(factorSet));
        return e + lambda * norm;
    }

    // ── Mulberry32 — deterministic, reproducible PRNG ─────────────
    function seeded(seed) {
        return function () {
            seed = (seed + 0x6D2B79F5) | 0;
            let t = seed;
            t = Math.imul(t ^ (t >>> 15), t | 1);
            t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    // ── Scenario generation ────────────────────────────────────────
    //   baseTimeMin  : 20–80 minute trip
    //   k candidates : 3–6 alternative factor-subsets per scenario
    //   each subset  : 1–4 randomly chosen factors
    function randomFactorSubset(rng) {
        const n = 1 + Math.floor(rng() * 4);
        const pool = ALL_FACTORS.slice();
        const out = [];
        for (let i = 0; i < n && pool.length; i++) {
            const idx = Math.floor(rng() * pool.length);
            out.push(pool.splice(idx, 1)[0]);
        }
        return out;
    }

    function generateScenario(rng) {
        const baseTimeMin = 20 + Math.floor(rng() * 60);
        const k           = 3 + Math.floor(rng() * 4);
        const candidateFactorSets = [];
        for (let i = 0; i < k; i++) candidateFactorSets.push(randomFactorSubset(rng));
        return { baseTimeMin, candidateFactorSets };
    }

    // ── Aggregate helper ──────────────────────────────────────────
    function meanStd(arr) {
        if (arr.length === 0) return { mean: 0, std: 0 };
        const mean = arr.reduce((s, v) => s + v, 0) / arr.length;
        const variance = arr.reduce((s, v) => s + (v - mean) ** 2, 0) / arr.length;
        return { mean, std: Math.sqrt(variance) };
    }

    // ── Main runner ───────────────────────────────────────────────
    /**
     * run
     * ---
     * Runs every registered optimizer plus the greedy baseline over
     * N seeded scenarios and returns ranked statistics.
     *
     * @param {{N?:number, lambda?:number, seed?:number}} opts
     * @returns {{
     *   name:string, meanCost:number, stdCost:number,
     *   meanDelay:number, stdDelay:number,
     *   wins:number, winRate:number, avgIters:number,
     *   improvementPct:number   // vs greedy baseline (delay)
     * }[]}
     */
    function run(opts) {
        const N      = (opts && opts.N)      || 50;
        const lambda = (opts && opts.lambda !== undefined) ? opts.lambda : 2.0;
        const seed   = (opts && opts.seed)   || 42;

        const rng       = seeded(seed);
        const scenarios = Array.from({ length: N }, () => generateScenario(rng));

        const optimizers = Object.assign(
            { greedyBaseline },
            (typeof window.Optimizers === 'object' && window.Optimizers) || {}
        );

        const stats = {};
        Object.keys(optimizers).forEach(name => {
            stats[name] = { costs: [], delays: [], wins: 0, iters: 0 };
        });

        scenarios.forEach(sc => {
            const trial = {};
            Object.keys(optimizers).forEach(name => {
                const res   = optimizers[name](sc);
                const set   = res.chosenFactorSet || [];
                const delay = window.MathModel.expectedDelay(sc.baseTimeMin, set).E;
                const cost  = costOf(sc, set, lambda);
                stats[name].costs .push(cost);
                stats[name].delays.push(delay);
                stats[name].iters += (res.iterations || 0);
                trial[name] = cost;
            });
            const winner = Object.keys(trial).reduce((a, b) => trial[a] <= trial[b] ? a : b);
            stats[winner].wins += 1;
        });

        const baselineDelay = meanStd(stats.greedyBaseline.delays).mean;

        return Object.keys(stats).map(name => {
            const c = meanStd(stats[name].costs);
            const d = meanStd(stats[name].delays);
            const improvement = name === 'greedyBaseline'
                ? 0
                : (baselineDelay > 0 ? (baselineDelay - d.mean) / baselineDelay * 100 : 0);
            return {
                name,
                meanCost:       c.mean,
                stdCost:        c.std,
                meanDelay:      d.mean,
                stdDelay:       d.std,
                wins:           stats[name].wins,
                winRate:        stats[name].wins / N,
                avgIters:       stats[name].iters / N,
                improvementPct: improvement
            };
        }).sort((a, b) => a.meanCost - b.meanCost);
    }

    // ── Public API ────────────────────────────────────────────────
    window.Evaluator = {
        run,
        ALL_FACTORS,
        greedyBaseline,
        costOf,
        generateScenario,
        seeded
    };

    console.info('[Evaluator] Module loaded — COE017 Evaluation Specialist');
})();
