// ================================================================
//  optimizer.js  —  Evaluation & Optimization Specialist Module
//  COE017 Principles of AI  |  Istanbul Autonomous Journey Asst.
//  Role: Evaluation & Optimization Specialist
// ================================================================
//
//  This module implements two responsibilities:
//
//  A. EVALUATION
//     Measures how accurately MathModel predicts real-world delay.
//     Metric: Root Mean Squared Error (RMSE) over a test scenario set.
//       RMSE = √[ (1/N) Σᵢ (ŷᵢ − yᵢ)² ]
//     where ŷᵢ = model prediction (%), yᵢ = ground-truth delay (%).
//
//  B. OPTIMIZATION — HILL CLIMBING
//     The weight vector w ∈ ℝ⁹ in MathModel is currently derived
//     from raw IBB base probabilities (fixed). Hill Climbing finds
//     a better w that minimises RMSE on the test set.
//
//     Algorithm (steepest-ascent / gradient-free):
//       1. Start: w₀ = MathModel.WEIGHT_VECTOR  (current baseline)
//       2. For each iteration t:
//            For each dimension i ∈ {0,…,8}:
//              Try w⁺ = w with w[i] += stepSize
//              Try w⁻ = w with w[i] -= stepSize  (clamped to [0,1])
//              If RMSE(w⁺) < RMSE(w): w ← w⁺  (keep improvement)
//              Else if RMSE(w⁻) < RMSE(w): w ← w⁻
//       3. After each full pass, decay stepSize × STEP_DECAY
//       4. Stop when stepSize < MIN_STEP or MAX_ITER reached
//
//  NOTE TO DATA & SIMULATION ENGINEER:
//     The TEST_SCENARIOS array below contains baseline hardcoded
//     scenarios derived from IBB data patterns. Please expand this
//     array with your simulation outputs. Each scenario must follow
//     the schema defined in the SCENARIO FORMAT section below.
//
//  NOTE TO INTEGRATION ENGINEER:
//     See INTEGRATION section at the bottom of this file.
//
//  Public API:  window.Optimizer
//    .runHillClimbing()            → OptimizerResult
//    .evaluateWeights(w)           → { rmse, accuracy, perScenario[] }
//    .getOptimizedWeights()        → Float64Array | null
//    .appendOptimizerPanel()       → void  (call after appendMathPanel)
//    .getReport()                  → string[]  (human-readable lines)
// ================================================================

