// ================================================================
//  ga_route_planner.js  —  Genetic Algorithm Route Planner
//  COE017 Principles of AI  |  Istanbul Autonomous Journey Asst.
//  Role: Evaluation & Optimization Specialist (Dilara)
// ================================================================
//
//  Treats route selection as a combinatorial optimisation problem.
//
//  ENCODING   : Each individual is a permutation of route indices
//               (order = priority ranking the agent prefers).
//               The first gene is the "selected" route.
//
//  FITNESS    : f(i) = 1 / (1 + cost(routes[i]))
//               where cost = α·E[D] + β·dist + γ·transfers − δ·confidence
//               (same cost function as Simulated Annealing for fair comparison)
//
//  SELECTION  : Tournament selection (k=3)
//               → natural selection pressure without premature convergence
//
//  CROSSOVER  : Order crossover (OX1)
//               → preserves relative ordering of genes (valid permutation)
//
//  MUTATION   : Swap mutation (two random positions exchanged)
//               → maintains permutation validity, low disruption
//
//  ELITISM    : Top-1 individual always survives to next generation
//               → guarantees monotonic improvement of best solution
//
//  TERMINATION: MAX_GENERATIONS reached  OR  fitness plateau (Δ < ε for
//               PATIENCE consecutive generations)
//
//  Cost coefficients match simulated_annealing.js for direct comparison:
//    α=0.40  β=0.25  γ=0.20  δ=0.15
//
//  Public API:  window.GeneticAlgorithm
//    .run(routes, opts?)       → GAResult
//    .appendGAPanel()          → void  (call after appendSAPanel)
//    .getLastResult()          → GAResult | null
//    .DEFAULTS                 → hyperparameter reference object
// ================================================================

