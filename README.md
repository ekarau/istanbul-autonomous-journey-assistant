# Istanbul Autonomous Journey Assistant

COE017 — Principles of AI · Final Project

## Team

| Name   | Role                                    |
|--------|-----------------------------------------|
| Ege    | Project Manager & Evaluation Specialist |
| Hacer  | Lead Developer                          |
| Su     | Lead Developer                          |
| Emre   | UI/UX Designer                          |
| Tuğba  | Mathematical Modeler                    |
| Zuhal  | Logic Engineer                          |
| Dilara | Optimization Specialist                 |
| Selvi  | Data & Simulation Engineer              |
| Vedat  | Integration & System Engineer           |

## How to Run

The project is a browser-only frontend, no build step required.

1. Clone the repository.
2. Open `public/index.html` directly in a modern browser (Chrome, Edge, Firefox).
3. Type an Istanbul destination in the search bar and click **Analyze Route**.
4. To compare optimizers, click the flask icon (bottom-right) to open the Optimizer Benchmark, then click **Run**.

**Note:** Address auto-complete uses the public Nominatim (OpenStreetMap) endpoint, which is rate-limited to ~1 request/second. If suggestions stop appearing during the demo, wait a few seconds.