(function () {
    'use strict';

    // ============================================================
    //  SCENARIO FORMAT
    //  Each test scenario represents a known traffic situation with
    //  a recorded ground-truth delay percentage from IBB data.
    //
    //  {
    //    id          : string            — unique label
    //    activeKeys  : string[]          — active factor keys
    //    baseTimeMin : number            — base journey time (min)
    //    groundTruth : number            — real delay % (0–100)
    //    source      : string            — data source note
    //  }
    // ============================================================

    // ============================================================
    //  TEST SCENARIOS
    //  ⚠️  DATA & SIMULATION ENGINEER:
    //  Append your simulation scenarios to this array.
    //  Keep groundTruth values as realistic IBB-derived percentages.
    // ============================================================
    const TEST_SCENARIOS = [
        // ── Normal / baseline ────────────────────────────────────
        {
            id: 'S01_normal_offpeak',
            activeKeys:   ['normal'],
            baseTimeMin:  30,
            groundTruth:  4,
            source: 'IBB baseline off-peak average'
        },
        {
            id: 'S02_normal_short',
            activeKeys:   ['normal'],
            baseTimeMin:  15,
            groundTruth:  3,
            source: 'IBB baseline short route'
        },
        // ── Peak hour ────────────────────────────────────────────
        {
            id: 'S03_peak_only',
            activeKeys:   ['peakHour'],
            baseTimeMin:  40,
            groundTruth:  33,
            source: 'IBB rush-hour congestion data'
        },
        {
            id: 'S04_peak_westside',
            activeKeys:   ['peakHour', 'westSide'],
            baseTimeMin:  45,
            groundTruth:  55,
            source: 'IBB E5/TEM morning congestion'
        },
        // ── Accident scenarios ───────────────────────────────────
        {
            id: 'S05_accident_only',
            activeKeys:   ['accident'],
            baseTimeMin:  35,
            groundTruth:  38,
            source: 'IBB accident impact log'
        },
        {
            id: 'S06_accident_peak',
            activeKeys:   ['accident', 'peakHour'],
            baseTimeMin:  40,
            groundTruth:  62,
            source: 'IBB peak-hour accident combined'
        },
        {
            id: 'S07_accident_bridge',
            activeKeys:   ['accident', 'intercontinental', 'peakHour'],
            baseTimeMin:  50,
            groundTruth:  78,
            source: 'IBB Bosphorus bridge incident'
        },
        // ── Rain scenarios ───────────────────────────────────────
        {
            id: 'S08_rain_only',
            activeKeys:   ['rain'],
            baseTimeMin:  30,
            groundTruth:  20,
            source: 'IBB rain-day speed reduction'
        },
        {
            id: 'S09_rain_peak',
            activeKeys:   ['rain', 'peakHour'],
            baseTimeMin:  40,
            groundTruth:  45,
            source: 'IBB wet peak-hour data'
        },
        // ── Road work ────────────────────────────────────────────
        {
            id: 'S10_roadwork_only',
            activeKeys:   ['roadwork'],
            baseTimeMin:  35,
            groundTruth:  24,
            source: 'IBB construction zone impact'
        },
        {
            id: 'S11_roadwork_peak',
            activeKeys:   ['roadwork', 'peakHour', 'westSide'],
            baseTimeMin:  45,
            groundTruth:  58,
            source: 'IBB TEM road work morning'
        },
        // ── Intercontinental / long routes ───────────────────────
        {
            id: 'S12_intercontinental_peak',
            activeKeys:   ['intercontinental', 'peakHour'],
            baseTimeMin:  60,
            groundTruth:  65,
            source: 'IBB bridge crossing peak data'
        },
        {
            id: 'S13_long_route_normal',
            activeKeys:   ['longRoute'],
            baseTimeMin:  55,
            groundTruth:  28,
            source: 'IBB outer-district long route'
        },
        // ── Breakdown ────────────────────────────────────────────
        {
            id: 'S14_breakdown_tunnel',
            activeKeys:   ['breakdown', 'intercontinental'],
            baseTimeMin:  45,
            groundTruth:  48,
            source: 'IBB undersea tunnel incident'
        },
        // ── Combined worst-case ──────────────────────────────────
        {
            id: 'S15_worst_case',
            activeKeys:   ['accident', 'rain', 'peakHour', 'intercontinental', 'westSide'],
            baseTimeMin:  60,
            groundTruth:  88,
            source: 'IBB extreme congestion composite'
        }

        // ── ⚠️  DATA & SIMULATION ENGINEER — ADD BELOW ──────────
        // Example format:
        // {
        //     id: 'S16_your_scenario',
        //     activeKeys:   ['peakHour', 'rain'],
        //     baseTimeMin:  30,
        //     groundTruth:  42,          // from your simulation output
        //     source: 'Simulation run #N — scenario description'
        // },
    ];

    // ============================================================
    //  HILL CLIMBING HYPERPARAMETERS
    // ============================================================
    const HC_CONFIG = {
        INITIAL_STEP : 0.08,    // starting perturbation magnitude
        STEP_DECAY   : 0.90,    // multiply step by this each pass
        MIN_STEP     : 0.0005,  // stop when step shrinks below this
        MAX_ITER     : 500,     // hard cap on iterations
        W_MIN        : 0.001,   // weight floor (avoid zeros)
        W_MAX        : 1.000,   // weight ceiling
        ALPHA        : 0.70     // must match math_model.js ALPHA
    };

    // ============================================================
    //  MODULE STATE
    // ============================================================
    let _optimizedWeights = null;   // set after runHillClimbing()
    let _lastResult       = null;   // full result object

    // ============================================================
    //  SECTION A — EVALUATION
    //  Core metric: RMSE and per-scenario accuracy.
    // ============================================================

    /**
     * predictWithWeights
     * ------------------
     * Replicates MathModel.computeFullModel's blended score
     * but accepts a custom weight vector (for optimisation loop).
     *
     * final = α × P_union + (1−α) × (w·x / ‖w‖₁)
     *
     * @param {Float64Array} w            — candidate weight vector
     * @param {string[]}     activeKeys   — active factor keys
     * @returns {number}  predicted delay % (0–100)
     */
    function predictWithWeights(w, activeKeys) {
        // Feature vector x ∈ {0,1}⁹
        const x = MathModel.buildFeatureVector(activeKeys);

        // Linear algebra score (normalised by L1-norm of w)
        const dot   = MathModel.dotProduct(w, x);
        const wL1   = w.reduce((a, v) => a + v, 0);
        const linScore = wL1 > 0 ? dot / wL1 : 0;

        // Probability union (independent of weights — stochastic layer)
        const { prob } = MathModel.probabilityUnion(activeKeys);

        // Blended estimate (mirrors math_model.js ALPHA blend)
        const blended = HC_CONFIG.ALPHA * prob + (1 - HC_CONFIG.ALPHA) * linScore;
        return Math.min(100, blended * 100);
    }

    /**
     * evaluateWeights
     * ---------------
     * Measures RMSE and per-scenario accuracy for a given weight
     * vector against the full TEST_SCENARIOS set.
     *
     * RMSE = √[ (1/N) Σᵢ (predicted_i − groundTruth_i)² ]
     * Accuracy per scenario: max(0, 100 − |error|)%
     *
     * @param {Float64Array} w
     * @returns {{ rmse: number, accuracy: number, perScenario: object[] }}
     */
    function evaluateWeights(w) {
        let sumSqErr = 0;
        const perScenario = TEST_SCENARIOS.map(sc => {
            const predicted = predictWithWeights(w, sc.activeKeys);
            const error     = predicted - sc.groundTruth;
            sumSqErr += error * error;
            return {
                id:          sc.id,
                groundTruth: sc.groundTruth,
                predicted:   Math.round(predicted * 10) / 10,
                error:       Math.round(error * 10) / 10,
                scenarioAcc: Math.max(0, 100 - Math.abs(error))
            };
        });

        const rmse     = Math.sqrt(sumSqErr / TEST_SCENARIOS.length);
        const accuracy = perScenario.reduce((s, r) => s + r.scenarioAcc, 0)
                         / perScenario.length;

        return {
            rmse:        Math.round(rmse * 1000) / 1000,
            accuracy:    Math.round(accuracy * 10) / 10,
            perScenario
        };
    }

    // ============================================================
    //  SECTION B — HILL CLIMBING OPTIMIZATION
    // ============================================================

    /**
     * runHillClimbing
     * ---------------
     * Optimises w ∈ ℝ⁹ to minimise RMSE over TEST_SCENARIOS.
     *
     * Steepest-ascent Hill Climbing with decaying step size:
     *   • Each iteration: try ±step on every dimension.
     *   • Accept a move only if it strictly reduces RMSE.
     *   • After each full dimensional sweep, multiply step × STEP_DECAY.
     *   • Stop when step < MIN_STEP or MAX_ITER exhausted.
     *
     * @returns {{
     *   baselineRmse   : number,
     *   optimizedRmse  : number,
     *   improvement    : number,   // RMSE reduction %
     *   iterations     : number,
     *   baselineAcc    : number,
     *   optimizedAcc   : number,
     *   optimizedW     : Float64Array,
     *   perScenarioBase: object[],
     *   perScenarioOpt : object[]
     * }}
     */
    function runHillClimbing() {
        // ── Baseline evaluation (current MathModel weights) ──────
        const w0             = new Float64Array(MathModel.WEIGHT_VECTOR);
        const baselineEval   = evaluateWeights(w0);

        // ── Initialise Hill Climber ───────────────────────────────
        let w        = new Float64Array(w0);         // working copy
        let bestRmse = baselineEval.rmse;
        let step     = HC_CONFIG.INITIAL_STEP;
        let iter     = 0;
        let improved = true;

        // ── Main loop ─────────────────────────────────────────────
        while (
            iter < HC_CONFIG.MAX_ITER &&
            step >= HC_CONFIG.MIN_STEP
        ) {
            improved = false;

            // Sweep every dimension
            for (let i = 0; i < w.length; i++) {
                const original = w[i];

                // Try +step
                w[i] = Math.min(HC_CONFIG.W_MAX, original + step);
                const rPlus = evaluateWeights(w).rmse;

                if (rPlus < bestRmse) {
                    bestRmse = rPlus;
                    improved = true;
                    continue;                   // keep w[i] at +step
                }

                // Try -step
                w[i] = Math.max(HC_CONFIG.W_MIN, original - step);
                const rMinus = evaluateWeights(w).rmse;

                if (rMinus < bestRmse) {
                    bestRmse = rMinus;
                    improved = true;
                    continue;                   // keep w[i] at -step
                }

                // No improvement — restore
                w[i] = original;
            }

            // Decay step size after each full dimensional pass
            step *= HC_CONFIG.STEP_DECAY;
            iter++;
        }

        // ── Final evaluation with optimised weights ───────────────
        const optimizedEval = evaluateWeights(w);
        const improvement   = baselineEval.rmse > 0
            ? ((baselineEval.rmse - optimizedEval.rmse) / baselineEval.rmse) * 100
            : 0;

        // ── Store results ─────────────────────────────────────────
        _optimizedWeights = w;
        _lastResult = {
            baselineRmse:    baselineEval.rmse,
            optimizedRmse:   optimizedEval.rmse,
            improvement:     Math.round(improvement * 10) / 10,
            iterations:      iter,
            stepFinal:       Math.round(step * 10000) / 10000,
            baselineAcc:     baselineEval.accuracy,
            optimizedAcc:    optimizedEval.accuracy,
            optimizedW:      w,
            perScenarioBase: baselineEval.perScenario,
            perScenarioOpt:  optimizedEval.perScenario,
            scenarioCount:   TEST_SCENARIOS.length
        };

        // ── Console report ────────────────────────────────────────
        console.group('[Optimizer] Hill Climbing — COE017 Evaluation & Optimization');
        console.info(`Scenarios evaluated : ${TEST_SCENARIOS.length}`);
        console.info(`Iterations ran      : ${iter}`);
        console.info(`Final step size     : ${_lastResult.stepFinal}`);
        console.info(`Baseline  RMSE      : ${baselineEval.rmse.toFixed(3)}`);
        console.info(`Optimized RMSE      : ${optimizedEval.rmse.toFixed(3)}`);
        console.info(`RMSE improvement    : ${_lastResult.improvement}%`);
        console.info(`Baseline  Accuracy  : ${baselineEval.accuracy.toFixed(1)}%`);
        console.info(`Optimized Accuracy  : ${optimizedEval.accuracy.toFixed(1)}%`);
        console.table(
            MathModel.FACTOR_KEYS.map((k, i) => ({
                factor:     k,
                w_baseline: w0[i].toFixed(4),
                w_optimized: w[i].toFixed(4),
                delta:      (w[i] - w0[i] >= 0 ? '+' : '') +
                            (w[i] - w0[i]).toFixed(4)
            }))
        );
        console.groupEnd();

        return _lastResult;
    }

    // ============================================================
    //  SECTION C — HUMAN-READABLE REPORT LINES
    // ============================================================

    function getReport() {
        if (!_lastResult) return ['[Optimizer] runHillClimbing() has not been called yet.'];
        const r = _lastResult;
        return [
            `[OPTIMIZER]  Algorithm: Hill Climbing (steepest-ascent, decaying step)`,
            `[OPTIMIZER]  Scenarios: ${r.scenarioCount} test cases`,
            `[OPTIMIZER]  Iterations: ${r.iterations}  |  Final step: ${r.stepFinal}`,
            `[EVAL BEFORE] RMSE = ${r.baselineRmse}  |  Accuracy = ${r.baselineAcc}%`,
            `[EVAL AFTER]  RMSE = ${r.optimizedRmse}  |  Accuracy = ${r.optimizedAcc}%`,
            `[IMPROVEMENT] RMSE reduced by ${r.improvement}%`,
            `[WEIGHTS]    Optimized w ∈ ℝ⁹ stored in window.Optimizer.getOptimizedWeights()`
        ];
    }

    // ============================================================
    //  SECTION D — UI PANEL  (mirrors appendMathPanel style)
    //
    //  ⚠️  INTEGRATION ENGINEER:
    //  Call appendOptimizerPanel() after appendMathPanel() inside
    //  showContextRoutes() in app.js.
    //  Make sure this script tag is added to index.html AFTER
    //  math_model.js and BEFORE app.js:
    //    <script src="optimizer.js"></script>
    // ============================================================

    function appendOptimizerPanel() {
        const container = document.getElementById('routes-list');
        if (!container) return;

        // Run Hill Climbing every time a route is analyzed
        const r = runHillClimbing();

        // Get current route's real delay from SUGGESTED_ROUTES for context row
        const routes = window.SUGGESTED_ROUTES || [];
        const bestRoute = routes[0];
        let routeContextHtml = '';
        if (bestRoute && window.MathModel) {
            const delay = window.MathModel.expectedDelay(
                bestRoute.timeMin || bestRoute.baseTimeMin || 30,
                bestRoute.activeKeys || ['normal']
            );
            const prob = window.MathModel.probabilityUnion(bestRoute.activeKeys || ['normal']);
            routeContextHtml = `
            <div style="padding:6px 8px;background:rgba(100,255,218,0.05);
                        border-radius:6px;margin-bottom:10px;
                        border-left:2px solid var(--accent-color);">
                <div style="font-size:0.62rem;color:var(--text-secondary);
                            text-transform:uppercase;margin-bottom:3px;">Current Route</div>
                <div style="font-size:0.75rem;color:var(--text-primary);font-weight:600;">
                    ${bestRoute.name || 'Route'}</div>
                <div style="font-size:0.68rem;color:var(--text-secondary);margin-top:2px;">
                    E[D] = ${delay.E.toFixed(1)} min &nbsp;·&nbsp;
                    P(delay) = ${(prob.prob * 100).toFixed(1)}% &nbsp;·&nbsp;
                    σ = ${delay.sigma.toFixed(1)} min
                </div>
            </div>`;
        }

        const rmseColor   = r.improvement > 0 ? '#2ECC71' : '#FFA500';
        const impSign     = r.improvement >= 0 ? '▼' : '▲';

        // Per-scenario rows (top 5 worst errors for compact display)
        const worstScenarios = [...r.perScenarioOpt]
            .sort((a, b) => Math.abs(b.error) - Math.abs(a.error))
            .slice(0, 5);

        const scenarioRows = worstScenarios.map(s => `
            <div style="display:flex;justify-content:space-between;
                        padding:4px 0;border-bottom:1px solid rgba(255,255,255,0.05);
                        font-size:0.68rem;color:var(--text-secondary);">
                <span style="flex:1;overflow:hidden;text-overflow:ellipsis;
                             white-space:nowrap;">${s.id.replace('S','#').replace('_',' ')}</span>
                <span style="margin-left:8px;color:var(--text-primary);
                             font-weight:600;min-width:30px;text-align:right;">
                    ${s.groundTruth}%</span>
                <span style="margin-left:8px;color:${rmseColor};
                             min-width:30px;text-align:right;">${s.predicted}%</span>
                <span style="margin-left:8px;color:rgba(255,255,255,0.4);
                             min-width:36px;text-align:right;">
                    ${s.error >= 0 ? '+' : ''}${s.error}</span>
            </div>
        `).join('');

        const panel = document.createElement('div');
        panel.className = 'card';
        panel.style.marginTop = '12px';
        panel.innerHTML = `
            <div class="ai-header" style="margin-bottom:10px;">
                <i class="fa-solid fa-chart-line" style="color:var(--accent-color)"></i>
                <span style="font-size:0.8rem;">Optimization Report</span>
            </div>

            ${routeContextHtml}

            <!-- Before / After metrics -->
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px;">
                <div style="padding:8px;background:rgba(255,255,255,0.03);
                            border-radius:8px;text-align:center;">
                    <div style="font-size:0.62rem;color:var(--text-secondary);
                                margin-bottom:4px;text-transform:uppercase;">Before</div>
                    <div style="font-size:0.9rem;font-weight:700;
                                color:rgba(255,120,80,0.9);">
                        RMSE ${r.baselineRmse}</div>
                    <div style="font-size:0.68rem;color:var(--text-secondary);
                                margin-top:2px;">acc. ${r.baselineAcc}%</div>
                </div>
                <div style="padding:8px;background:rgba(255,255,255,0.03);
                            border-radius:8px;text-align:center;">
                    <div style="font-size:0.62rem;color:var(--text-secondary);
                                margin-bottom:4px;text-transform:uppercase;">After</div>
                    <div style="font-size:0.9rem;font-weight:700;
                                color:${rmseColor};">
                        RMSE ${r.optimizedRmse}</div>
                    <div style="font-size:0.68rem;color:var(--text-secondary);
                                margin-top:2px;">acc. ${r.optimizedAcc}%</div>
                </div>
            </div>

            <!-- Improvement badge -->
            <div style="text-align:center;padding:6px;
                        background:rgba(46,204,113,0.08);border-radius:8px;
                        margin-bottom:10px;">
                <span style="font-size:0.75rem;font-weight:700;color:${rmseColor};">
                    ${impSign} ${r.improvement}% RMSE improvement
                </span>
                <span style="font-size:0.68rem;color:var(--text-secondary);
                             margin-left:8px;">
                    ${r.iterations} iterations • Hill Climbing
                </span>
            </div>

            <!-- Algorithm info -->
            <div style="font-size:0.69rem;color:var(--text-secondary);
                        line-height:1.8;margin-bottom:8px;">
                <span style="color:var(--text-primary);font-weight:600;">Algorithm</span>:
                Steepest-ascent Hill Climbing (w ∈ ℝ⁹)<br>
                <span style="color:var(--text-primary);font-weight:600;">Scenarios</span>:
                ${r.scenarioCount} test cases<br>
                <span style="color:var(--text-primary);font-weight:600;">Fitness</span>:
                RMSE = √[(1/N) Σ(ŷᵢ−yᵢ)²]
            </div>

            <!-- Per-scenario table header -->
            <div style="font-size:0.68rem;color:var(--text-secondary);
                        font-weight:600;text-transform:uppercase;
                        letter-spacing:0.5px;margin-bottom:4px;">
                Highest error — top 5 scenarios (Actual / Predicted / Δ)
            </div>
            ${scenarioRows}

            <div style="margin-top:8px;font-size:0.62rem;
                        color:rgba(255,255,255,0.2);text-align:right;">
                Optimized w injected into window.Optimizer &nbsp;·&nbsp;
                HC tunes global model weights (same across routes)
            </div>
        `;

        container.appendChild(panel);
    }

    // ============================================================
    //  PUBLIC API
    // ============================================================

    window.Optimizer = {
        // Run the hill climbing optimiser and return result object
        runHillClimbing,

        // Evaluate any custom weight vector (useful for testing)
        evaluateWeights,

        // Get the optimised weights (null before runHillClimbing)
        getOptimizedWeights: () => _optimizedWeights,

        // Get the last result object
        getLastResult: () => _lastResult,

        // Append the UI panel into routes-list
        appendOptimizerPanel,

        // Human-readable report lines for the project report
        getReport,

        // Expose test scenarios (read-only) for Data Engineer
        TEST_SCENARIOS,

        // Expose config for tuning
        HC_CONFIG
    };

    console.info('[Optimizer] Module loaded — COE017 Evaluation & Optimization Specialist');
    console.info(`[Optimizer] ${TEST_SCENARIOS.length} test scenarios ready.`);
    console.info('[Optimizer] Call Optimizer.runHillClimbing() to start optimization.');

})();

