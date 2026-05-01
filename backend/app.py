from flask import Flask, request, jsonify
from flask_cors import CORS
import json
import math
import os
import random
from datetime import datetime

app = Flask(__name__)
CORS(app, resources={r"/api/*": {"origins": "*"}})

BASE_DIR = os.path.dirname(__file__)
INCIDENTS_FILE = os.path.join(BASE_DIR, "incidents-snapshot.json")
PHRASE_FILE = os.path.join(BASE_DIR, "phrases.json")

DELAY_FACTORS = {
    "accident": {"base": 0.350, "variance": 0.060},
    "rain": {"base": 0.180, "variance": 0.055},
    "roadwork": {"base": 0.220, "variance": 0.065},
    "breakdown": {"base": 0.140, "variance": 0.045},
    "peakHour": {"base": 0.333, "variance": 0.090},
    "intercontinental": {"base": 0.418, "variance": 0.095},
    "westSide": {"base": 0.343, "variance": 0.085},
    "longRoute": {"base": 0.272, "variance": 0.090},
    "normal": {"base": 0.022, "variance": 0.015}
}

CONFIDENCE_PARAMS = {
    "base": 0.94,
    "perIncident": 0.06,
    "longRoute": 0.08,
    "intercontinental": 0.07,
    "peakHour": 0.05,
    "min": 0.42
}


def load_incidents():
    try:
        with open(INCIDENTS_FILE, "r", encoding="utf-8") as file:
            data = json.load(file)
            return data.get("incidents", [])
    except FileNotFoundError:
        print("incidents-snapshot.json not found.")
        return []
    except json.JSONDecodeError:
        print("incidents-snapshot.json format error.")
        return []


def calculate_distance(lat1, lon1, lat2, lon2):
    radius = 6371

    d_lat = math.radians(lat2 - lat1)
    d_lon = math.radians(lon2 - lon1)

    a = (
        math.sin(d_lat / 2) ** 2
        + math.cos(math.radians(lat1))
        * math.cos(math.radians(lat2))
        * math.sin(d_lon / 2) ** 2
    )

    return radius * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def get_active_incidents_on_route(start_lat, start_lon, end_lat, end_lon):
    incidents = load_incidents()

    mid_lat = (start_lat + end_lat) / 2
    mid_lon = (start_lon + end_lon) / 2

    active_incidents = []

    for incident in incidents:
        incident_lat = incident.get("lat")
        incident_lon = incident.get("lon")
        radius = incident.get("radius", 2)

        if incident_lat is None or incident_lon is None:
            continue

        d_to_start = calculate_distance(start_lat, start_lon, incident_lat, incident_lon)
        d_to_end = calculate_distance(end_lat, end_lon, incident_lat, incident_lon)
        d_to_mid = calculate_distance(mid_lat, mid_lon, incident_lat, incident_lon)

        if min(d_to_start, d_to_end, d_to_mid) <= radius:
            active_incidents.append(incident)

    return active_incidents


def is_peak_hour():
    now = datetime.now()
    total_minutes = now.hour * 60 + now.minute

    morning_peak = 450 <= total_minutes <= 570
    evening_peak = 1020 <= total_minutes <= 1200

    return morning_peak or evening_peak


def sample_factor_probability(factor_key):
    factor = DELAY_FACTORS.get(factor_key)

    if not factor:
        return 0

    sampled_value = random.gauss(factor["base"], factor["variance"])

    return max(0, min(1, sampled_value))


def calculate_delay_probability(active_factors):
    complement = 1.0
    sampled_factors = {}

    for factor in active_factors:
        sampled_probability = sample_factor_probability(factor)
        sampled_factors[factor] = round(sampled_probability, 3)
        complement *= (1 - sampled_probability)

    delay_probability = 1 - complement

    return max(0, min(1, delay_probability)), sampled_factors


def build_active_factors(distance, start_lon, end_lon, active_incidents):
    active_factors = []

    is_intercontinental = (
        (start_lon < 29.0 and end_lon > 29.0)
        or (start_lon > 29.0 and end_lon < 29.0)
    )

    is_west_side = start_lon < 28.8 and end_lon < 28.9

    if is_intercontinental:
        active_factors.append("intercontinental")

    if is_west_side:
        active_factors.append("westSide")

    if distance > 15:
        active_factors.append("longRoute")

    peak = is_peak_hour()

    if peak:
        active_factors.append("peakHour")

    for incident in active_incidents:
        factor_key = incident.get("factorKey")

        if factor_key and factor_key not in active_factors:
            active_factors.append(factor_key)

    if not active_factors:
        active_factors.append("normal")

    return active_factors, is_intercontinental, is_west_side, peak


