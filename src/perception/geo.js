// src/perception/geo.js

// Haversine formülü ile iki koordinasyon arası mesafe (km)
export function haversineDistance(coord1, coord2) {
  const R = 6371; // Dünya yarıçapı (km)

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


// Avrupa - Anadolu (intercontinental) kontrolü (çok basit yaklaşım)
export function isIntercontinental(coord1, coord2) {
  // İstanbul için kaba sınır: boğazın batısı Avrupa, doğusu Anadolu
  const isEurope = (coord) => coord.lng < 29;

  return isEurope(coord1) !== isEurope(coord2);
}


// Batı yakası yoğunluk (basit heuristic)
export function isWestSide(coord) {
  return coord.lng < 28.8;
}