(function () {
    'use strict';

    // ============================================================
    //  COST FUNCTION COEFFICIENTS
    //  Intentionally identical to SA so benchmark comparisons are fair.
    // ============================================================
    const COST_COEFFS = {
        alpha: 0.40,   // expected delay weight
        beta:  0.25,   // distance weight
        gamma: 0.20,   // transfer count weight
        delta: 0.15    // confidence reward
    };

    const MAX_DIST_KM = 50;   // normalisation reference

    // ============================================================
    //  GA HYPERPARAMETERS
    // ============================================================
    const DEFAULTS = {
        POP_SIZE:        40,    // population size
        MAX_GENERATIONS: 200,   // hard generation cap
        CROSSOVER_RATE:  0.85,  // probability of crossover vs. direct copy
        MUTATION_RATE:   0.15,  // probability of swap mutation per individual
        TOURNAMENT_K:    3,     // tournament selection group size
        PATIENCE:        30,    // stop early if best fitness unchanged for this many gens
        ELITISM:         1      // number of elites carried to next generation
    };

    // ============================================================
    //  COST FUNCTION  (mirrors simulated_annealing.js computeCost)
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

        const eDnorm   = Math.min(1, delay.E / (route.baseTimeMin * 2 || 60));
        const distNorm = Math.min(1, (route.distanceKm   || 30) / MAX_DIST_KM);
        const trNorm   = Math.min(1, (route.transferCount || 0) / 5);
        const conf     = Math.max(0, Math.min(1, probResult.confidence || 0.7));

        const cost =
            COST_COEFFS.alpha * eDnorm  +
            COST_COEFFS.beta  * distNorm +
            COST_COEFFS.gamma * trNorm  -
            COST_COEFFS.delta * conf;

        return {
            cost: Math.max(0, cost),
            breakdown: { eDnorm, distNorm, trNorm, conf, delay }
        };
    }

    // ============================================================
    //  ENCODING HELPERS
    // ============================================================

    /** Create a random permutation of [0, 1, …, n-1]. */
    function randomPermutation(n) {
        const arr = Array.from({ length: n }, (_, i) => i);
        for (let i = n - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [arr[i], arr[j]] = [arr[j], arr[i]];
        }
        return arr;
    }

    /** Fitness of an individual (first gene = selected route). */
    function fitness(individual, routes) {
        const { cost } = computeCost(routes[individual[0]]);
        return 1 / (1 + cost);
    }

    // ============================================================
    //  SELECTION — Tournament (k=3)
    // ============================================================

    /**
     * tournamentSelect
     * ----------------
     * Randomly samples k individuals and returns the one with highest fitness.
     *
     * @param {number[][]} population
     * @param {number[]}   fitnesses
     * @param {number}     k
     * @returns {number[]}  winning individual (copy)
     */
    function tournamentSelect(population, fitnesses, k) {
        let bestIdx = -1, bestFit = -Infinity;
        for (let i = 0; i < k; i++) {
            const idx = Math.floor(Math.random() * population.length);
            if (fitnesses[idx] > bestFit) {
                bestFit = fitnesses[idx];
                bestIdx = idx;
            }
        }
        return population[bestIdx].slice();
    }

    // ============================================================
    //  CROSSOVER — Order Crossover (OX1)
    //  Guarantees offspring is a valid permutation.
    // ============================================================

    /**
     * orderCrossover
     * --------------
     * Classic OX1: copy a random sub-sequence from parent A, then fill
     * remaining positions with genes from parent B in their original order.
     *
     * @param {number[]} parentA
     * @param {number[]} parentB
     * @returns {[number[], number[]]}  two offspring
     */
    function orderCrossover(parentA, parentB) {
        const n = parentA.length;
        const start = Math.floor(Math.random() * n);
        const end   = start + Math.floor(Math.random() * (n - start)) + 1;

        function buildChild(primary, secondary) {
            const child  = new Array(n).fill(-1);
            const segment = new Set();

            // Copy segment from primary
            for (let i = start; i < end; i++) {
                child[i]  = primary[i];
                segment.add(primary[i]);
            }

            // Fill remaining positions with secondary's genes in order
            let secIdx = 0;
            for (let i = 0; i < n; i++) {
                if (child[i] !== -1) continue;
                while (segment.has(secondary[secIdx])) secIdx++;
                child[i] = secondary[secIdx++];
            }
            return child;
        }

        return [buildChild(parentA, parentB), buildChild(parentB, parentA)];
    }

    // ============================================================
    //  MUTATION — Swap mutation
    // ============================================================

    /**
     * swapMutate
     * ----------
     * Randomly swaps two genes.  Preserves permutation validity.
     *
     * @param {number[]} individual  (mutated in-place)
     */
    function swapMutate(individual) {
        const n = individual.length;
        const i = Math.floor(Math.random() * n);
        let   j = Math.floor(Math.random() * n);
        while (j === i) j = Math.floor(Math.random() * n);
        [individual[i], individual[j]] = [individual[j], individual[i]];
    }

    // ============================================================
    //  MAIN GA LOOP
    // ============================================================

    /**
     * run
     * ---
     * @param {object[]} routes   — route objects (same shape as SA)
     * @param {object}   [opts]   — override DEFAULTS
     * @returns {GAResult}
     */
    function run(routes, opts) {
        const cfg = Object.assign({}, DEFAULTS, opts || {});
        const n   = routes.length;

        if (n === 0) return null;
        if (n === 1) {
            const { cost, breakdown } = computeCost(routes[0]);
            return {
                bestRoute:   routes[0],
                bestCost:    cost,
                breakdown,
                generations: 0,
                fitnessHistory: [1 / (1 + cost)],
                converged:   true,
                popSize:     1
            };
        }

        // ── Initialise population ──────────────────────────────────
        let population = Array.from({ length: cfg.POP_SIZE }, () => randomPermutation(n));
        let fitnesses  = population.map(ind => fitness(ind, routes));

        const fitnessHistory = [];
        let noImprovCount    = 0;
        let globalBestFit    = -Infinity;
        let globalBestInd    = null;

        // ── Generation loop ────────────────────────────────────────
        for (let gen = 0; gen < cfg.MAX_GENERATIONS; gen++) {

            // Track best this generation
            let genBestFit = -Infinity, genBestIdx = 0;
            fitnesses.forEach((f, i) => {
                if (f > genBestFit) { genBestFit = f; genBestIdx = i; }
            });
            fitnessHistory.push(genBestFit);

            if (genBestFit > globalBestFit) {
                globalBestFit = genBestFit;
                globalBestInd = population[genBestIdx].slice();
                noImprovCount = 0;
            } else {
                noImprovCount++;
            }

            // Early stop — fitness plateau
            if (noImprovCount >= cfg.PATIENCE) break;

            // ── Build next generation ──────────────────────────────
            const nextPop = [];

            // Elitism: carry top-1 unchanged
            nextPop.push(population[genBestIdx].slice());

            // Fill rest via selection + crossover + mutation
            while (nextPop.length < cfg.POP_SIZE) {
                const parentA = tournamentSelect(population, fitnesses, cfg.TOURNAMENT_K);
                const parentB = tournamentSelect(population, fitnesses, cfg.TOURNAMENT_K);

                let [childA, childB] = (Math.random() < cfg.CROSSOVER_RATE)
                    ? orderCrossover(parentA, parentB)
                    : [parentA.slice(), parentB.slice()];

                if (Math.random() < cfg.MUTATION_RATE) swapMutate(childA);
                if (Math.random() < cfg.MUTATION_RATE) swapMutate(childB);

                nextPop.push(childA);
                if (nextPop.length < cfg.POP_SIZE) nextPop.push(childB);
            }

            population = nextPop;
            fitnesses  = population.map(ind => fitness(ind, routes));
        }

        // ── Final result ───────────────────────────────────────────
        const bestRouteIdx = globalBestInd ? globalBestInd[0] : 0;
        const { cost, breakdown } = computeCost(routes[bestRouteIdx]);

        return {
            bestRoute:      routes[bestRouteIdx],
            bestCost:       cost,
            breakdown,
            generations:    fitnessHistory.length,
            fitnessHistory,
            converged:      noImprovCount >= cfg.PATIENCE,
            popSize:        cfg.POP_SIZE
        };
    }

    // ============================================================
    //  UI PANEL  —  appended to .ai-output (same pattern as SA)
    // ============================================================

    let _lastResult = null;

    function appendGAPanel() {
        const routes = (window.SUGGESTED_ROUTES || []).map(r => ({
            name:          r.name          || 'Route',
            activeKeys:    r.activeKeys    || [],
            baseTimeMin:   r.baseTimeMin   || 30,
            distanceKm:    r.distanceKm    || 20,
            transferCount: r.transferCount || 0
        }));

        if (routes.length < 2) {
            console.warn('[GA] appendGAPanel: not enough routes, skipping panel.');
            return;
        }

        const result = run(routes);
        if (!result) return;
        _lastResult = result;

        // Register for benchmark comparison
        if (!window.Optimizers) window.Optimizers = {};
        window.Optimizers.geneticAlgorithm = function (scenario) {
            const adaptedRoutes = (scenario.routes || routes);
            return run(adaptedRoutes);
        };

        // ── Build fitness sparkline (SVG) ──────────────────────────
        const hist    = result.fitnessHistory;
        const svgW    = 260, svgH = 48;
        const minF    = Math.min(...hist), maxF = Math.max(...hist);
        const rangeF  = maxF - minF || 0.001;
        const pts     = hist.map((f, i) => {
            const x = (i / Math.max(hist.length - 1, 1)) * svgW;
            const y = svgH - ((f - minF) / rangeF) * (svgH - 4) - 2;
            return `${x.toFixed(1)},${y.toFixed(1)}`;
        }).join(' ');

        const svgSparkline = `
<svg width="${svgW}" height="${svgH}" viewBox="0 0 ${svgW} ${svgH}" style="display:block;margin:6px 0;">
  <polyline points="${pts}" fill="none" stroke="#10B981" stroke-width="1.8"
            stroke-linejoin="round" stroke-linecap="round"/>
  <circle cx="${(parseFloat(pts.split(' ').pop().split(',')[0])|| svgW)}"
          cy="${(parseFloat(pts.split(' ').pop().split(',')[1]) || svgH/2)}"
          r="3" fill="#10B981"/>
</svg>`.trim();

        const { breakdown: bd } = result;
        const delayMin  = bd.delay ? bd.delay.E : '—';
        const ciText    = bd.delay
            ? `${bd.delay.ciLow}–${bd.delay.ciHigh} dk`
            : '—';

        // ── Render panel ───────────────────────────────────────────
        const container = document.querySelector('.ai-output');
        if (!container) return;

        const panel = document.createElement('div');
        panel.className = 'result-section ga-panel';
        panel.style.cssText = 'margin-top:18px;padding:14px 16px;background:var(--surface2,#1e293b);border-radius:12px;border-left:4px solid #10B981;';
        panel.innerHTML = `
<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
  <span style="font-size:18px;">🧬</span>
  <span style="font-weight:700;font-size:14px;color:#10B981;letter-spacing:.5px;">
    GENETIC ALGORITHM
  </span>
  <span style="margin-left:auto;font-size:11px;color:#64748b;">
    ${result.generations} gen · pop ${result.popSize}
    ${result.converged ? ' · <span style="color:#10B981;">converged</span>' : ''}
  </span>
</div>

<div style="font-size:13px;color:#e2e8f0;margin-bottom:4px;">
  🏆 <strong>${result.bestRoute.name}</strong>
  &nbsp;&mdash;&nbsp;cost <strong>${result.bestCost.toFixed(3)}</strong>
</div>
<div style="font-size:11px;color:#94a3b8;margin-bottom:6px;">
  E[gecikme]: <strong>${delayMin} dk</strong> &nbsp;|&nbsp;
  95% CI: <strong>${ciText}</strong> &nbsp;|&nbsp;
  güven: <strong>${((bd.conf||0)*100).toFixed(0)}%</strong>
</div>

<div style="font-size:11px;color:#64748b;margin-bottom:2px;">Fitness history (${hist.length} generations)</div>
${svgSparkline}

<details style="margin-top:8px;">
  <summary style="font-size:11px;color:#64748b;cursor:pointer;">Cost breakdown</summary>
  <table style="width:100%;font-size:11px;color:#94a3b8;margin-top:6px;border-collapse:collapse;">
    <tr><td>α · E[D] norm</td><td style="text-align:right">${(COST_COEFFS.alpha * (bd.eDnorm||0)).toFixed(3)}</td></tr>
    <tr><td>β · distance norm</td><td style="text-align:right">${(COST_COEFFS.beta * (bd.distNorm||0)).toFixed(3)}</td></tr>
    <tr><td>γ · transfers norm</td><td style="text-align:right">${(COST_COEFFS.gamma * (bd.trNorm||0)).toFixed(3)}</td></tr>
    <tr><td>− δ · confidence</td><td style="text-align:right">−${(COST_COEFFS.delta * (bd.conf||0)).toFixed(3)}</td></tr>
    <tr style="border-top:1px solid #334155;font-weight:700;color:#e2e8f0;">
      <td>Total cost</td><td style="text-align:right">${result.bestCost.toFixed(3)}</td>
    </tr>
  </table>
</details>`;

        container.appendChild(panel);
        console.info('[GA] Panel rendered —', result.bestRoute.name,
            `| cost ${result.bestCost.toFixed(3)} | ${result.generations} generations`);
    }

    // ============================================================
    //  PUBLIC API
    // ============================================================
    window.GeneticAlgorithm = {
        run,
        appendGAPanel,
        getLastResult: () => _lastResult,
        DEFAULTS,
        // Internals exposed for unit tests
        _computeCost:        computeCost,
        _tournamentSelect:   tournamentSelect,
        _orderCrossover:     orderCrossover,
        _swapMutate:         swapMutate,
        _randomPermutation:  randomPermutation,
        _fitness:            fitness
    };

    console.info('[GeneticAlgorithm] Module loaded — COE017 Optimization Specialist');
    console.info('[GeneticAlgorithm] Config: pop=' + DEFAULTS.POP_SIZE +
        ' | maxGen=' + DEFAULTS.MAX_GENERATIONS +
        ' | cx=' + DEFAULTS.CROSSOVER_RATE +
        ' | mut=' + DEFAULTS.MUTATION_RATE);
})();