def calculate_confidence(distance, is_intercontinental, peak_hour, active_incidents):
    confidence = CONFIDENCE_PARAMS["base"]

    confidence -= len(active_incidents) * CONFIDENCE_PARAMS["perIncident"]

    if distance > 15:
        confidence -= CONFIDENCE_PARAMS["longRoute"]

    if is_intercontinental:
        confidence -= CONFIDENCE_PARAMS["intercontinental"]

    if peak_hour:
        confidence -= CONFIDENCE_PARAMS["peakHour"]

    confidence += random.gauss(0, 0.02)
    confidence = max(CONFIDENCE_PARAMS["min"], min(0.99, confidence))

    return round(confidence * 100)


def build_decision(delay_percent):
    if delay_percent >= 70:
        return (
            "High delay risk detected",
            "Strongly recommend alternative route",
            "Use public transport or an alternative route."
        )

    if delay_percent >= 50:
        return (
            "Moderate delay risk detected",
            "Alternative route recommended",
            "Check alternative routes before starting."
        )

    return (
        "Low delay risk detected",
        "Current route is acceptable",
        "Current route is suitable."
    )


@app.route("/")
def home():
    return jsonify({
        "message": "Istanbul Autonomous Journey Assistant Backend is running",
        "status": "ok"
    })

@app.route("/api/health", methods=["GET"])
def health():
    return jsonify({
        "status": "ok",
        "message": "Backend health check successful"
    })


@app.route("/api/incidents", methods=["GET"])
def get_incidents():
    incidents = load_incidents()

    return jsonify({
        "count": len(incidents),
        "incidents": incidents
    })

@app.route("/api/delay-factors", methods=["GET"])
def get_delay_factors():
    return jsonify({
        "DELAY_FACTORS": DELAY_FACTORS,
        "CONFIDENCE_PARAMS": CONFIDENCE_PARAMS,
        "TRANSIT_INSULATION": 0.55
    })


@app.route("/api/phrases", methods=["GET"])
def get_phrases():
    try:
        if not os.path.exists(PHRASE_FILE):
            return jsonify([])

        with open(PHRASE_FILE, "r", encoding="utf-8") as file:
            data = json.load(file)

        return jsonify(data)
    except json.JSONDecodeError:
        return jsonify([])
    except Exception as error:
        return jsonify({
            "status": "error",
            "message": str(error)
        }), 500


@app.route("/api/phrases", methods=["POST"])
def save_phrases():
    try:
        data = request.get_json()

        if data is None:
            data = []

        with open(PHRASE_FILE, "w", encoding="utf-8") as file:
            json.dump(data, file, ensure_ascii=False, indent=2)

        return jsonify({
            "status": "ok",
            "message": "Phrases saved successfully"
        })
    except Exception as error:
        return jsonify({
            "status": "error",
            "message": str(error)
        }), 500


@app.route("/api/analyze", methods=["POST"])
def analyze_route():
    data = request.get_json()

    selected_route = data.get("route", "Unknown Route")

    start_lat = float(data.get("startLat", 41.0422))
    start_lon = float(data.get("startLon", 29.0075))
    target_lat = float(data.get("targetLat", 41.0082))
    target_lon = float(data.get("targetLon", 28.9784))

    distance = calculate_distance(start_lat, start_lon, target_lat, target_lon)

    active_incidents = get_active_incidents_on_route(
        start_lat,
        start_lon,
        target_lat,
        target_lon
    )

    active_factors, is_intercontinental, is_west_side, peak_hour = build_active_factors(
        distance,
        start_lon,
        target_lon,
        active_incidents
    )

    delay_probability, sampled_factors = calculate_delay_probability(active_factors)

    delay_percent = round(delay_probability * 100)

    base_time = round((distance / 25) * 60 + 10)
    expected_delay = round(base_time * delay_probability)

    confidence = calculate_confidence(
        distance,
        is_intercontinental,
        peak_hour,
        active_incidents
    )

    status, decision, recommendation = build_decision(delay_percent)

    factors_text = ", ".join(active_factors)

    ai_inference = (
        f"AI INFERENCE: {status} — "
        f"delay risk {delay_percent}%, "
        f"confidence {confidence}%. "
        f"Factors: {factors_text}. "
        f"{recommendation}"
    )

    return jsonify({
        "route": selected_route,
        "distance": round(distance, 2),
        "delayPercent": delay_percent,
        "confidence": confidence,
        "baseTime": base_time,
        "expectedDelay": expected_delay,
        "activeFactors": active_factors,
        "sampledFactors": sampled_factors,
        "activeIncidents": active_incidents,
        "peakHour": peak_hour,
        "isIntercontinental": is_intercontinental,
        "isWestSide": is_west_side,
        "status": status,
        "decision": decision,
        "recommendation": recommendation,
        "aiInference": ai_inference
    })


@app.route("/analyze", methods=["POST"])
def analyze_route_short():
    return analyze_route()


if __name__ == "__main__":
    app.run(debug=True)