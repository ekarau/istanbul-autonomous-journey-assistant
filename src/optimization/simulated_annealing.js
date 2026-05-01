// ================================================================
//  simulated_annealing.js  —  Simulated Annealing Module
//  COE017 Principles of AI  |  Istanbul Autonomous Journey Asst.
//  Role: Evaluation & Optimization Specialist
// ================================================================
//
//  Simulated Annealing (SA) selects the optimal route by treating
//  route selection as a combinatorial optimisation problem.
//
//  STATE   : one candidate route from the available route list
//  COST    : cost = α·E[D] + β·distance + γ·transferCount − δ·confidence
//            where α=0.40, β=0.25, γ=0.20, δ=0.15  (sum = 1.00)
//  COOLING : T_k = T₀ × 0.95^k   (geometric schedule)
//
//  ACCEPTANCE RULE (Metropolis criterion):
//    If ΔE < 0 → always accept (improvement)
//    If ΔE ≥ 0 → accept with probability P = e^(−ΔE / T_k)
//    This allows uphill moves early on (exploration) and
//    converges to a stable solution as temperature drops.
//
//  Public API:  window.SimulatedAnnealing
//    .run(routes)              → SAResult
//    .appendSAPanel()          → void  (call after appendOptimizerPanel)
//    .getLastResult()          → SAResult | null
// ================================================================