// ================================================================
//  INTEGRATION GUIDE  (for Integration & System Engineer)
// ================================================================
//
//  1. index.html — add before </body>:
//       <script src="math_model.js"></script>
//       <script src="optimizer.js"></script>    ← ADD THIS LINE
//       <script src="app.js"></script>
//
//  2. app.js — add at the end of showContextRoutes():
//       appendMathPanel();
//       Optimizer.appendOptimizerPanel();       ← ADD THIS LINE
//
//  3. Test: open F12 console, you should see:
//       [Optimizer] Module loaded — COE017 Evaluation & Optimization Specialist
//       [Optimizer] 15 test scenarios ready.
//
//  4. After clicking "Analyze Route", left panel should show:
//       → Mathematical Analysis card  (math_model.js)
//       → Optimization Report card    (optimizer.js)
//
// ================================================================
//
//  DATA & SIMULATION ENGINEER — ADDING SCENARIOS:
//  Append new scenarios to the TEST_SCENARIOS array.
//  Example format:
//    {
//        id:          'S16_sim_heavy_rain_peak',
//        activeKeys:  ['rain', 'peakHour', 'westSide'],
//        baseTimeMin: 40,
//        groundTruth: 52,     // from your simulation output
//        source:      'Simulation run #3 — heavy rain + peak'
//    }
//
// ================================================================
