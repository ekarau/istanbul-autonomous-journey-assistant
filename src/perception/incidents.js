// src/perception/incidents.js

// Predefined traffic incident zones used by the decision system
export const INCIDENT_ZONES = [
  {
    id: 1,
    name: "15 July Martyrs Bridge Traffic",
    type: "bridge_congestion",
    severity: 3,
    lat: 41.0422,
    lng: 29.0323,
    radiusKm: 2.5
  },
  {
    id: 2,
    name: "FSM Bridge Traffic",
    type: "bridge_congestion",
    severity: 3,
    lat: 41.0910,
    lng: 29.0610,
    radiusKm: 2.5
  },
  {
    id: 3,
    name: "Kadikoy Center Congestion",
    type: "urban_congestion",
    severity: 2,
    lat: 40.9903,
    lng: 29.0275,
    radiusKm: 2
  },
  {
    id: 4,
    name: "Mecidiyekoy Traffic Density",
    type: "urban_congestion",
    severity: 2,
    lat: 41.0670,
    lng: 28.9850,
    radiusKm: 2
  }
];


// Finds active incidents close to the selected route points
export function getActiveIncidentsOnRoute(routePoints, distanceFn) {
  if (!Array.isArray(routePoints) || typeof distanceFn !== "function") {
    return [];
  }

  return INCIDENT_ZONES.filter((incident) => {
    return routePoints.some((point) => {
      const distance = distanceFn(point, {
        lat: incident.lat,
        lng: incident.lng
      });

      return distance <= incident.radiusKm;
    });
  });
}