(function () {
    'use strict';

    // ============================================================
    //  COST FUNCTION COEFFICIENTS  (α + β + γ − δ blend)
    //  Matches PM specification exactly.
    // ============================================================
    const COST_COEFFS = {
        alpha: 0.40,    // weight for expected delay E[D]  (normalised)
        beta:  0.25,    // weight for distance
        gamma: 0.20,    // weight for transfer count
        delta: 0.15     // reward for model confidence
    };

    // ============================================================
    //  SA HYPERPARAMETERS
    // ============================================================
    const SA_CONFIG = {
        T0:          100.0,   // initial temperature
        COOLING:     0.95,    // geometric decay factor  T_k = T₀ × 0.95^k
        T_MIN:       0.01,    // stop when temperature falls below this
        MAX_ITER:    1000,    // hard iteration cap
        MAX_DIST_KM: 50       // normalisation reference for distance
    };

    // ============================================================
    //  STATE SPACE
    //  Each state is an index into the routes array.
    //  A "neighbour" is any other route (uniform random swap).
    // ============================================================

    function randomNeighbour(currentIdx, routeCount) {
        if (routeCount <= 1) return currentIdx;
        let next;
        do { next = Math.floor(Math.random() * routeCount); }
        while (next === currentIdx);
        return next;
    }

    // ============================================================
    //  COST FUNCTION
    //  cost = α·E[D]_norm + β·dist_norm + γ·transfers_norm − δ·confidence
    //
    //  All terms normalised to [0, 1] before blending.
    // ============================================================

    /**
     * computeCost
     * -----------
     * @param {{ name, activeKeys, baseTimeMin, distanceKm, transferCount }} route
     * @returns {{ cost: number, breakdown: object }}
     */
    function computeCost(route) {
        const delay      = window.MathModel.expectedDelay(route.baseTimeMin, route.activeKeys);
        const probResult = window.MathModel.probabilityUnion(route.activeKeys);

        // Normalised terms (each ∈ [0, 1])
        const eDnorm   = Math.min(1, delay.E / (route.baseTimeMin * 2 || 60));
        const distNorm = Math.min(1, (route.distanceKm || 30) / SA_CONFIG.MAX_DIST_KM);
        const trNorm   = Math.min(1, (route.transferCount || 0) / 5);
        const conf     = 1 - probResult.prob;                 // confidence = 1 - P(delay)

        const cost = (
            COST_COEFFS.alpha * eDnorm   +
            COST_COEFFS.beta  * distNorm +
            COST_COEFFS.gamma * trNorm   -
            COST_COEFFS.delta * conf
        );

        return {
            cost: Math.max(0, cost),
            breakdown: {
                expectedDelay:    delay.E,
                delayNorm:        Math.round(eDnorm   * 1000) / 1000,
                distanceNorm:     Math.round(distNorm * 1000) / 1000,
                transferNorm:     Math.round(trNorm   * 1000) / 1000,
                confidence:       Math.round(conf     * 1000) / 1000
            }
        };
    }

    // ============================================================
    //  SIMULATED ANNEALING MAIN LOOP
    // ============================================================

    let _lastResult = null;

    /**
     * run
     * ---
     * @param {Array<{
     *   name         : string,
     *   activeKeys   : string[],
     *   baseTimeMin  : number,
     *   distanceKm   : number,
     *   transferCount: number
     * }>} routes
     *
     * @returns {{
     *   bestRoute     : object,
     *   bestCost      : number,
     *   initialRoute  : object,
     *   initialCost   : number,
     *   iterations    : number,
     *   acceptedMoves : number,
     *   costHistory   : number[],
     *   tempHistory   : number[]
     * }}
     */
    function run(routes) {
        if (!routes || routes.length < 2) {
            console.warn('[SA] Need at least 2 routes to run Simulated Annealing.');
            return null;
        }

        // ── Initialise ────────────────────────────────────────────
        let currentIdx  = 0;                                    // start at first route
        let currentCost = computeCost(routes[currentIdx]).cost;
        let bestIdx     = currentIdx;
        let bestCost    = currentCost;
        const initialIdx  = currentIdx;
        const initialCost = currentCost;

        let T            = SA_CONFIG.T0;
        let iter         = 0;
        let acceptedMoves = 0;
        const costHistory = [currentCost];
        const tempHistory = [T];

        // ── Main loop ─────────────────────────────────────────────
        while (T > SA_CONFIG.T_MIN && iter < SA_CONFIG.MAX_ITER) {

            // Generate neighbour state
            const neighbourIdx  = randomNeighbour(currentIdx, routes.length);
            const neighbourCost = computeCost(routes[neighbourIdx]).cost;
            const deltaE        = neighbourCost - currentCost;

            // Metropolis acceptance criterion
            const accept = deltaE < 0
                ? true
                : Math.random() < Math.exp(-deltaE / T);

            if (accept) {
                currentIdx  = neighbourIdx;
                currentCost = neighbourCost;
                acceptedMoves++;

                // Track global best
                if (currentCost < bestCost) {
                    bestIdx  = currentIdx;
                    bestCost = currentCost;
                }
            }

            // Geometric cooling schedule: T_k = T₀ × 0.95^k
            T   *= SA_CONFIG.COOLING;
            iter++;

            // Record every 50 iterations for charting
            if (iter % 50 === 0) {
                costHistory.push(Math.round(currentCost * 1000) / 1000);
                tempHistory.push(Math.round(T * 100) / 100);
            }

            // ── MetricsPanel live tick ────────────────────────────
            //  FIX: MetricsPanel.update() was never called during the
            //  SA loop — the panel only received data after the run
            //  finished.  Now we push a live tick every 10 iterations
            //  (100 ticks total for MAX_ITER=1000) so the sparkline
            //  and E[D] / T cells update in real time during analysis.
            if (iter % 10 === 0 &&
                window.MetricsPanel &&
                typeof window.MetricsPanel.update === 'function' &&
                window.MetricsPanel.isMounted()) {

                const bestDelay = window.MathModel.expectedDelay(
                    routes[bestIdx].baseTimeMin,
                    routes[bestIdx].activeKeys
                );
                window.MetricsPanel.update({
                    E:        bestDelay.E,
                    sigma:    bestDelay.sigma,
                    iter:     iter,
                    T:        Math.round(T * 100) / 100,
                    bestCost: Math.round(bestCost * 1000) / 1000
                });
            }
        }

        // ── Final cost breakdown for best route ───────────────────
        const bestCostResult = computeCost(routes[bestIdx]);

        _lastResult = {
            bestRoute:     routes[bestIdx],
            bestCost:      Math.round(bestCost    * 1000) / 1000,
            initialRoute:  routes[initialIdx],
            initialCost:   Math.round(initialCost * 1000) / 1000,
            costBreakdown: bestCostResult.breakdown,
            improvement:   initialCost > 0
                ? Math.round(((initialCost - bestCost) / initialCost) * 1000) / 10
                : 0,
            iterations:    iter,
            acceptedMoves,
            acceptRate:    Math.round((acceptedMoves / iter) * 1000) / 10,
            finalTemp:     Math.round(T * 1000) / 1000,
            costHistory,
            tempHistory
        };

        // ── Console report ────────────────────────────────────────
        console.group('[SA] Simulated Annealing — COE017 Evaluation & Optimization');
        console.info(`Routes evaluated  : ${routes.length}`);
        console.info(`Iterations        : ${iter}`);
        console.info(`Accepted moves    : ${acceptedMoves} (${_lastResult.acceptRate}%)`);
        console.info(`Final temperature : ${_lastResult.finalTemp}`);
        console.info(`Initial cost      : ${_lastResult.initialCost}`);
        console.info(`Best cost         : ${_lastResult.bestCost}`);
        console.info(`Improvement       : ${_lastResult.improvement}%`);
        console.info(`Best route        : ${_lastResult.bestRoute.name}`);
        console.table(_lastResult.costBreakdown);
        console.groupEnd();

        return _lastResult;
    }

    // ============================================================
    //  UI PANEL  (appended after Optimization Report card)
    // ============================================================

    function appendSAPanel() {
        const container = document.getElementById('routes-list');
        if (!container) return;

        // Build default routes from app.js SUGGESTED_ROUTES if available
        const routes = (window.SUGGESTED_ROUTES || []).map(r => ({
            name:          r.name || r.label,
            activeKeys:    r.activeKeys || ['normal'],
            baseTimeMin:   r.timeMin    || 30,
            distanceKm:    r.distanceKm || 30,
            transferCount: r.transfers  || 0
        }));

        if (routes.length < 2) {
            console.warn('[SA] appendSAPanel: not enough routes, skipping panel.');
            return;
        }

        // ── Mount MetricsPanel before run() so live ticks arrive ──
        //  FIX: MetricsPanel was never mounted, so MetricsPanel.isMounted()
        //  returned false and every update() call was silently skipped.
        //  We mount it into the SA panel's own container now, reset any
        //  stale state from a previous analysis, then call run() so the
        //  live ticks populate the panel during the SA loop.
        // FIX — mount MetricsPanel BEFORE run() so live ticks arrive.
        //
        //  Problem: saMetricsSlot was created, _mountMetrics() was defined,
        //  but mount() was only called AFTER run() finished — meaning every
        //  isMounted() check inside the SA loop returned false and all
        //  live update() calls were silently dropped.
        //
        //  Solution: mount into a temporary off-screen div first so
        //  isMounted() returns true during the loop. After run() builds
        //  the panel HTML, move the slot into the real panel before
        //  appending to the DOM — no visual flash, ticks work correctly.
        const saMetricsSlot = document.createElement('div');
        saMetricsSlot.id = 'sa-metrics-slot';

        // Mount into an off-screen holder so isMounted() = true during run()
        const _offscreen = document.createElement('div');
        _offscreen.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none;';
        _offscreen.appendChild(saMetricsSlot);
        document.body.appendChild(_offscreen);

        if (window.MetricsPanel && typeof window.MetricsPanel.mount === 'function') {
            window.MetricsPanel.mount(saMetricsSlot);
            window.MetricsPanel.reset();
        }

        const r = run(routes);
        if (!r) {
            // clean up offscreen div before bailing
            if (document.body.contains(_offscreen)) document.body.removeChild(_offscreen);
            return;
        }

        // ── Final summary tick after loop completes ────────────
        //  Push one last update with the definitive best values so
        //  the panel always ends on the true optimum, not the last
        //  mid-loop tick.
        if (window.MetricsPanel &&
            typeof window.MetricsPanel.update === 'function' &&
            window.MetricsPanel.isMounted()) {
            const finalDelay = window.MathModel.expectedDelay(
                r.bestRoute.baseTimeMin,
                r.bestRoute.activeKeys
            );
            window.MetricsPanel.update({
                E:        finalDelay.E,
                sigma:    finalDelay.sigma,
                iter:     r.iterations,
                T:        r.finalTemp,
                bestCost: r.bestCost
            });
        }

        const impColor = r.improvement > 0 ? '#2ECC71' : '#FFA500';

        // Mini cost convergence bar (visual only, not a chart library)
        const maxCost = Math.max(...r.costHistory, 0.001);
        const bars = r.costHistory.slice(0, 10).map(c => {
            const h = Math.round((c / maxCost) * 32);
            return `<div style="width:6px;height:${h}px;background:var(--accent-color);
                                border-radius:2px;align-self:flex-end;opacity:0.8;"></div>`;
        }).join('');

        const panel = document.createElement('div');
        panel.className = 'card';
        panel.style.marginTop = '12px';
        panel.innerHTML = `
            <div class="ai-header" style="margin-bottom:10px;">
                <i class="fa-solid fa-temperature-half" style="color:var(--accent-color)"></i>
                <span style="font-size:0.8rem;">Simulated Annealing — Route Selection</span>
            </div>

            <!-- Best route -->
            <div style="padding:8px;background:rgba(255,255,255,0.04);
                        border-radius:8px;margin-bottom:10px;">
                <div style="font-size:0.62rem;color:var(--text-secondary);
                            text-transform:uppercase;margin-bottom:4px;">Optimal Route Found</div>
                <div style="font-size:0.95rem;font-weight:700;
                            color:var(--text-primary);">
                    ${r.bestRoute.name}</div>
                <div style="font-size:0.68rem;color:${impColor};margin-top:2px;">
                    Cost: ${r.bestCost}  
                    <span style="color:var(--text-secondary);margin-left:6px;">
                        ▼ ${r.improvement}% vs initial</span>
                </div>
            </div>

            <!-- Stats row -->
            <div style="display:grid;grid-template-columns:repeat(3,1fr);
                        gap:6px;margin-bottom:10px;">
                <div style="text-align:center;padding:6px;
                            background:rgba(255,255,255,0.03);border-radius:6px;">
                    <div style="font-size:0.62rem;color:var(--text-secondary);">Iterations</div>
                    <div style="font-size:0.85rem;font-weight:700;">${r.iterations}</div>
                </div>
                <div style="text-align:center;padding:6px;
                            background:rgba(255,255,255,0.03);border-radius:6px;">
                    <div style="font-size:0.62rem;color:var(--text-secondary);">Accept Rate</div>
                    <div style="font-size:0.85rem;font-weight:700;">${r.acceptRate}%</div>
                </div>
                <div style="text-align:center;padding:6px;
                            background:rgba(255,255,255,0.03);border-radius:6px;">
                    <div style="font-size:0.62rem;color:var(--text-secondary);">Final T</div>
                    <div style="font-size:0.85rem;font-weight:700;">${r.finalTemp}</div>
                </div>
            </div>

            <!-- Cost convergence mini-chart -->
            <div style="font-size:0.62rem;color:var(--text-secondary);
                        text-transform:uppercase;margin-bottom:4px;">
                Cost convergence
            </div>
            <div style="display:flex;gap:3px;align-items:flex-end;
                        height:36px;margin-bottom:10px;">
                ${bars}
            </div>

            <!-- Cost formula -->
            <div style="font-size:0.68rem;color:var(--text-secondary);
                        line-height:1.9;padding:6px;
                        background:rgba(255,255,255,0.02);border-radius:6px;">
                <strong style="color:var(--text-primary);">Cost function</strong><br>
                α·E[D] + β·dist + γ·transfers − δ·confidence<br>
                α=${COST_COEFFS.alpha} · β=${COST_COEFFS.beta} · γ=${COST_COEFFS.gamma} · δ=${COST_COEFFS.delta}<br>
                <strong style="color:var(--text-primary);">Cooling</strong>: 
                T<sub>k</sub> = ${SA_CONFIG.T0} × ${SA_CONFIG.COOLING}^k
            </div>
        `;

        // Move slot from off-screen holder into the real panel, then clean up
        panel.appendChild(saMetricsSlot);
        document.body.removeChild(_offscreen);
        container.appendChild(panel);
    }

    // ============================================================
    //  PUBLIC API
    // ============================================================

    window.SimulatedAnnealing = {
        run,
        appendSAPanel,
        getLastResult: () => _lastResult,
        computeCost,
        SA_CONFIG,
        COST_COEFFS
    };

    console.info('[SA] Module loaded — COE017 Evaluation & Optimization Specialist');
    console.info(`[SA] Cooling schedule: T_k = ${SA_CONFIG.T0} × ${SA_CONFIG.COOLING}^k`);
    console.info(`[SA] Cost: α·E[D] + β·dist + γ·transfers − δ·confidence`);

})();

// ================================================================
//  INTEGRATION GUIDE  (for Integration & System Engineer)
// ================================================================
//
//  1. index.html — add before </body> in this order:
//       <script src="math_model.js"></script>
//       <script src="optimizer.js"></script>
//       <script src="baseline_greedy.js"></script>
//       <script src="simulated_annealing.js"></script>   ← ADD THIS
//       <script src="app.js"></script>
//
//  2. app.js — inside showContextRoutes(), after other panels:
//       SimulatedAnnealing.appendSAPanel();              ← ADD THIS
//
//  3. app.js — expose SUGGESTED_ROUTES to window so SA can read it:
//       window.SUGGESTED_ROUTES = filteredRoutes;        ← ADD THIS
//       (each route needs: name, activeKeys, baseTimeMin,
//        distanceKm, transferCount)
//
//  4. Console test after clicking "Analyze Route":
//       [SA] Simulated Annealing — COE017 Evaluation & Optimization
//       → Should print best route name and cost table
//
// ================================================================
