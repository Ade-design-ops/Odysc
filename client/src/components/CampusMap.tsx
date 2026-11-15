// Real USC map: OpenStreetMap building footprints (via OpenFreeMap vector tiles) extruded
// in 3D and restyled in OdySC colors. The event's building lights up in cardinal under a
// pulsing gold pin; directions hand off to Google Maps / Apple Maps.
// MapLibre is loaded on demand so it doesn't weigh down the rest of the app.
import { useEffect, useRef, useState } from "react";
import type { Map as MLMap } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { BUILDINGS, TOMMY_TROJAN, appleMapsUrl, googleMapsUrl } from "../data/buildings";

const STYLE = "https://tiles.openfreemap.org/styles/positron";
const PITCH = 58;

export default function CampusMap({ code, room, title, when }: { code: string; room: string; title: string; when?: string }) {
  const b = BUILDINGS[code];
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<MLMap | null>(null);
  const [tilted, setTilted] = useState(true);
  const [failed, setFailed] = useState(false);
  const [mapReady, setMapReady] = useState(false);

  useEffect(() => {
    if (!b || !el.current) return;
    let cancelled = false;
    setFailed(false);
    setMapReady(false);
    setTilted(true);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    (async () => {
      try {
        const maplibregl = (await import("maplibre-gl")).default;
        if (cancelled || !el.current) return;
        const m = new maplibregl.Map({
          container: el.current,
          style: STYLE,
          center: [b.lng, b.lat],
          zoom: reduce ? 16.9 : 15.2,
          pitch: reduce ? PITCH : 0,
          bearing: reduce ? -28 : 0,
          attributionControl: { compact: true },
          cooperativeGestures: true, // page scroll isn't hijacked; ctrl/two-finger to zoom
        });
        map.current = m;
        m.on("error", (e) => {
          if (!cancelled && String(e?.error?.message ?? "").match(/style|Failed to fetch/i)) setFailed(true);
        });

        m.on("load", () => {
          if (cancelled) return;
          try {
          // Restyle the base map in OdySC colors. Layer types vary (water has fill, line and
          // symbol layers), so only touch the property that type supports, and never let one
          // bad layer stop the rest.
          const safe = (fn: () => void) => { try { fn(); } catch { /* skip */ } };
          for (const layer of m.getStyle().layers ?? []) {
            const { id, type } = layer;
            if (type === "background") safe(() => m.setPaintProperty(id, "background-color", "#f8f2e7"));
            else if (id.includes("water") && type === "fill") safe(() => m.setPaintProperty(id, "fill-color", "#cfe1e8"));
            else if ((id.includes("park") || id.includes("landcover") || id.includes("landuse")) && type === "fill")
              safe(() => m.setPaintProperty(id, "fill-color", "#efe6d1"));
            else if (type === "line" && (id.includes("highway") || id.includes("road") || id.includes("path")))
              safe(() => m.setPaintProperty(id, "line-color", "#ffffff"));
            else if (id.includes("building")) safe(() => m.setLayoutProperty(id, "visibility", "none"));
            if (type === "symbol") safe(() => m.setPaintProperty(id, "text-color", "#6b665f"));
          }

          // 3D campus: every footprint extruded, gold-tinted by height.
          m.setLight({ anchor: "viewport", color: "#ffffff", intensity: 0.3 });
          m.addLayer({
            id: "odysc-3d",
            type: "fill-extrusion",
            source: "openmaptiles",
            "source-layer": "building",
            minzoom: 14,
            paint: {
              "fill-extrusion-color": ["interpolate", ["linear"], ["coalesce", ["get", "render_height"], 8], 0, "#f7efe2", 25, "#f0e3c8", 60, "#e8d29f"],
              "fill-extrusion-height": ["coalesce", ["get", "render_height"], 8],
              "fill-extrusion-base": ["coalesce", ["get", "render_min_height"], 0],
              "fill-extrusion-opacity": 0.95,
            },
          });

          const intro = () =>
            m.flyTo({ center: [b.lng, b.lat], zoom: 16.9, pitch: PITCH, bearing: -28, duration: reduce ? 0 : 2800, essential: true });
          if (!reduce) intro();

          // Light up the event's building once tiles are in.
          const highlight = () => {
            if (cancelled || !m.getLayer("odysc-3d") || m.getLayer("odysc-hi")) return;
            const hits = m.queryRenderedFeatures(m.project([b.lng, b.lat]), { layers: ["odysc-3d"] });
            const f = hits[0];
            if (f?.id === undefined) return;
            // Hide the plain copy of this building so the red one doesn't flicker against it.
            m.setFilter("odysc-3d", ["!=", ["id"], f.id]);
            m.addLayer({
              id: "odysc-hi",
              type: "fill-extrusion",
              source: "openmaptiles",
              "source-layer": "building",
              filter: ["==", ["id"], f.id],
              paint: {
                "fill-extrusion-color": "#990000",
                "fill-extrusion-height": ["+", ["coalesce", ["get", "render_height"], 8], 1.5],
                "fill-extrusion-base": ["coalesce", ["get", "render_min_height"], 0],
                "fill-extrusion-opacity": 0.95,
              },
            });
          };
          m.on("idle", highlight);

          // Pins.
          const pin = document.createElement("div");
          pin.className = "cmap-pin";
          pin.innerHTML = `<span class="ring"></span><span class="ring r2"></span><span class="dot"></span><span class="tag">${b.code}</span>`;
          new maplibregl.Marker({ element: pin, anchor: "center" }).setLngLat([b.lng, b.lat]).addTo(m);
          const tt = document.createElement("div");
          tt.className = "cmap-landmark";
          tt.innerHTML = `<span class="dot"></span><span>Tommy Trojan</span>`;
          new maplibregl.Marker({ element: tt, anchor: "left" }).setLngLat([TOMMY_TROJAN.lng, TOMMY_TROJAN.lat]).addTo(m);
          m.resize();
          setMapReady(true);
          } catch { if (!cancelled) setFailed(true); }
        });
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();

    return () => {
      cancelled = true;
      map.current?.remove();
      map.current = null;
    };
  }, [b]);

  if (!b) return <p className="subtle">No map for {code} yet.</p>;

  const toggleTilt = () => {
    const next = !tilted;
    setTilted(next);
    map.current?.easeTo({ pitch: next ? PITCH : 0, bearing: next ? -28 : 0, duration: 900 });
  };
  const recenter = () => map.current?.flyTo({ center: [b.lng, b.lat], zoom: 16.9, pitch: tilted ? PITCH : 0, bearing: tilted ? -28 : 0, duration: 1200 });

  return (
    <figure className="cmap" aria-label={`Map of ${b.name}`}>
      <div ref={el} className="cmap-canvas" style={failed ? { display: "none" } : undefined} />
      {failed && <div className="cmap-canvas cmap-fallback"><span>Interactive map unavailable. Use the directions below.</span></div>}

      {!failed && (
        <div className="cmap-controls">
          <button disabled={!mapReady} onClick={toggleTilt} aria-pressed={tilted}>{tilted ? "2D" : "3D"}</button>
          <button disabled={!mapReady} onClick={recenter} aria-label="Re-center on the building">◎</button>
        </div>
      )}

      <figcaption className="cmap-card">
        <div className="cmap-card-top">
          <span className="cmap-code">{b.code}</span>
          <div>
            <div className="cmap-title">{room}</div>
            <div className="cmap-sub">{b.name}</div>
          </div>
        </div>
        <div className="cmap-sub" style={{ margin: "6px 0 12px" }}>{title}{when ? ` · ${when}` : ""}</div>
        <div className="row" style={{ gap: 8 }}>
          <a className="btn sm primary" href={googleMapsUrl(b)} target="_blank" rel="noreferrer">Open in Google Maps</a>
          <a className="btn sm" href={appleMapsUrl(b)} target="_blank" rel="noreferrer">Apple Maps</a>
        </div>
      </figcaption>
    </figure>
  );
}
