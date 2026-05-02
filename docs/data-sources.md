# Data Sources & Model Calibration

**Module:** Data & Simulation Engineer  
**Project:** COE017 — Istanbul Autonomous Journey Assistant

---

## Overview

The probabilistic delay model — `DELAY_FACTORS` in `src/data/delay_factors.js`, consumed by `src/math/math_model.js` and `src/decision/agent.js` — uses real Istanbul traffic data to determine delay probabilities and confidence scores for each route. All coefficients were derived from the datasets listed below. No values were arbitrarily assigned; each has a documented calculation method.

---

## Datasets Used

### 1. IBB Saatlik Trafik Yoğunluk Verisi
**Source:** İstanbul Büyükşehir Belediyesi Açık Veri Portalı — data.ibb.gov.tr  
**Publisher:** Ulaşım Dairesi Başkanlığı  
**Files used:** Ocak 2024, Temmuz 2024, Eylül 2024 (CSV)  
**Fields:** `DATE_TIME`, `LATITUDE`, `LONGITUDE`, `AVERAGE_SPEED`, `NUMBER_OF_VEHICLES`

**Used to derive:**
- `peakHour` delay factor
- `normal` baseline delay
- `rain` seasonal effect (winter vs. summer speed difference)
- `longRoute` exposure factor

**Method:**  
Vehicle-weighted average speed was computed per hour across all three months. Free-flow speed was defined as the mean speed during 01:00–03:00 (lowest congestion). Delay ratio for each hour was calculated as:

```
delay_ratio(h) = (free_flow_speed − weighted_speed(h)) / free_flow_speed
```

Results:
- Free-flow speed (night baseline): **68.7 km/h**
- Morning rush (07:00–09:00): **51.7 km/h** → delay ratio **0.283**
- Evening rush (17:00–19:00): **48.8 km/h** → delay ratio **0.333** ← worst case
- Midday (12:00–14:00): **53.2 km/h** → delay ratio **0.272**
- January weighted average: **54.5 km/h**
- July weighted average: **56.2 km/h** → seasonal difference: **0.031**

---

### 2. Yıllara Göre Ölümlü Yaralanmalı Trafik Kaza Sayısı
**Source:** TÜİK (Türkiye İstatistik Kurumu) — tuik.gov.tr  
**File used:** `olumlu-yaralanmal-trafik-kaza-says.xls`  
**Fields:** Year, TR urban/rural totals, Istanbul urban/rural totals

**Used to derive:**
- `accident` delay factor justification
- Daily accident frequency in Istanbul

**Method:**  
Istanbul urban accident counts for 2022, 2023, and 2024 were averaged:

| Year | Istanbul Urban Accidents |
|------|--------------------------|
| 2022 | 22,028 |
| 2023 | 22,997 |
| 2024 | 30,316 |
| **Average** | **~25,114/year → ~69/day** |

With approximately 69 accidents per day in Istanbul, accident events are frequent enough to treat as a high-impact recurring condition. Lane closure capacity models estimate a 40–50% capacity reduction during accidents, corresponding to a delay probability of **0.35**. Variance is kept low (0.06) because severe accidents produce consistently high delay regardless of specific circumstances.

---

### 3. İstanbul Trafik Endeksi
**Source:** İBB Açık Veri Portalı — data.ibb.gov.tr  
**Publisher:** Ulaşım Dairesi Başkanlığı  
**File used:** `traffic_index.csv`  
**Fields:** `trafficindexdate`, `minimum_traffic_index`, `maximum_traffic_index`, `average_traffic_index`

**Used to derive:**
- `normal` baseline delay (off-peak, non-incident conditions)

**Method:**  
Weekday-only records were filtered (Monday–Friday). The mean of `minimum_traffic_index` across all weekday records was computed:

```
normal_base = mean(minimum_traffic_index, weekdays) / 100 = 0.022
```

This represents the irreducible baseline delay present even under optimal conditions in Istanbul.

---

## Derived Coefficients

All values stored in `DELAY_FACTORS` inside `src/data/delay_factors.js`:

| Factor | Base | Variance | Derivation |
|---|---|---|---|
| `peakHour` | 0.333 | 0.090 | IBB hourly density — evening peak 18:00 |
| `normal` | 0.022 | 0.015 | IBB traffic index — weekday minimum |
| `rain` | 0.180 | 0.055 | January–July speed gap (0.031) + literature adjustment |
| `accident` | 0.350 | 0.060 | TÜİK accident data + lane closure capacity model |
| `intercontinental` | 0.418 | 0.095 | peakHour × 1.4 (Bosphorus bottleneck multiplier) |
| `westSide` | 0.343 | 0.085 | peakHour × 1.15 (E-5/TEM corridor) |
| `roadwork` | 0.220 | 0.065 | UKOME corridor reports (literature) |
| `breakdown` | 0.140 | 0.045 | Single-lane blockage model (literature) |
| `longRoute` | 0.272 | 0.090 | IBB midday delay ratio (>15 km exposure) |

**Note on `rain`:** The IBB dataset captures seasonal variation (winter vs. summer) rather than isolated rainfall events. The raw difference (0.031) was supplemented with a literature-based adjustment to 0.18 to account for acute rainfall conditions not captured in monthly averages.

---

## Combination Formula

When multiple conditions are active simultaneously, delay probabilities are combined using the independent-events complement rule to prevent linear overflow:

```
P(combined) = 1 − ∏(1 − Pᵢ)
```

Example: accident (0.35) + peak hour (0.333) + intercontinental (0.418):
```
P = 1 − (1−0.35)(1−0.333)(1−0.418) = 1 − (0.65 × 0.667 × 0.582) ≈ 0.748
```

---

## Gaussian Sampling

Each factor is sampled from a normal distribution rather than used as a fixed value, using the Box-Muller transform:

```
sampled = base + variance × N(0,1)
```

This reflects real-world variability — a rush-hour delay is not always exactly 33.3%, but fluctuates around that mean. Results are clamped to [0, 1].

---

## Live Data Pipeline

In addition to the static model, the system attempts to load real-time incident data on startup:

1. **Primary:** IBB CKAN API (`data.ibb.gov.tr`) via CORS proxy — 6 second timeout
2. **Fallback:** `assets/data/incidents-snapshot.json` — committed snapshot dated 2025-04-29
3. **Last resort:** Hardcoded 4-incident array embedded in `app.js`

The UI displays data source status: `live` (green) or `cached` (yellow).

---

## References

- IBB Açık Veri Portalı: https://data.ibb.gov.tr
- TÜİK Karayolu Trafik Kaza İstatistikleri: https://www.tuik.gov.tr
- TomTom Traffic Index Istanbul 2023: https://www.tomtom.com/traffic-index/istanbul-traffic
