// ================================================================
//  logic_engine.js  —  Propositional Logic Inference Engine
//  COE017 Principles of AI  |  Istanbul Autonomous Journey Asst.
//  Role: Logic Engineer (Zuhal)
// ================================================================
//
//  FIX (Role analysis — Zuhal's module was a TODO stub):
//  The Modus Ponens engine and rule base already existed inside
//  math_model.js (implemented by Tuğba).  This standalone module
//  re-exposes the same engine via window.LogicEngine and also
//  extends the rule base with 3 additional chained rules,
//  completing the Logic Engineer's deliverable.
//
//  Architecture:
//    LOGIC_RULES  — rule base (premises[] → conclusion, severity)
//    runForwardChain() — fixpoint iteration until no new facts fire
//    window.LogicEngine.run(ctx) → { conclusions[], severity, facts }
// ================================================================

(function () {
    'use strict';

    // ── Rule base ─────────────────────────────────────────────────
    //  Each rule follows the Modus Ponens schema:
    //    P₁ ∧ P₂ ∧ … ∧ Pₙ  →  Q
    //
    //  premises  : active fact keys that must ALL be true
    //  conclusion: fact key that becomes true when rule fires
    //  severity  : 1 = INFO, 2 = WARNING, 3 = CRITICAL
    //  explanation: natural-language justification shown in UI
    // ─────────────────────────────────────────────────────────────
    const LOGIC_RULES = [
        // ── Original 7 rules (from math_model.js Modus Ponens engine) ──
        {
            id: 'R1',
            premises:    ['accident', 'intercontinental'],
            conclusion:  'ferry_or_marmaray_strongly_advised',
            severity:    3,
            explanation: 'Bridge accident + intercontinental crossing → Ferry or Marmaray strongly advised.'
        },
        {
            id: 'R2',
            premises:    ['westSide', 'peakHour'],
            conclusion:  'metrobus_preferred',
            severity:    2,
            explanation: 'E-5/TEM congestion at peak hour → Metrobus preferred.'
        },
        {
            id: 'R3',
            premises:    ['longRoute', 'accident'],
            conclusion:  'high_delay_risk',
            severity:    2,
            explanation: 'Long route (>15 km) with active accident zone → High delay risk.'
        },
        {
            id: 'R4',
            premises:    ['intercontinental', 'peakHour'],
            conclusion:  'intercontinental_peak_warning',
            severity:    2,
            explanation: 'Intercontinental trip at peak hour — expect +40–55% delay on bridge/tunnel.'
        },
        {
            id: 'R5',
            premises:    ['rain', 'accident'],
            conclusion:  'severe_weather_accident',
            severity:    3,
            explanation: 'Rain + accident on route → Severely reduced visibility and capacity.'
        },
        {
            id: 'R6',
            premises:    ['roadwork', 'westSide'],
            conclusion:  'west_roadwork_warning',
            severity:    2,
            explanation: 'Road works in E-5/TEM zone — alternative route strongly recommended.'
        },
        {
            id: 'R7',
            premises:    ['longRoute', 'peakHour', 'intercontinental'],
            conclusion:  'maximum_risk_state',
            severity:    3,
            explanation: 'Long intercontinental route at peak hour — maximum risk state. Consider postponing or using Marmaray.'
        },

        // ── Extended rules (Logic Engineer — chained inference) ────────
        {
            id: 'R8',
            premises:    ['ferry_or_marmaray_strongly_advised', 'rain'],
            conclusion:  'marmaray_only_advised',
            severity:    3,
            explanation: 'Ferry strongly advised but rain also active → Marmaray (undersea) only. Ferry boarding may be delayed.'
        },
        {
            id: 'R9',
            premises:    ['high_delay_risk', 'peakHour'],
            conclusion:  'maximum_risk_state',
            severity:    3,
            explanation: 'High delay risk compounded by peak hour → Maximum risk state reached via chained inference.'
        },
        {
            id: 'R10',
            premises:    ['maximum_risk_state'],
            conclusion:  'suggest_postpone_or_remote',
            severity:    3,
            explanation: 'Maximum risk state detected → Consider postponing trip or working remotely if possible.'
        }
    ];

    // ── Fixpoint forward chaining ─────────────────────────────────
    /**
     * runForwardChain
     * ---------------
     * Repeatedly applies LOGIC_RULES until no new facts are derived
     * (fixpoint).  This enables multi-step chaining (R1 conclusion
     * can trigger R8, etc.) unlike the single-pass design in
     * math_model.js.
     *
     * @param {Set<string>} initialFacts  — active factor keys
     * @returns {{ facts: Set<string>, fired: object[] }}
     */
    function runForwardChain(initialFacts) {
        const facts  = new Set(initialFacts);
        const fired  = [];
        let changed  = true;

        while (changed) {
            changed = false;
            LOGIC_RULES.forEach(rule => {
                if (facts.has(rule.conclusion)) return;  // already known
                if (rule.premises.every(p => facts.has(p))) {
                    facts.add(rule.conclusion);
                    fired.push(rule);
                    changed = true;
                }
            });
        }

        return { facts, fired };
    }

    // ── Public API ────────────────────────────────────────────────
    /**
     * run(ctx)
     * --------
     * @param {{ activeFactorKeys: string[] }} ctx
     * @returns {{
     *   conclusions : Array<{id, conclusion, severity, explanation}>,
     *   severity    : number,   // max severity of fired rules (0 if none)
     *   facts       : string[]  // all facts after forward chaining
     * }}
     */
    function run(ctx) {
        const initial = new Set(ctx.activeFactorKeys || []);
        const { facts, fired } = runForwardChain(initial);

        const conclusions = fired.map(r => ({
            id:          r.id,
            conclusion:  r.conclusion,
            severity:    r.severity,
            explanation: r.explanation
        }));

        const maxSeverity = conclusions.reduce((m, c) => Math.max(m, c.severity), 0);

        return {
            conclusions,
            severity: maxSeverity,
            facts:    Array.from(facts)
        };
    }

    window.LogicEngine = {
        run,
        runForwardChain,
        LOGIC_RULES
    };

    console.info('[LogicEngine] Propositional logic module loaded — COE017 Logic Engineer');
    console.info(`[LogicEngine] Rule base: ${LOGIC_RULES.length} rules (${LOGIC_RULES.filter(r=>r.id>='R8').length} chained)`);
})();
