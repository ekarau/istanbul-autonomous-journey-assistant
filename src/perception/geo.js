// src/perception/geo.js

// Calculates distance between two coordinates using Haversine formula (in km)
export function haversineDistance(coord1, coord2) {
  const R = 6371; // Earth radius in kilometers

  const toRad = (deg) => (deg * Math.PI) / 180;

  const dLat = toRad(coord2.lat - coord1.lat);
  const dLon = toRad(coord2.lng - coord1.lng);

  const lat1 = toRad(coord1.lat);
  const lat2 = toRad(coord2.lat);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLon / 2) ** 2 *
      Math.cos(lat1) *
      Math.cos(lat2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}


// Checks if route crosses between Europe and Asia (Istanbul-specific logic)
export function isIntercontinental(coord1, coord2) {
  // Rough boundary: west of Bosphorus = Europe, east = Asia
  const isEurope = (coord) => coord.lng < 29;

  return isEurope(coord1) !== isEurope(coord2);
}


// Determines if a coordinate is on the west side (used for traffic heuristics)
export function isWestSide(coord) {
  return coord.lng < 28.8;
}
