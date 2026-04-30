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

    // ── λ-aware greedy ─────────────────────────────────────────────
    // Same enumerative strategy as greedyBaseline, but scores each
    // candidate with the *full* evaluator cost function:
    //     cost = E[D] + λ · ‖x‖₂
    // i.e. it actually pays the L2 risk penalty. With λ=0 it
    // collapses onto greedyBaseline; as λ grows it diverges and
    // starts preferring smaller (less-risky) factor sets.
    function lambdaGreedy(scenario, lambda) {
        const lam = (lambda === undefined) ? 20.0 : lambda;
        let best = null;
        let bestCost = Infinity;
        scenario.candidateFactorSets.forEach(set => {
            const c = costOf(scenario, set, lam);
            if (c < bestCost) { bestCost = c; best = set; }
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

    // ── Calibrated tradeoff tiers (shared) ─────────────────────────
    //  Goal: argmin(E[D]) ≠ argmin(E[D] + λ·‖x‖₂) on a meaningful
    //  fraction of scenarios, otherwise Greedy and lambdaGreedy
    //  always agree → benchmark is uninformative (33/33/33 ties).
    //
    //  Design (single dense + graduated sparse alternatives):
    //
    //    DENSE      = ['normal','breakdown']   → P=0.159, ‖x‖₂=√2
    //                  Greedy's choice in non-trivial scenarios:
    //                  lowest E[D] across the whole candidate set.
    //
    //    SPARSE_1‥4 = single-factor candidates with monotonically
    //                  increasing P, so lambdaGreedy progressively
    //                  flips to the cheapest unit-norm candidate as
    //                  λ grows. Flip condition (T_base ≈ 50 min):
    //                       λ · (√2 − 1)  >  T · (P_sparse − P_dense)
    //
    //  Flip thresholds (at T = 50 min, P_dense = 0.159):
    //    rain             P=0.18    → λ ≳  2.5    EASY
    //    roadwork         P=0.22    → λ ≳  7.4    MEDIUM
    //    peakHour         P=0.333   → λ ≳ 21      HARD
    //    intercontinental P=0.418   → λ ≳ 31      VERY HARD
    //
    //  Real probabilities (MathModel.DELAY_PARAMS base means):
    //    normal=0.022  breakdown=0.14  rain=0.18  roadwork=0.22
    //    longRoute=0.272  peakHour=0.333  westSide=0.343
    //    accident=0.350  intercontinental=0.418
    //
    //  An earlier version stacked three "tier pairs" but they all
    //  competed simultaneously: Tier C's ['normal','breakdown'] dense
    //  dominated Tier A/B's denses → the *only* relevant flip was
    //  Tier C's, pushing every flip threshold to λ ≳ 25 and yielding
    //  the same 33/33/33 ties at λ = 20.
    //
    //  Used by BOTH generateScenario AND generateGeoScenario, because
    //  geo's 4 route candidates are nested subsets (transit ⊂ direct)
    //  → min-E[D] is automatically min-‖x‖₂ → no flip possible without
    //  these injected candidates. ────────────────────────────────────
    function appendTradeoffTiers(candidateFactorSets) {
        candidateFactorSets.push(['normal', 'breakdown']);   // dense  — P=0.159, ‖x‖=√2
        candidateFactorSets.push(['rain']);                  // sparse — flip @ λ≳2.5
        candidateFactorSets.push(['roadwork']);              // sparse — flip @ λ≳7
        candidateFactorSets.push(['peakHour']);              // sparse — flip @ λ≳21
        candidateFactorSets.push(['intercontinental']);      // sparse — flip @ λ≳31
    }

    function generateScenario(rng) {
        const baseTimeMin = 20 + Math.floor(rng() * 60);
        const k           = 3 + Math.floor(rng() * 4);
        const candidateFactorSets = [];
        for (let i = 0; i < k; i++) candidateFactorSets.push(randomFactorSubset(rng));

        appendTradeoffTiers(candidateFactorSets);

        return { baseTimeMin, candidateFactorSets };
    }

    // ── Geographic scenario generator ─────────────────────────────
    // Picks random Istanbul origin / destination pairs inside a
    // realistic bounding box, derives geographic flags the same way
    // agent.js does (intercontinental, westSide, longRoute), and
    // turns them into candidate factor-subsets that *mean* something:
    //
    //   candidate 0 — direct surface route (all geo + env factors)
    //   candidate 1 — detour around the west-side congestion zone
    //   candidate 2 — public transit (absorbs road-incident factors)
    //   candidate 3 — Marmaray-like rail (also bypasses Bosphorus crossing)
    //
    // Optional environmental factors (peakHour, rain, accident, …)
    // fire stochastically with calibrated frequencies, so the
    // benchmark population mirrors a realistic Istanbul day.
    const ISTANBUL_BBOX = { latMin: 40.94, latMax: 41.20, lonMin: 28.65, lonMax: 29.30 };

    function haversineKm(aLat, aLon, bLat, bLon) {
        const R = 6371;
        const dLat = (bLat - aLat) * Math.PI / 180;
        const dLon = (bLon - aLon) * Math.PI / 180;
        const s1 = Math.sin(dLat / 2);
        const s2 = Math.sin(dLon / 2);
        const a = s1 * s1 + Math.cos(aLat * Math.PI / 180) * Math.cos(bLat * Math.PI / 180) * s2 * s2;
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }

    function randomIstanbulPoint(rng) {
        return {
            lat: ISTANBUL_BBOX.latMin + rng() * (ISTANBUL_BBOX.latMax - ISTANBUL_BBOX.latMin),
            lon: ISTANBUL_BBOX.lonMin + rng() * (ISTANBUL_BBOX.lonMax - ISTANBUL_BBOX.lonMin)
        };
    }

    function generateGeoScenario(rng) {
        let origin, dest, distance;
        // Reject pairs that are absurdly close (< 1 km) — uninteresting.
        do {
            origin   = randomIstanbulPoint(rng);
            dest     = randomIstanbulPoint(rng);
            distance = haversineKm(origin.lat, origin.lon, dest.lat, dest.lon);
        } while (distance < 1);

        const isIntercontinental =
            (origin.lon < 29.0 && dest.lon > 29.0) || (origin.lon > 29.0 && dest.lon < 29.0);
        const isWestSide = origin.lon < 28.8 && dest.lon < 28.9;
        const isLong     = distance > 15;

        // Build the geographic + environmental factor set.
        const baseFactors = [];
        if (isIntercontinental) baseFactors.push('intercontinental');
        if (isWestSide)         baseFactors.push('westSide');
        if (isLong)             baseFactors.push('longRoute');
        if (rng() < 0.40)       baseFactors.push('peakHour');     // ~40% chance peak
        if (rng() < 0.18)       baseFactors.push('rain');         // ~18% chance rain
        if (rng() < 0.12)       baseFactors.push('accident');     // ~12% on-route accident
        if (rng() < 0.10)       baseFactors.push('roadwork');
        if (rng() < 0.07)       baseFactors.push('breakdown');
        if (baseFactors.length === 0) baseFactors.push('normal');

        const ROAD_INCIDENTS = ['accident', 'breakdown', 'roadwork', 'westSide'];

        const candidateFactorSets = [
            baseFactors.slice(),                                                                  // direct surface
            baseFactors.filter(k => k !== 'westSide'),                                            // detour west
            baseFactors.filter(k => !ROAD_INCIDENTS.includes(k)),                                 // transit
            baseFactors.filter(k => !ROAD_INCIDENTS.includes(k) && k !== 'intercontinental')      // Marmaray-like
        ].filter(set => set.length > 0);

        // Inject calibrated tradeoff tiers — without these the four
        // route narratives above are nested subsets (Marmaray ⊂ transit
        // ⊂ direct), so argmin(E[D]) coincides with argmin(‖x‖₂) and
        // Greedy / lambdaGreedy / SA cannot disagree → 33/33/33 ties.
        appendTradeoffTiers(candidateFactorSets);

        // Empty filters can collapse identical sets — dedupe.
        const seen = new Set();
        const unique = candidateFactorSets.filter(set => {
            const key = set.slice().sort().join('|');
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });

        const baseTimeMin = Math.round((distance / 25) * 60 + 10);

        return {
            baseTimeMin,
            candidateFactorSets: unique,
            meta: { origin, dest, distance, isIntercontinental, isWestSide, isLong }
        };
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
     * @param {{
     *   N?:number,
     *   lambda?:number,
     *   seed?:number,
     *   scenarioType?: 'synthetic' | 'geo',  // default: 'synthetic'
     *   generator?: (rng:Function) => object  // overrides scenarioType
     * }} opts
     * @returns {{
     *   name:string, meanCost:number, stdCost:number,
     *   meanDelay:number, stdDelay:number,
     *   wins:number, winRate:number, avgIters:number,
     *   improvementPct:number   // vs greedy baseline (delay)
     * }[]}
     */
    function run(opts) {
        const N      = (opts && opts.N)      || 50;
        // Default λ = 20 matches the UI slider default. With the
        // calibrated tradeoff tiers, this lands between Tier B's flip
        // threshold (~10) and Tier C's (~25) — i.e. lambdaGreedy wins
        // some pairs outright while Greedy still wins others, giving a
        // visibly differentiated benchmark instead of 33/33/33 ties.
        const lambda = (opts && opts.lambda !== undefined) ? opts.lambda : 20.0;
        const seed   = (opts && opts.seed)   || 42;

        const generator = (opts && typeof opts.generator === 'function') ? opts.generator
                       : (opts && opts.scenarioType === 'geo')           ? generateGeoScenario
                       : generateScenario;

        const rng       = seeded(seed);
        const scenarios = Array.from({ length: N }, () => generator(rng));

        const optimizers = Object.assign(
            { greedyBaseline },
            { lambdaGreedy: (sc) => lambdaGreedy(sc, lambda) },
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
            // Fair tiebreak: every optimizer that hits the minimum cost
            // (within an ε tolerance) shares the win equally. With a
            // strict `<=` reduce, all ties were silently awarded to the
            // first key (greedyBaseline), making smarter optimizers
            // unable to score on identical picks.
            const eps    = 1e-9;
            const minC   = Math.min(...Object.values(trial));
            const winners = Object.keys(trial).filter(k => trial[k] - minC <= eps);
            const share  = 1 / winners.length;
            winners.forEach(k => { stats[k].wins += share; });
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

    // ── Adapter: register Optimization Specialist's SA into the
    //    benchmark so the side-panel "Run" compares Greedy vs SA.
    //
    //    Heuristic mapping from factor sets → distance / transfer
    //    proxies, so SA's cost function (α·E[D] + β·dist + γ·tr −
    //    δ·conf) actually has discriminating signal beyond E[D].
    //    Without this, every candidate has identical dist+transfers
    //    and SA collapses to the same ranking as Greedy. ────────
    function _adapterRouteFromSet(set, scenario) {
        const baseDist = (scenario.meta && scenario.meta.distance) || 30;
        const isTransitLike = !set.some(k =>
            k === 'accident' || k === 'breakdown' || k === 'roadwork');
        const isMarmarayLike = isTransitLike && !set.includes('intercontinental');

        // Surface routes longer when there's a westSide detour or
        // intercontinental crossing; transit shaves distance, Marmaray
        // takes a slight detour but with no transfers.
        let distanceKm = baseDist;
        if (set.includes('longRoute'))       distanceKm *= 1.10;
        if (set.includes('westSide'))        distanceKm *= 1.08;
        if (isTransitLike)                   distanceKm *= 0.95;
        if (isMarmarayLike)                  distanceKm *= 1.05;

        // Stronger transfer penalty so SA's β·tr term actually
        // discriminates between candidates instead of collapsing to the
        // same ranking as Greedy. With 0/1/2 the transfer signal was
        // dominated by E[D]; bumped to 0/2/4 to give SA real leverage.
        const transferCount = isMarmarayLike ? 2
                            : isTransitLike  ? 4
                            : 0;

        return {
            activeKeys:    set.length ? set : ['normal'],
            baseTimeMin:   scenario.baseTimeMin,
            distanceKm,
            transferCount
        };
    }

    if (window.SimulatedAnnealing && typeof window.SimulatedAnnealing.run === 'function') {
        window.Optimizers = window.Optimizers || {};
        window.Optimizers.simulatedAnnealing = function (scenario) {
            const sets = scenario.candidateFactorSets || [];
            if (sets.length === 0) return { chosenFactorSet: [], iterations: 0 };
            if (sets.length === 1) return { chosenFactorSet: sets[0], iterations: 0 };

            const routes = sets.map((set, i) => Object.assign(
                { name: 'cand' + i },
                _adapterRouteFromSet(set, scenario)
            ));

            const r = window.SimulatedAnnealing.run(routes);
            if (!r) return { chosenFactorSet: sets[0], iterations: 0 };
            const idx = parseInt(String(r.bestRoute.name).replace('cand', ''), 10);
            return {
                chosenFactorSet: sets[Number.isFinite(idx) ? idx : 0],
                iterations:      r.iterations || 0
            };
        };
        console.info('[Evaluator] Registered SA adapter → window.Optimizers.simulatedAnnealing');
    }

    // ── Public API ────────────────────────────────────────────────
    window.Evaluator = {
        run,
        ALL_FACTORS,
        greedyBaseline,
        lambdaGreedy,
        costOf,
        generateScenario,
        generateGeoScenario,
        seeded
    };

    console.info('[Evaluator] Module loaded — COE017 Evaluation Specialist');
})();
