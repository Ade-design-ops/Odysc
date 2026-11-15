// USC University Park buildings used by club events. Coordinates come from OpenStreetMap
// (Nominatim search, © OpenStreetMap contributors, ODbL). Add a building: look it up on
// openstreetmap.org, right-click → "Show address" for lat/lng, and add a row here.

export interface Building {
  code: string;
  name: string;
  lat: number;
  lng: number;
}

export const BUILDINGS: Record<string, Building> = {
  RTH: { code: "RTH", name: "Ronald Tutor Hall", lat: 34.020087, lng: -118.289835 },
  SAL: { code: "SAL", name: "Salvatori Computer Science Center", lat: 34.019485, lng: -118.289513 },
  TCC: { code: "TCC", name: "Ronald Tutor Campus Center", lat: 34.020397, lng: -118.286346 },
  SGM: { code: "SGM", name: "Seeley G. Mudd Building", lat: 34.021507, lng: -118.288944 },
  SCA: { code: "SCA", name: "George Lucas Instructional Building (Cinematic Arts)", lat: 34.023442, lng: -118.28643 },
  DML: { code: "DML", name: "Doheny Memorial Library", lat: 34.020163, lng: -118.283741 },
  LVL: { code: "LVL", name: "Leavey Library", lat: 34.021785, lng: -118.28294 },
  THH: { code: "THH", name: "Taper Hall", lat: 34.022229, lng: -118.284616 },
};

/** Campus landmark everyone knows — shown as a reference dot. */
export const TOMMY_TROJAN = { lat: 34.020568, lng: -118.285435 };

export const googleMapsUrl = (b: Building) =>
  `https://www.google.com/maps/search/?api=1&query=${b.lat},${b.lng}`;
export const appleMapsUrl = (b: Building) =>
  `https://maps.apple.com/?ll=${b.lat},${b.lng}&q=${encodeURIComponent(b.name)}`;
