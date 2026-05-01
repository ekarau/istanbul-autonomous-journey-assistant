// ================================================================
//  metrics_panel.js  —  Live Optimization Metrics Panel
//  COE017 Principles of AI  |  Istanbul Autonomous Journey Asst.
//  Role: Evaluation Specialist
// ================================================================
//
//  This module renders a small UI panel that shows the optimizer's
//  *internal* state in real time. It is the live counterpart of the
//  offline benchmark in tests/optimizer_benchmark.html.
//
//  Two ways the optimizer feeds it:
//
//    A) Push API — the optimizer calls
//          window.MetricsPanel.update({ E, sigma, iter, T, bestCost })
//       on every iteration (or every k iterations).
//
//    B) Final-summary API — after Evaluator.run() finishes,
//          window.MetricsPanel.renderSummary(results)
//       paints the comparison table directly.
//
//  Optimizer-agnostic by design: SA, GA, MCTS or hill-climbing all
//  fit. Unknown fields are simply hidden (e.g. GA has no temperature
//  T, so that cell stays blank when undefined).
//
//  Public API:  window.MetricsPanel
//    .mount(parentSelector)                 attaches DOM to parent
//    .update(metrics)                       live tick (push)
//    .renderSummary(evaluatorResults)       benchmark table
//    .reset()                               clears everything
//    .isMounted()                           bool
// ================================================================

