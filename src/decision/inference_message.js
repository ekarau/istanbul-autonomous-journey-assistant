// src/decision/inference_message.js

export function buildInferenceMessage({
  routeName,
  distanceKm,
  durationMin,
  activeIncidents = [],
  isPeakHour = false,
  score,
  recommendation
}) {
  const incidentText =
    activeIncidents.length > 0
      ? `${activeIncidents.length} trafik olayı tespit edildi`
      : "Aktif trafik olayı tespit edilmedi";

  const peakText = isPeakHour
    ? "Yoğun saat aralığında"
    : "Yoğun saat dışında";

  return `
Rota: ${routeName}
Mesafe: ${distanceKm} km
Tahmini Süre: ${durationMin} dakika
Trafik Durumu: ${incidentText}
Zaman Durumu: ${peakText}
Skor: ${score}
Öneri: ${recommendation}
  `.trim();
}
