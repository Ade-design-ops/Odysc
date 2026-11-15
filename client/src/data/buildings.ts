// The same catalog validates organizer events on the server and populates map/dropdown data.
import type { Building } from "../../../backend/src/campus-buildings";
export { BUILDINGS } from "../../../backend/src/campus-buildings";
export type { Building } from "../../../backend/src/campus-buildings";

/** Campus landmark everyone knows — shown as a reference dot. */
export const TOMMY_TROJAN = { lat: 34.020568, lng: -118.285435 };

export const googleMapsUrl = (b: Building) =>
  `https://www.google.com/maps/search/?api=1&query=${b.lat},${b.lng}`;
export const appleMapsUrl = (b: Building) =>
  `https://maps.apple.com/?ll=${b.lat},${b.lng}&q=${encodeURIComponent(b.name)}`;
