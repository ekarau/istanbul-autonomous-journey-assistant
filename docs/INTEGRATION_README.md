# Math Model Entegrasyon Kılavuzu
**COE017 – Istanbul Autonomous Journey Assistant**
Mathematical Modeler → Integration Engineer

---

## Dosya Yapısı

```
istanbul-journey-assistant/
├── index.html          ← UI/UX Designer'ın dosyası (math_model.js <script> eklendi)
├── style.css           ← UI/UX Designer'ın dosyası (değişiklik yok)
├── app.js              ← Data & Simulation Engineer'ın dosyası (2 yerde güncelleme lazım)
├── math_model.js       ← Mathematical Modeler'ın yeni dosyası (dokunma)
└── INTEGRATION_README.md
```

---

## index.html — Yapılan Değişiklik

`math_model.js` script etiketi zaten eklendi, bir şey yapman gerekmiyor.
Kontrol etmek istersen `</body>` öncesinde şu sırayı görmelisin:

```html
<script src="math_model.js"></script>
<script src="app.js"></script>
```

Sıra önemli: math_model.js önce yüklenmeli çünkü app.js onu kullanıyor.

---

## app.js — Yapman Gereken 2 Değişiklik

### Değişiklik 1 — simulateAIDecision fonksiyonu (~satır 343)

Mevcut fonksiyonun içine, `const risk = computeRouteRisk(routeCtx);` satırından
hemen SONRA şu bloğu ekle:

```javascript
// ── MATH MODEL ENTEGRASYONU ──────────────────────────────────
const activeKeys = [];
if (activeIncidents.length === 0 && !isIntercontinental && !isWestSide) activeKeys.push('normal');
if (isIntercontinental)  activeKeys.push('intercontinental');
if (isWestSide)          activeKeys.push('westSide');
if (distance > 15)       activeKeys.push('longRoute');
if (isPeakHour())        activeKeys.push('peakHour');
activeIncidents.forEach(inc => {
    if (!activeKeys.includes(inc.factorKey)) activeKeys.push(inc.factorKey);
});

const baseCarTime = Math.round((distance / 25) * 60 + 10);

const routeVectors = [
    MathModel.buildFeatureVector(activeKeys),
    MathModel.buildFeatureVector(activeKeys.filter(k => k !== 'westSide')),
    MathModel.buildFeatureVector(activeKeys.filter(k => !['accident','breakdown','roadwork','westSide'].includes(k))),
    MathModel.buildFeatureVector(activeKeys.filter(k => !['accident','breakdown','roadwork','westSide','intercontinental'].includes(k)))
];

window.lastMathResult = MathModel.computeFullModel({
    activeFactorKeys: activeKeys,
    baseTimeMin:      baseCarTime,
    routeVectors
});
// ─────────────────────────────────────────────────────────────
```

---

### Değişiklik 2 — showContextRoutes fonksiyonu (~satır 406)

Fonksiyonun en sonuna, `updateStats(best.delay, best.conf);` satırından
hemen SONRA şu satırı ekle:

```javascript
appendMathPanel();
```

Sonra `showContextRoutes` fonksiyonunun DIŞINA (ama hâlâ `DOMContentLoaded`
içinde) şu fonksiyonu yapıştır:

```javascript
function appendMathPanel() {
    if (!window.lastMathResult) return;
    const m = window.lastMathResult;

    const severityColor = ['', '#2ECC71', '#FFA500', '#FF4D4D'];
    const severityLabel = ['', 'INFO', 'WARNING', 'CRITICAL'];

    const conclusionHTML = m.logicResult.conclusions.map(c => `
        <div style="
            margin-top:6px;padding:6px 10px;border-radius:8px;
            border-left:3px solid ${severityColor[c.severity]};
            background:rgba(255,255,255,0.03);
            font-size:0.72rem;color:var(--text-secondary);line-height:1.4;">
            <span style="color:${severityColor[c.severity]};font-weight:700;font-size:0.7rem;">
                [${severityLabel[c.severity]}]
            </span>
            ${c.explanation}
        </div>
    `).join('');

    const panel = document.createElement('div');
    panel.className = 'card';
    panel.style.marginTop = '12px';
    panel.innerHTML = `
        <div class="ai-header" style="margin-bottom:10px;">
            <i class="fa-solid fa-square-root-variable" style="color:var(--accent-color)"></i>
            <span style="font-size:0.8rem;">Mathematical Analysis</span>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px;">
            <div style="text-align:center;padding:8px;background:rgba(255,255,255,0.03);border-radius:8px;">
                <div style="font-size:0.65rem;color:var(--text-secondary);margin-bottom:4px;">‖x‖₂ Risk Norm</div>
                <div style="font-size:1rem;font-weight:700;color:var(--accent-color);">${m.l2Risk}</div>
            </div>
            <div style="text-align:center;padding:8px;background:rgba(255,255,255,0.03);border-radius:8px;">
                <div style="font-size:0.65rem;color:var(--text-secondary);margin-bottom:4px;">Linear Score (w·x)</div>
                <div style="font-size:1rem;font-weight:700;color:var(--accent-color);">${(m.linearScore * 100).toFixed(1)}%</div>
            </div>
        </div>
        <div style="font-size:0.72rem;color:var(--text-secondary);line-height:1.9;margin-bottom:8px;">
            <span style="color:var(--text-primary);font-weight:600;">E[D]</span> = <span style="color:var(--accent-color);">${m.delayStats.E} min</span>
            &nbsp;|&nbsp;
            <span style="color:var(--text-primary);font-weight:600;">σ[D]</span> = <span style="color:var(--accent-color);">${m.delayStats.sigma} min</span>
            <br>
            <span style="color:var(--text-primary);font-weight:600;">95% CI</span>: [${m.delayStats.ciLow}, ${m.delayStats.ciHigh}] min
            &nbsp;|&nbsp;
            <span style="color:var(--text-primary);font-weight:600;">P(delay)</span>: ${(m.probabilityResult.prob * 100).toFixed(1)}%
        </div>
        <div style="font-size:0.7rem;color:var(--text-secondary);font-weight:600;margin-bottom:4px;
                    text-transform:uppercase;letter-spacing:0.5px;">Logic Engine (Modus Ponens)</div>
        ${conclusionHTML || '<div style="font-size:0.72rem;color:var(--text-secondary);padding:4px 0;">No rules fired — low risk state.</div>'}
        <div style="margin-top:10px;font-size:0.65rem;color:rgba(255,255,255,0.2);text-align:right;">
            Blended: α=0.70 × P_union + 0.30 × w·x
        </div>
    `;
    document.getElementById('routes-list').appendChild(panel);
}
```

---

## Test Etme

1. Klasörü tarayıcıda aç (`index.html` → Live Server ya da doğrudan)
2. Browser console'u aç (F12)
3. Sayfa yüklendiğinde console'da şunu görmelisin:
   `[MathModel] Module loaded — COE017 Mathematical Modeler`
   Ve altında 9 satırlık faktör tablosu.
4. Herhangi bir destinasyon ara → "Analyze Route" tıkla
5. Sol panelde **Mathematical Analysis** kartı belirmelidir.

---

## Sorun Çıkarsa

- `MathModel is not defined` hatası → index.html'de script sırası yanlış,
  math_model.js app.js'den önce gelmiyor.
- Panel çıkmıyor ama hata yok → `appendMathPanel()` çağrısı eklenmemiş olabilir.
- Herhangi bir sorun için mesaj at.

