import type { Feature, FeatureCollection, Polygon, Position } from "geojson";

export type BuildingFootprint = Feature<Polygon, {
  render_height: number;
  render_min_height: number;
}>;
export interface BuildingHighlight {
  footprint: BuildingFootprint;
  excludedIds: (string | number)[];
  neutralRemainder: FeatureCollection<Polygon, BuildingFootprint["properties"]>;
}

// A numerical boundary tolerance, not a search radius or a footprint expansion.
const EPSILON = 1e-10;
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);

function heights(value: unknown): BuildingFootprint["properties"] {
  const properties = record(value) ? value : {};
  const height = typeof properties.render_height === "number" && Number.isFinite(properties.render_height) && properties.render_height >= 0 ? properties.render_height : 8;
  const base = typeof properties.render_min_height === "number" && Number.isFinite(properties.render_min_height) && properties.render_min_height >= 0 ? Math.min(properties.render_min_height, height) : 0;
  return { render_height: height, render_min_height: base };
}

function components(geometry: Record<string, unknown>) {
  return geometry.type === "Polygon" ? [geometry.coordinates]
    : geometry.type === "MultiPolygon" && Array.isArray(geometry.coordinates) ? geometry.coordinates : [];
}

function ringArea(ring: Position[]) {
  const [originX, originY] = ring[0];
  let twiceArea = 0;
  for (let i = 1; i < ring.length; i += 1) {
    const previous = ring[i - 1];
    const current = ring[i];
    twiceArea += (previous[0] - originX) * (current[1] - originY) - (current[0] - originX) * (previous[1] - originY);
  }
  return Math.abs(twiceArea) / 2;
}

function readRing(value: unknown): Position[] | null {
  if (!Array.isArray(value) || value.length < 4) return null;
  const ring: Position[] = [];
  for (const point of value) {
    if (!Array.isArray(point) || point.length < 2 || !point.every((coordinate) => typeof coordinate === "number" && Number.isFinite(coordinate))) return null;
    if (Math.abs(point[0]) > 180 || Math.abs(point[1]) > 90) return null;
    ring.push([...point]);
  }
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1] || ringArea(ring) === 0) return null;
  return ring;
}

function readPolygon(value: unknown): Position[][] | null {
  if (!Array.isArray(value) || !value.length) return null;
  const rings: Position[][] = [];
  for (const valueRing of value) {
    const ring = readRing(valueRing);
    if (!ring) return null;
    rings.push(ring);
  }
  if (ringArea(rings[0]) <= rings.slice(1).reduce((area, ring) => area + ringArea(ring), 0)) return null;
  return rings;
}

// The separate boundary result lets a courtyard boundary remain excluded.
function pointInRing(point: readonly [number, number], ring: Position[]): "inside" | "outside" | "boundary" {
  const [x, y] = point;
  let inside = false;
  for (let i = 1; i < ring.length; i += 1) {
    const [ax, ay] = ring[i - 1];
    const [bx, by] = ring[i];
    const dx = bx - ax;
    const dy = by - ay;
    const length = Math.hypot(dx, dy);
    if (length > 0) {
      const cross = (x - ax) * dy - (y - ay) * dx;
      const along = (x - ax) * dx + (y - ay) * dy;
      if (Math.abs(cross) <= EPSILON * length && along >= -EPSILON * length && along <= length * length + EPSILON * length) return "boundary";
    }
    if ((ay > y) !== (by > y) && x < ax + (y - ay) * dx / dy) inside = !inside;
  }
  return inside ? "inside" : "outside";
}

function contains(point: readonly [number, number], rings: Position[][]) {
  return pointInRing(point, rings[0]) !== "outside"
    && rings.slice(1).every((hole) => pointInRing(point, hole) === "outside");
}

/**
 * Select only the geographic Polygon component underneath a building anchor.
 * Vector IDs and screen hit order are deliberately ignored: one provider feature
 * can group many unrelated buildings. Loaded tiles can also repeat/clip a roof;
 * prefer the largest containing copy without joining neighbors or guessing a radius.
 */
export function selectBuildingFootprint(features: readonly unknown[], anchor: readonly [number, number]): BuildingFootprint | null {
  if (anchor.length !== 2 || !anchor.every(Number.isFinite) || Math.abs(anchor[0]) > 180 || Math.abs(anchor[1]) > 90) return null;
  let selected: BuildingFootprint | null = null;
  let largestArea = 0;
  let selectedKey = "";
  for (const feature of features) {
    if (!record(feature) || !record(feature.geometry)) continue;
    const geometry = feature.geometry;
    const properties = heights(feature.properties);
    for (const component of components(geometry)) {
      const coordinates = readPolygon(component);
      if (!coordinates || !contains(anchor, coordinates)) continue;
      const area = ringArea(coordinates[0]) - coordinates.slice(1).reduce((sum, hole) => sum + ringArea(hole), 0);
      const candidate: BuildingFootprint = {
        type: "Feature",
        properties,
        geometry: { type: "Polygon", coordinates },
      };
      const key = JSON.stringify(candidate);
      if (area > largestArea || (area === largestArea && (selected === null || key < selectedKey))) {
        selected = candidate;
        largestArea = area;
        selectedKey = key;
      }
    }
  }
  return selected;
}