(function () {
    'use strict';

    let root = null;        // panel DOM root
    let liveBox = null;     // live-tick subpanel
    let summaryBox = null;  // benchmark-table subpanel
    let history = [];       // last N samples for sparkline (E[D])

    const HISTORY_LEN = 40;

    let _mountId = 0;   // increment each mount to avoid duplicate IDs

    // ── Build the DOM once ────────────────────────────────────────
    function buildDom() {
        _mountId++;
        const uid = _mountId;   // unique suffix for this panel instance
        const panel = document.createElement('div');
        panel.className = 'card metrics-panel';
        panel.dataset.mpId = uid;
        panel.style.cssText = 'margin-top:12px;padding:12px;';
        panel.innerHTML = `
            <div class="ai-header" style="margin-bottom:10px;">
                <i class="fa-solid fa-chart-line" style="color:var(--accent-color)"></i>
                <span style="font-size:0.8rem;">Optimization Metrics</span>
            </div>

            <div class="mp-live" style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-bottom:10px;">
                ${cell('E[D]',   'mp-E-'+uid,     'min')}
                ${cell('σ[D]',   'mp-sigma-'+uid, 'min')}
                ${cell('Iter',   'mp-iter-'+uid,  '')}
                ${cell('T',      'mp-T-'+uid,     '')}
            </div>

            <canvas id="mp-spark-${uid}" width="300" height="40"
                    style="width:100%;height:40px;display:block;
                           background:rgba(255,255,255,0.03);border-radius:6px;"></canvas>

            <div class="mp-summary" style="margin-top:10px;font-size:0.72rem;color:var(--text-secondary,#C9D1D9);"></div>

            <div style="margin-top:8px;font-size:0.62rem;color:rgba(255,255,255,0.25);text-align:right;">
                cost = E[D] + λ·‖x‖₂   ·   live tick from window.Optimizers.*
            </div>
        `;
        return panel;

        function cell(label, id, unit) {
            return `
                <div style="text-align:center;padding:6px 4px;background:rgba(255,255,255,0.03);border-radius:6px;">
                    <div style="font-size:0.62rem;color:var(--text-secondary,#8B949E);margin-bottom:2px;">${label}</div>
                    <div id="${id}" style="font-size:0.95rem;font-weight:700;color:var(--accent-color,#64FFDA);">—</div>
                    ${unit ? `<div style="font-size:0.55rem;color:rgba(255,255,255,0.3);">${unit}</div>` : ''}
                </div>`;
        }
    }

    // ── Sparkline renderer (no deps) ──────────────────────────────
    function drawSparkline() {
        if (!root) return;
        const uid = root.dataset.mpId;
        const c = root.querySelector('#mp-spark-' + uid);
        if (!c || history.length < 2) return;
        const ctx = c.getContext('2d');
        const w = c.width, h = c.height;
        ctx.clearRect(0, 0, w, h);

        const min = Math.min(...history);
        const max = Math.max(...history);
        const span = (max - min) || 1;

        ctx.strokeStyle = '#64FFDA';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        history.forEach((v, i) => {
            const x = (i / (history.length - 1)) * w;
            const y = h - ((v - min) / span) * (h - 6) - 3;
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        });
        ctx.stroke();

        // tail dot — current value
        const last = history[history.length - 1];
        const ly = h - ((last - min) / span) * (h - 6) - 3;
        ctx.fillStyle = '#64FFDA';
        ctx.beginPath();
        ctx.arc(w - 1, ly, 2.5, 0, Math.PI * 2);
        ctx.fill();
    }

    // ── Public methods ────────────────────────────────────────────
    function mount(parentSelector) {
        const parent = typeof parentSelector === 'string'
            ? document.querySelector(parentSelector)
            : parentSelector;
        if (!parent) {
            console.warn('[MetricsPanel] mount target not found:', parentSelector);
            return false;
        }
        if (root && root.parentNode) root.parentNode.removeChild(root);
        root = buildDom();
        parent.appendChild(root);
        liveBox    = root.querySelector('.mp-live');
        summaryBox = root.querySelector('.mp-summary');
        return true;
    }

    function setCell(id, value) {
        if (!root) return;
        const uid = root.dataset.mpId;
        // id arrives as e.g. '#mp-E' — append uid to target the right instance
        const selector = id.replace(/^#/, '#') + (id.includes('-' + uid) ? '' : '-' + uid);
        const el = root.querySelector(selector);
        if (el) el.textContent = (value === undefined || value === null || Number.isNaN(value))
            ? '—'
            : (typeof value === 'number' ? round(value) : String(value));
    }

    function round(v) {
        if (Math.abs(v) >= 100)  return v.toFixed(0);
        if (Math.abs(v) >= 10)   return v.toFixed(1);
        return v.toFixed(2);
    }

    /**
     * update — called by the optimizer on every iteration (or every k).
     * @param {{E?:number, sigma?:number, iter?:number, T?:number, bestCost?:number}} m
     */
    function update(m) {
        if (!root) return;
        if (!m) return;
        setCell('#mp-E',     m.E);
        setCell('#mp-sigma', m.sigma);
        setCell('#mp-iter',  m.iter);
        setCell('#mp-T',     m.T);

        if (typeof m.E === 'number' && !Number.isNaN(m.E)) {
            history.push(m.E);
            if (history.length > HISTORY_LEN) history.shift();
            drawSparkline();
        }
    }

    /**
     * renderSummary — paint the Evaluator.run() comparison table.
     * @param {Array} rows  — output of window.Evaluator.run(...)
     */
    function renderSummary(rows) {
        if (!root || !summaryBox) return;
        if (!Array.isArray(rows) || rows.length === 0) {
            summaryBox.innerHTML = '<em>No evaluation results yet.</em>';
            return;
        }
        const baseline = rows.find(r => r.name === 'greedyBaseline');
        const baseDelay = baseline ? baseline.meanDelay : 0;

        const tableRows = rows.map((r, i) => {
            const isWinner = i === 0;
            const impColor = r.improvementPct > 0  ? '#2ECC71'
                          :  r.improvementPct < 0  ? '#FF4D4D'
                          :  'rgba(255,255,255,0.4)';
            const tag = r.name === 'greedyBaseline' ? ' <span style="opacity:0.5">(ref)</span>' : '';
            return `
                <tr style="${isWinner ? 'background:rgba(46,204,113,0.06);' : ''}">
                    <td style="padding:4px 6px;">${r.name}${tag}</td>
                    <td style="padding:4px 6px;text-align:right;color:var(--accent-color);font-family:ui-monospace,monospace;">${r.meanDelay.toFixed(1)}</td>
                    <td style="padding:4px 6px;text-align:right;font-family:ui-monospace,monospace;">${r.stdDelay.toFixed(1)}</td>
                    <td style="padding:4px 6px;text-align:right;font-family:ui-monospace,monospace;">${r.meanCost.toFixed(2)}</td>
                    <td style="padding:4px 6px;text-align:right;font-family:ui-monospace,monospace;">${(r.winRate * 100).toFixed(0)}%</td>
                    <td style="padding:4px 6px;text-align:right;color:${impColor};font-weight:600;font-family:ui-monospace,monospace;">
                        ${r.name === 'greedyBaseline' ? '—' : (r.improvementPct >= 0 ? '+' : '') + r.improvementPct.toFixed(1) + '%'}
                    </td>
                </tr>`;
        }).join('');

        summaryBox.innerHTML = `
            <div style="font-size:0.7rem;font-weight:600;text-transform:uppercase;
                        letter-spacing:0.5px;margin-bottom:6px;color:var(--text-secondary,#8B949E);">
                Benchmark vs Greedy (E[D] in min, ${rows[0] ? '' : ''}baseline=${baseDelay.toFixed(1)})
            </div>
            <table style="width:100%;font-size:0.7rem;border-collapse:collapse;">
                <thead>
                    <tr style="color:var(--text-secondary,#8B949E);font-size:0.6rem;text-transform:uppercase;">
                        <th style="text-align:left;padding:4px 6px;">Optimizer</th>
                        <th style="text-align:right;padding:4px 6px;">μ delay</th>
                        <th style="text-align:right;padding:4px 6px;">σ delay</th>
                        <th style="text-align:right;padding:4px 6px;" title="cost = E[D] + λ·‖x‖₂">cost</th>
                        <th style="text-align:right;padding:4px 6px;">Win</th>
                        <th style="text-align:right;padding:4px 6px;">vs greedy</th>
                    </tr>
                </thead>
                <tbody>${tableRows}</tbody>
            </table>
        `;

        // Winner snapshot — paint top-row aggregates into the live cells so the
        // panel never sits empty after a benchmark. Live tick still overrides
        // these on the next optimizer iteration.
        const winner = rows[0];
        history = [];                              // clear any stale sparkline
        setCell('#mp-E',     winner.meanDelay);
        setCell('#mp-sigma', winner.stdDelay);
        setCell('#mp-iter',  winner.avgIters);
        setCell('#mp-T',     null);                // greedy / GA have no temperature
    }

    function reset() {
        history = [];
        if (!root) return;
        const uid = root.dataset.mpId;
        ['#mp-E', '#mp-sigma', '#mp-iter', '#mp-T'].forEach(id => setCell(id, null));
        if (summaryBox) summaryBox.innerHTML = '';
        const c = root.querySelector('#mp-spark-' + uid);
        if (c) c.getContext('2d').clearRect(0, 0, c.width, c.height);
    }

    function isMounted() { return !!root; }

    window.MetricsPanel = { mount, update, renderSummary, reset, isMounted };

    console.info('[MetricsPanel] Module loaded — COE017 Evaluation Specialist');
})();
