// ================================================================
//  baseline_greedy.js  —  Greedy Baseline Module
//  COE017 Principles of AI  |  Istanbul Autonomous Journey Asst.
//  Role: Evaluation & Optimization Specialist
// ================================================================
//
//  PURPOSE: Benchmark comparator for Hill Climbing & SA.
//  Strategy: At each decision step, greedily select the route
//  segment with the lowest expected delay E[D].
//
//  This is NOT an optimal algorithm — it is intentionally naive.
//  Its RMSE and accuracy scores define the performance floor
//  that Hill Climbing and Simulated Annealing must beat.
//
//  Public API:  window.GreedyBaseline
//    .run(routes)       → { chosen, score, allScores[] }
//    .benchmark(routes) → { greedy, hillClimbing, comparison }
// ================================================================

(function () {
    'use strict';

    // ============================================================
    //  GREEDY SELECTION
    //  For each candidate route, compute E[D] via MathModel and
    //  immediately pick the one with the lowest expected delay.
    //  No lookahead, no iteration — single-pass selection.
    // ============================================================

    /**
     * run
     * ---
     * Greedy route selection: picks the route with minimum E[D].
     *
     * @param {Array<{ name: string, activeKeys: string[], baseTimeMin: number }>} routes
     * @returns {{ chosen: object, chosenIndex: number, allScores: object[] }}
     */
    function run(routes) {
        if (!routes || routes.length === 0) {
            console.warn('[GreedyBaseline] No routes provided.');
            return null;
        }

        const allScores = routes.map((route, idx) => {
            const delay = MathModel.expectedDelay(
                route.baseTimeMin,
                route.activeKeys
            );
            return {
                index:      idx,
                name:       route.name || `Route ${idx + 1}`,
                activeKeys: route.activeKeys,
                baseTime:   route.baseTimeMin,
                expectedDelay: delay.E,          // E[D] in minutes
                delayPct:   MathModel.probabilityUnion(route.activeKeys).prob * 100
            };
        });

        // Greedy choice: minimum expected delay
        const chosen = allScores.reduce((best, cur) =>
            cur.expectedDelay < best.expectedDelay ? cur : best
        );

        console.info(
            `[GreedyBaseline] Chosen: ${chosen.name} | E[D] = ${chosen.expectedDelay} min`
        );

        return { chosen, chosenIndex: chosen.index, allScores };
    }

    // ============================================================
    //  BENCHMARK
    //  Compare Greedy vs Hill Climbing accuracy on TEST_SCENARIOS.
    //  Shows why optimization improves over the naive baseline.
    // ============================================================

    /**
     * benchmark
     * ---------
     * Runs Greedy and Hill Climbing on the same test scenarios
     * and compares their RMSE scores side by side.
     *
     * @returns {{ greedyRmse, optimizedRmse, improvement, table[] }}
     */
    function benchmark() {
        if (!window.Optimizer) {
            console.warn('[GreedyBaseline] Optimizer module not loaded.');
            return null;
        }

        const scenarios = Optimizer.TEST_SCENARIOS;

        // Greedy: predict using raw (unoptimized) weight vector
        const baseW = MathModel.WEIGHT_VECTOR;
        let greedySumSq = 0;

        const table = scenarios.map(sc => {
            const delay   = MathModel.expectedDelay(sc.baseTimeMin, sc.activeKeys);
            const prob    = MathModel.probabilityUnion(sc.activeKeys).prob;
            // Greedy uses raw prob * 100 as its "prediction"
            const greedyPred = Math.min(100, prob * 100);
            const greedyErr  = greedyPred - sc.groundTruth;
            greedySumSq += greedyErr * greedyErr;

            return {
                id:          sc.id,
                groundTruth: sc.groundTruth,
                greedyPred:  Math.round(greedyPred * 10) / 10,
                greedyError: Math.round(greedyErr * 10) / 10
            };
        });

        const greedyRmse = Math.sqrt(greedySumSq / scenarios.length);

        // Hill Climbing result (run if not already done)
        const hcResult = Optimizer.getLastResult() || Optimizer.runHillClimbing();

        const improvement = greedyRmse > 0
            ? ((greedyRmse - hcResult.optimizedRmse) / greedyRmse) * 100
            : 0;

        const result = {
            greedyRmse:    Math.round(greedyRmse * 1000) / 1000,
            optimizedRmse: hcResult.optimizedRmse,
            improvement:   Math.round(improvement * 10) / 10,
            table
        };

        console.group('[GreedyBaseline] Benchmark — Greedy vs Hill Climbing');
        console.info(`Greedy RMSE    : ${result.greedyRmse}`);
        console.info(`Optimized RMSE : ${result.optimizedRmse}`);
        console.info(`Improvement    : ${result.improvement}%`);
        console.table(table);
        console.groupEnd();

        return result;
    }

    // ============================================================
    //  PUBLIC API
    // ============================================================

    window.GreedyBaseline = { run, benchmark };

    console.info('[GreedyBaseline] Module loaded — COE017 Evaluation & Optimization Specialist');

})();