// Geometry keys ignore ring starting vertices, winding and hole order, but retain
// the distinction between separate polygons and courtyard holes.
function geometryKey(coordinates: Position[][]) {
  const ringKey = (ring: Position[]) => {
    const points = ring.slice(0, -1).map((point) => JSON.stringify(point));
    const rotation = (values: string[]) => {
      let best = 0;
      for (let index = 1; index < values.length; index += 1) {
        for (let offset = 0; offset < values.length; offset += 1) {
          const next = values[(index + offset) % values.length];
          const current = values[(best + offset) % values.length];
          if (next < current) { best = index; break; }
          if (next > current) break;
        }
      }
      return JSON.stringify([...values.slice(best), ...values.slice(0, best)]);
    };
    const forward = rotation(points);
    const reverse = rotation([...points].reverse());
    return forward < reverse ? forward : reverse;
  };
  return JSON.stringify([ringKey(coordinates[0]), ...coordinates.slice(1).map(ringKey).sort()]);
}

function coversPoint(point: readonly [number, number], coordinates: Position[][]) {
  return pointInRing(point, coordinates[0]) !== "outside"
    && coordinates.slice(1).every((hole) => pointInRing(point, hole) !== "inside");
}

function properCrossing(a: Position, b: Position, c: Position, d: Position) {
  const side = (first: Position, second: Position, point: Position) => {
    const cross = (second[0] - first[0]) * (point[1] - first[1]) - (second[1] - first[1]) * (point[0] - first[0]);
    const tolerance = EPSILON * Math.hypot(second[0] - first[0], second[1] - first[1]);
    return cross > tolerance ? 1 : cross < -tolerance ? -1 : 0;
  };
  return side(a, b, c) * side(a, b, d) < 0 && side(c, d, a) * side(c, d, b) < 0;
}

/** Only suppress a clipped copy when its roof stays within the selected roof. */
function coveredBy(candidate: Position[][], selected: Position[][]) {
  for (const ring of candidate) {
    for (let i = 1; i < ring.length; i += 1) {
      const a = ring[i - 1];
      const b = ring[i];
      if (!coversPoint([a[0], a[1]], selected) || !coversPoint([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], selected)) return false;
      for (const boundary of selected) {
        for (let j = 1; j < boundary.length; j += 1) {
          if (properCrossing(a, b, boundary[j - 1], boundary[j])) return false;
        }
      }
    }
  }
  // An otherwise enclosed polygon must not fill a courtyard. Triangle-fan
  // witnesses are accepted only when they are strictly inside the hole.
  for (const hole of selected.slice(1)) {
    const origin = hole[0];
    for (let i = 2; i < hole.length; i += 1) {
      const point: [number, number] = [(origin[0] + hole[i - 1][0] + hole[i][0]) / 3, (origin[1] + hole[i - 1][1] + hole[i][1]) / 3];
      if (pointInRing(point, hole) === "inside" && contains(point, candidate)) return false;
    }
  }
  return true;
}

/**
 * Replace only vector groups that own the selected geographic roof. Every other
 * loaded component with those exact IDs is restored independently, so a grouped
 * feature or a duplicate ID never removes unrelated buildings from the scene.
 */
export function selectBuildingHighlight(features: readonly unknown[], anchor: readonly [number, number]): BuildingHighlight | null {
  const footprint = selectBuildingFootprint(features, anchor);
  if (!footprint) return null;
  const selectedKey = geometryKey(footprint.geometry.coordinates);
  const parsed: { id: unknown; feature: BuildingFootprint; target: boolean }[] = [];
  const excluded = new Map<string, string | number>();
  const malformedGroups = new Set<string>();
  for (const value of features) {
    if (!record(value) || !record(value.geometry)) continue;
    const properties = heights(value.properties);
    for (const component of components(value.geometry)) {
      const coordinates = readPolygon(component);
      if (!coordinates) { malformedGroups.add(`${typeof value.id}:${String(value.id)}`); continue; }
      const target = contains(anchor, coordinates) || geometryKey(coordinates) === selectedKey
        || (properties.render_height === footprint.properties.render_height && properties.render_min_height === footprint.properties.render_min_height && coveredBy(coordinates, footprint.geometry.coordinates));
      if (target) {
        if (!(typeof value.id === "string" && value.id.length > 0) && !(typeof value.id === "number" && Number.isFinite(value.id))) return null;
        excluded.set(`${typeof value.id}:${value.id}`, value.id);
      }
      parsed.push({ id: value.id, feature: { type: "Feature", properties: { ...properties }, geometry: { type: "Polygon", coordinates } }, target });
    }
  }
  // Do not hide a provider group if any of its roofs cannot be reconstructed.
  if ([...excluded.keys()].some((id) => malformedGroups.has(id))) return null;
  const neutral = new Map<string, BuildingFootprint>();
  for (const entry of parsed) {
    if (entry.target || !excluded.has(`${typeof entry.id}:${String(entry.id)}`)) continue;
    const key = `${geometryKey(entry.feature.geometry.coordinates)}:${JSON.stringify(entry.feature.properties)}`;
    const previous = neutral.get(key);
    if (!previous || JSON.stringify(entry.feature) < JSON.stringify(previous)) neutral.set(key, entry.feature);
  }
  return {
    footprint,
    excludedIds: [...excluded.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, id]) => id),
    neutralRemainder: { type: "FeatureCollection", features: [...neutral.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, feature]) => feature) },
  };
}
