# Istanbul Autonomous Journey Assistant — Architecture

COE017 · Principles of AI · Applied Group Project

---

## Rational Agent Model

The system implements a **four-layer rational agent loop**:

```
┌──────────────────────────────────────────────────────────────────┐
│                      RATIONAL AGENT LOOP                         │
│                                                                  │
│  ┌─────────────┐   ┌──────────────┐   ┌─────────────────────┐   │
│  │  PERCEPTION │ → │   REASONING  │ → │    OPTIMIZATION     │   │
│  │  Layer 1    │   │   Layer 2    │   │    Layer 3          │   │
│  └─────────────┘   └──────────────┘   └─────────────────────┘   │
│         │                 │                    │                 │
│         ▼                 ▼                    ▼                 │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │                    ACTION / UI  (Layer 4)                │    │
│  │       Leaflet map · route cards · math/SA panels         │    │
│  └──────────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────────┘
```

---

## Module Map

### Layer 1 — Perception
| File | Window API | Responsibility |
|------|-----------|----------------|
| `src/data/delay_factors.js` | `window.DELAY_FACTORS_DATA` | Single-source constants (IBB/TÜİK data) |
| `src/perception/geo.js` | `window.GeoUtils` | Haversine distance, Bosphorus side detection |
| `src/perception/incidents.js` | `window.IncidentDetector` | Route-to-incident-zone intersection |
| `src/perception/peak_hour.js` | `window.PeakHour` | Peak hour window detection |

### Layer 2 — Reasoning
| File | Window API | Responsibility |
|------|-----------|----------------|
| `src/math/math_model.js` | `window.MathModel` | Feature vectors, dot product, probability union, Modus Ponens engine |
| `src/math/linear_algebra.js` | `window.LinearAlgebra` | dotProduct, l2Norm, routeScoreMatrix, cosineSimilarity |
| `src/math/probability.js` | `window.ProbabilityUtils` | Gaussian sampler, probabilityUnion, expectedDelay, shannonEntropy |
| `src/math/logic_engine.js` | `window.LogicEngine` | 10-rule propositional logic base, fixpoint forward chaining |
| `src/decision/route_decision.js` | `window.RouteDecision` | Route scoring, recommendation |
| `src/decision/agent.js` | *(main)* | Decision orchestration, UI wiring |

### Layer 3 — Optimization
| File | Window API | Responsibility |
|------|-----------|----------------|
| `src/optimization/baseline_greedy.js` | `window.GreedyBaseline` | Greedy shortest-time baseline |
| `src/optimization/optimizer.js` | `window.Optimizer` | Hill Climbing + RMSE evaluation |
| `src/optimization/simulated_annealing.js` | `window.SimulatedAnnealing` | SA with Metropolis criterion, geometric cooling |

### Layer 4 — Monitoring / Action
| File | Window API | Responsibility |
|------|-----------|----------------|
| `src/monitoring/evaluator.js` | `window.Evaluator` | Win-rate comparison, RMSE benchmark |
| `src/monitoring/metrics_panel.js` | `window.MetricsPanel` | Live metrics rendering |
| `public/index.html` | — | UI layout |
| `public/style.css` | — | Dark-theme design system |

---

## Data Flow

```
User Input (origin / destination)
        │
        ▼
  resolveStart()  ──→  [validation: null if unset → user warning]
        │
        ▼
  GeoUtils.haversineDistance()
  GeoUtils.isIntercontinental()
  IncidentDetector.getActiveIncidentsOnRoute()
  PeakHour.isPeakHour()
        │
        ▼
  MathModel.buildFeatureVector(activeKeys)   → x ∈ ℝ⁹
  MathModel.dotProduct(w, x)                → linearScore
  MathModel.l2Norm(x)                       → l2Risk
  MathModel.probabilityUnion(activeKeys)    → P(delay)
  MathModel.expectedDelay(baseTime, keys)   → E[D], σ[D], 95% CI
  LogicEngine.run({ activeFactorKeys })     → conclusions (chained MP)
        │
        ▼
  window.SUGGESTED_ROUTES = [ route₁, route₂, … ]
        │
        ├──→  Optimizer.appendOptimizerPanel()   (Hill Climbing)
        └──→  SimulatedAnnealing.appendSAPanel() (Metropolis criterion)
        │
        ▼
  UI: route cards, Math panel, SA panel, Logic conclusions,
      dynamic traffic badge, delay bar, confidence stars
```

---

## Script Loading Order (`public/index.html`)

```
1. delay_factors.js       ← constants (no deps)
2. geo.js                 ← reads nothing from window
3. incidents.js           ← reads window.DELAY_FACTORS_DATA
4. peak_hour.js           ← reads window.DELAY_FACTORS_DATA
5. route_decision.js      ← reads window.GeoUtils, IncidentDetector, PeakHour
6. math_model.js          ← reads window.DELAY_FACTORS
7. linear_algebra.js      ← reads window.MathModel (lazy delegate)
8. logic_engine.js        ← standalone (no window deps)
9. probability.js         ← reads window.MathModel + DELAY_FACTORS
10. optimizer.js
11. baseline_greedy.js
12. simulated_annealing.js
13. evaluator.js
14. metrics_panel.js
15. agent.js              ← reads all of the above
```

---

## Key Design Decisions

**Single source of truth for constants:**  
`delay_factors.js` defines all IBB/TÜİK-derived coefficients once.  All other modules read from `window.DELAY_FACTORS_DATA`.  Previously these values were duplicated in agent.js, math_model.js, and delay_factors.js with no sync guarantee.

**IIFE pattern (no bundler required):**  
Every module uses an immediately-invoked function expression and exposes a named API on `window.*`.  This allows plain `<script>` loading without Webpack/Rollup while still maintaining encapsulation.

**resolveStart() validation:**  
The start-location resolver no longer silently falls back to Beşiktaş (41.0422, 29.0075).  If no origin is set it surfaces a user-facing error and returns null, which the callers check for before proceeding.

**Logic Engine — fixpoint forward chaining:**  
`logic_engine.js` implements a fixpoint iteration loop rather than a single-pass scan.  This allows conclusions (e.g. `ferry_or_marmaray_strongly_advised`) to serve as premises for further rules (e.g. `marmaray_only_advised`), qualifying as multi-step propositional inference.
