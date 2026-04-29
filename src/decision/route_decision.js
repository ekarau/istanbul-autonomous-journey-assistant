import { haversineDistance, isIntercontinental, isWestSide } from "../perception/geo.js";
import { getActiveIncidentsOnRoute } from "../perception/incidents.js";
import { isPeakHour } from "../perception/peak_hour.js";
import { buildInferenceMessage } from "./inference_message.js";

export function evaluateRoute(route) {
  const {
    name,
    points,
    baseDurationMin
  } = route;

  let distance = 0;
  for (let i = 0; i < points.length - 1; i++) {
    distance += haversineDistance(points[i], points[i + 1]);
  }

  const incidents = getActiveIncidentsOnRoute(points, haversineDistance);
  const peak = isPeakHour();
  const intercontinental = isIntercontinental(points[0], points[points.length - 1]);

  let score = 100;

  score -= distance * 2;
  score -= incidents.length * 10;

  if (peak) score -= 15;
  if (intercontinental) score -= 20;

  const recommendation =
    score > 70
      ? "Recommended"
      : score > 40
      ? "Acceptable"
      : "Avoid";

  const message = buildInferenceMessage({
    routeName: name,
    distanceKm: distance.toFixed(2),
    durationMin: baseDurationMin,
    activeIncidents: incidents,
    isPeakHour: peak,
    score: score.toFixed(0),
    recommendation
  });

  return {
    score,
    recommendation,
    message,
    incidents,
    distance
  };
}
