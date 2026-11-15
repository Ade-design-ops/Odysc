
/* ==========================================
   ODYSC STUDENT PORTAL
   Part 3 — Complete JavaScript
   HTML / CSS / Vanilla JavaScript
   No build tools required
   ========================================== */

"use strict";

/* ==========================================
   1. MOCK DATA
   ========================================== */

const CLUBS = [
  {
    id: "engineering",
    name: "Engineering Design Collective",
    category: "Engineering",
    icon: "⚙️",
    description:
      "Collaborate on hands-on engineering design projects and meet fellow makers.",
    question:
      "What type of engineering project would you like to work on?"
  },
  {
    id: "creators",
    name: "Campus Creators Studio",
    category: "Creative",
    icon: "🎨",
    description:
      "Explore digital media, visual design, and creative storytelling.",
    question:
      "Tell us about a creative project you are proud of."
  },
  {
    id: "volunteers",
    name: "Trojan Community Volunteers",
    category: "Community",
    icon: "🤝",
    description:
      "Connect with students through service and community projects.",
    question:
      "What does community service mean to you?"
  },
  {
    id: "venture",
    name: "Student Venture Network",
    category: "Business",
    icon: "💡",
    description:
      "Practice pitching ideas and learn about entrepreneurship.",
    question:
      "Describe a business idea you would like to develop."
  },
  {
    id: "robotics",
    name: "Robotics Project Lab",
    category: "Engineering",
    icon: "🤖",
    description:
      "Build prototypes and explore robotics with peers.",
    question:
      "What interests you most about robotics?"
  },
  {
    id: "film",
    name: "Student Film Circle",
    category: "Creative",
    icon: "🎬",
    description:
      "Meet students interested in filmmaking, editing, and production.",
    question:
      "What kind of films or videos would you like to create?"
  }
];

/*
  All events below are fictional examples.
  Coordinates are approximate campus map points.
  They are not verified entrances or meeting rooms.
*/

const EVENTS = [
  {
    id: "event-engineering",
    clubId: "engineering",
    title: "Example info session",
    day: "Sample Tuesday",
    time: "5:00 PM",
    building: "Olin Hall of Engineering",
    coordinates: [-118.2890, 34.0200]
  },
  {
    id: "event-creators",
    clubId: "creators",
    title: "Example creative meetup",
    day: "Sample Wednesday",
    time: "6:00 PM",
    building: "USC School of Cinematic Arts area",
    coordinates: [-118.2862, 34.0230]
  },
  {
    id: "event-volunteers",
    clubId: "volunteers",
    title: "Example meeting",
    day: "Sample Thursday",
    time: "4:30 PM",
    building: "Leavey Library",
    coordinates: [-118.2829, 34.0218]
  },
  {
    id: "event-venture",
    clubId: "venture",
    title: "Example networking session",
    day: "Sample Friday",
    time: "3:00 PM",
    building: "Fertitta Hall area",
    coordinates: [-118.2858, 34.0187]
  },
  {
    id: "event-robotics",
    clubId: "robotics",
    title: "Example robotics workshop",
    day: "Sample Monday",
    time: "5:30 PM",
    building: "Olin Hall of Engineering",
    coordinates: [-118.2890, 34.0200]
  },
  {
    id: "event-film",
    clubId: "film",
    title: "Example film discussion",
    day: "Sample Saturday",
    time: "2:00 PM",
    building: "USC School of Cinematic Arts area",
    coordinates: [-118.2862, 34.0230]
  }
];

/* ==========================================
   2. STORAGE AND STATE
   ========================================== */

const STORAGE_KEY = "odysc-student-v3";

function defaultState() {
  return {
    profile: {
      fullName: "",
      email: "",
      major: "",
      year: "",
      interests: "",
      skills: "",
      experience: ""
    },
    common: {
      motivation: "",
      community: "",
      project: "",
      contribution: ""
    },
    favorites: [],
    applications: {}
  };
}

function loadState() {
  const defaults = defaultState();

  try {
    const saved = JSON.parse(
      localStorage.getItem(STORAGE_KEY) || "null"
    );

    if (!saved || typeof saved !== "object") {
      return defaults;
    }

    return {
      profile: {
        ...defaults.profile,
        ...(saved.profile || {})
      },
      common: {
        ...defaults.common,
        ...(saved.common || {})
      },
      favorites: Array.isArray(saved.favorites)
        ? saved.favorites
        : [],
      applications:
        saved.applications &&
        typeof saved.applications === "object"
          ? saved.applications
          : {}
    };
  } catch (error) {
    console.warn("Could not load saved demo data.", error);
    return defaults;
  }
}

let state = loadState();

function saveState() {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(state)
    );
    return true;
  } catch (error) {
    console.warn("Could not save demo data.", error);
    return false;
  }
}

function byId(id) {
  return document.getElementById(id);
}

function escapeHTML(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    character => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    })[character]
  );
}

function getClub(id) {
  return CLUBS.find(club => club.id === id);
}

function getEvent(id) {
  return EVENTS.find(event => event.id === id);
}

function getClubName(id) {
  return getClub(id)?.name || "Unknown club";
}

function showStatus(id, message) {
  const element = byId(id);
  if (element) element.textContent = message;
}

/* ==========================================
   3. PAGE NAVIGATION
   ========================================== */

const PAGE_TITLES = {
  dashboard: "Dashboard",
  profile: "My Profile",
  "common-app": "Common Application",
  discover: "Discover Clubs",
  applications: "My Applications",
  navigator: "Campus Navigator",
  events: "Events"
};

let currentPage = "dashboard";

function navigate(page) {
  if (!PAGE_TITLES[page]) page = "dashboard";

  currentPage = page;

  document.querySelectorAll(".page").forEach(
    section => {
      section.hidden = section.id !== page;
    }
  );

  document.querySelectorAll(
    "#sideNav [data-page]"
  ).forEach(link => {
    const active = link.dataset.page === page;
    link.classList.toggle("active", active);

    if (active) {
      link.setAttribute("aria-current", "page");
    } else {
      link.removeAttribute("aria-current");
    }
  });

  const title = byId("pageTitle");
  if (title) title.textContent = PAGE_TITLES[page];

  const sidebar = byId("sidebar");
  sidebar?.classList.remove("open");

  const menu = byId("menuToggle");
  menu?.setAttribute("aria-expanded", "false");

  if (page === "dashboard") renderDashboard();
  if (page === "discover") renderClubs();
  if (page === "applications") renderApplications();
  if (page === "events") renderEvents();

  if (page === "common-app") {
    renderCommonStep();
  }

  if (page === "navigator") {
    initializeCampusMap();

    /*
      MapLibre needs a resize after its container
      becomes visible.
    */
    requestAnimationFrame(() => {
      if (campusMap) campusMap.resize();
    });
  }

  window.scrollTo(0, 0);
}

function setupNavigation() {
  document.querySelectorAll("[data-go]").forEach(
    button => {
      button.addEventListener("click", () => {
        location.hash = button.dataset.go;
      });
    }
  );

  window.addEventListener("hashchange", () => {
    const page = location.hash.slice(1);
    navigate(page);
  });

  const menu = byId("menuToggle");

  menu?.addEventListener("click", () => {
    const sidebar = byId("sidebar");
    const open = sidebar.classList.toggle("open");

    menu.setAttribute(
      "aria-expanded",
      String(open)
    );
  });

  document.addEventListener("keydown", event => {
    if (event.key === "Escape") {
      byId("sidebar")?.classList.remove("open");
      menu?.setAttribute("aria-expanded", "false");
    }
  });

  navigate(location.hash.slice(1) || "dashboard");
}

/* ==========================================
   4. PROFILE
   ========================================== */

function setupProfile() {
  const form = byId("profileForm");
  if (!form) return;

  Object.entries(state.profile).forEach(
    ([key, value]) => {
      if (form.elements[key]) {
        form.elements[key].value = value;
      }
    }
  );

  form.addEventListener("submit", event => {
    event.preventDefault();

    Object.keys(state.profile).forEach(key => {
      if (form.elements[key]) {
        state.profile[key] =
          form.elements[key].value.trim();
      }
    });

    const saved = saveState();

    showStatus(
      "profileStatus",
      saved
        ? "Profile saved in this browser."
        : "Unable to save. Check browser storage."
    );

    renderDashboard();
  });
}

function profileCompletion() {
  const values = Object.values(state.profile);

  const completed = values.filter(
    value => String(value).trim().length > 0
  ).length;

  return Math.round(
    (completed / values.length) * 100
  );
}

/* ==========================================
   5. COMMON APPLICATION
   ========================================== */

let commonStep = 0;

const COMMON_FIELDS = [
  "motivation",
  "community",
  "project",
  "contribution"
];

function readCommonForm() {
  const form = byId("commonForm");
  if (!form) return;

  COMMON_FIELDS.forEach(field => {
    if (form.elements[field]) {
      state.common[field] =
        form.elements[field].value;
    }
  });
}

function commonCompletion() {
  const completed = COMMON_FIELDS.filter(
    field => state.common[field].trim()
  ).length;

  return Math.round(
    (completed / COMMON_FIELDS.length) * 100
  );
}

function renderCommonStep() {
  document.querySelectorAll(
    ".form-step"
  ).forEach(step => {
    step.hidden =
      Number(step.dataset.step) !== commonStep;
  });

  document.querySelectorAll(
    "[data-step-label]"
  ).forEach(label => {
    label.classList.toggle(
      "current",
      Number(label.dataset.stepLabel) === commonStep
    );
  });

  const stepLabel = byId("stepLabel");
  if (stepLabel) {
    stepLabel.textContent =
      `Step ${commonStep + 1} of 3`;
  }

  const percent = commonCompletion();

  if (byId("appPercent")) {
    byId("appPercent").textContent =
      `${percent}% complete`;
  }

  if (byId("appProgressBar")) {
    byId("appProgressBar").style.width =
      `${percent}%`;
  }

  if (byId("prevStep")) {
    byId("prevStep").disabled =
      commonStep === 0;
  }

  if (byId("nextStep")) {
    byId("nextStep").textContent =
      commonStep === 2
        ? "Back to dashboard →"
        : "Next →";
  }

  if (commonStep === 2) renderCommonReview();
}

function renderCommonReview() {
  const container = byId("reviewContent");
  if (!container) return;

  const questions = {
    motivation:
      "Why do you want to join a student organization?",
    community:
      "What kind of community are you looking for?",
    project:
      "Meaningful project or experience",
    contribution:
      "What would you contribute to a club?"
  };

  container.innerHTML = COMMON_FIELDS.map(
    field => `
      <div class="review-item">
        <strong>${escapeHTML(questions[field])}</strong>
        <p>${escapeHTML(
          state.common[field] || "Not answered yet"
        )}</p>
      </div>
    `
  ).join("");
}

function setupCommonApplication() {
  const form = byId("commonForm");
  if (!form) return;

  COMMON_FIELDS.forEach(field => {
    if (form.elements[field]) {
      form.elements[field].value =
        state.common[field] || "";
    }
  });

  form.addEventListener("input", () => {
    readCommonForm();
    saveState();
    renderCommonStep();
    renderDashboard();
  });

  byId("saveCommon")?.addEventListener(
    "click",
    () => {
      readCommonForm();

      const saved = saveState();

      showStatus(
        "commonStatus",
        saved
          ? "Draft saved."
          : "Unable to save draft."
      );
    }
  );

  byId("prevStep")?.addEventListener(
    "click",
    () => {
      readCommonForm();
      saveState();

      commonStep = Math.max(
        0,
        commonStep - 1
      );

      renderCommonStep();
    }
  );

  byId("nextStep")?.addEventListener(
    "click",
    () => {
      readCommonForm();
      saveState();

      if (commonStep === 2) {
        location.hash = "dashboard";
        return;
      }

      commonStep++;
      renderCommonStep();
    }
  );

  renderCommonStep();
}

/* ==========================================
   6. DISCOVER CLUBS
   ========================================== */

function renderClubs() {
  const container = byId("clubGrid");
  if (!container) return;

  const search =
    byId("search")?.value.toLowerCase().trim()
    || "";

  const category =
    byId("category")?.value || "all";

  const filtered = CLUBS.filter(club => {
    const matchesSearch = (
      club.name + " " +
      club.description + " " +
      club.category
    ).toLowerCase().includes(search);

    const matchesCategory =
      category === "all" ||
      club.category === category;

    return matchesSearch && matchesCategory;
  });

  container.innerHTML = filtered.map(club => {
    const saved = state.favorites.includes(club.id);
    const applied = Boolean(
      state.applications[club.id]
    );

    return `
      <article class="club-card">
        <div class="card-top">
          <span class="club-icon">
            ${escapeHTML(club.icon)}
          </span>
          <span class="tag">
            ${escapeHTML(club.category)}
          </span>
        </div>

        <h3>${escapeHTML(club.name)}</h3>

        <p>${escapeHTML(club.description)}</p>

        <div class="card-actions">
          <button
            type="button"
            class="outline-button"
            data-save-club="${club.id}"
            aria-pressed="${saved}">
            ${saved ? "★ Saved" : "☆ Save"}
          </button>

          <button
            type="button"
            class="primary-button"
            data-apply-club="${club.id}">
            ${applied
              ? "View application"
              : "Start application"}
          </button>
        </div>
      </article>
    `;
  }).join("");

  const empty = byId("emptyState");
  if (empty) empty.hidden = filtered.length > 0;
}

function toggleFavorite(id) {
  if (!getClub(id)) return;

  if (state.favorites.includes(id)) {
    state.favorites = state.favorites.filter(
      savedId => savedId !== id
    );
  } else {
    state.favorites.push(id);
  }

  saveState();
  renderClubs();
  renderDashboard();
}

function startApplication(id) {
  if (!getClub(id)) return;

  if (!state.applications[id]) {
    state.applications[id] = {
      status: "Draft",
      supplement: ""
    };
  }

  saveState();
  renderDashboard();

  location.hash = "applications";

  if (currentPage === "applications") {
    renderApplications();
  }
}

function setupDiscover() {
  byId("search")?.addEventListener(
    "input",
    renderClubs
  );

  byId("category")?.addEventListener(
    "change",
    renderClubs
  );

  byId("clubGrid")?.addEventListener(
    "click",
    event => {
      const saveButton = event.target.closest(
        "[data-save-club]"
      );

      if (saveButton) {
        toggleFavorite(
          saveButton.dataset.saveClub
        );
        return;
      }

      const applyButton = event.target.closest(
        "[data-apply-club]"
      );

      if (applyButton) {
        startApplication(
          applyButton.dataset.applyClub
        );
      }
    }
  );
}

/* ==========================================
   7. MY APPLICATIONS
   ========================================== */

function renderApplications() {
  const container = byId("applicationList");
  if (!container) return;

  const entries = Object.entries(
    state.applications
  ).filter(([id]) => getClub(id));

  if (!entries.length) {
    container.innerHTML = `
      <article class="panel">
        <h3>No applications yet</h3>
        <p class="muted">
          Discover a club and select
          "Start application" to begin.
        </p>
        <button
          type="button"
          class="primary-button"
          data-open-discover>
          Discover clubs →
        </button>
      </article>
    `;
    return;
  }

  container.innerHTML = entries.map(
    ([id, application]) => {
      const club = getClub(id);

      const hasSupplement = Boolean(
        application.supplement?.trim()
      );

      const commonReady =
        commonCompletion() === 100;

      const requirements = [
        commonReady
          ? "✓ Common answers completed"
          : "○ Complete common answers",
        hasSupplement
          ? "✓ Supplemental answer saved"
          : "○ Supplemental answer needed"
      ];

      return `
        <article class="panel">
          <div class="section-head">
            <h3>${escapeHTML(club.name)}</h3>
            <span class="pill">Draft</span>
          </div>

          <p class="muted">
            ${requirements.join("<br>")}
          </p>

          <div class="supplement">
            <label for="supp-${id}">
              ${escapeHTML(club.question)}
            </label>

            <textarea
              id="supp-${id}"
              rows="5"
              data-supplement="${id}"
              placeholder="Write your answer..."
            >${escapeHTML(
              application.supplement || ""
            )}</textarea>

            <div class="form-actions">
              <button
                type="button"
                class="primary-button"
                data-save-supplement="${id}">
                Save supplemental answer
              </button>

              <button
                type="button"
                class="outline-button"
                data-remove-application="${id}">
                Remove draft
              </button>
            </div>
          </div>
        </article>
      `;
    }
  ).join("");
}

function setupApplications() {
  byId("applicationList")?.addEventListener(
    "click",
    event => {
      if (event.target.closest(
        "[data-open-discover]"
      )) {
        location.hash = "discover";
        return;
      }

      const saveButton = event.target.closest(
        "[data-save-supplement]"
      );

      if (saveButton) {
        const id =
          saveButton.dataset.saveSupplement;

        const input = document.querySelector(
          `[data-supplement="${id}"]`
        );

        if (!state.applications[id]) return;

        state.applications[id].supplement =
          input?.value || "";

        saveState();
        renderApplications();
        return;
      }

      const removeButton = event.target.closest(
        "[data-remove-application]"
      );

      if (removeButton) {
        const id =
          removeButton.dataset.removeApplication;

        delete state.applications[id];

        saveState();
        renderApplications();
        renderDashboard();
      }
    }
  );
}

/* ==========================================
   8. DASHBOARD
   ========================================== */

function renderDashboard() {
  const profilePercent = profileCompletion();
  const commonPercent = commonCompletion();

  const totalPercent = Math.round(
    (profilePercent + commonPercent) / 2
  );

  if (byId("dashProgress")) {
    byId("dashProgress").textContent =
      `${totalPercent}%`;
  }

  if (byId("dashProgressBar")) {
    byId("dashProgressBar").style.width =
      `${totalPercent}%`;
  }

  if (byId("dashApps")) {
    byId("dashApps").textContent =
      Object.keys(state.applications).length;
  }

  if (byId("dashSaved")) {
    byId("dashSaved").textContent =
      state.favorites.length;
  }

  const eventsContainer = byId(
    "dashboardEvents"
  );

  if (eventsContainer) {
    eventsContainer.innerHTML =
      EVENTS.slice(0, 3).map(event => `
        <div class="event-card">
          <div>
            <strong>
              ${escapeHTML(
                getClubName(event.clubId)
              )}
            </strong>
            <p>
              ${escapeHTML(event.title)} ·
              ${escapeHTML(event.day)} ·
              ${escapeHTML(event.time)}
            </p>
          </div>

          <button
            type="button"
            class="outline-button"
            data-dashboard-event="${event.id}">
            View location
          </button>
        </div>
      `).join("");
  }
}

function setupDashboard() {
  byId("dashboardEvents")?.addEventListener(
    "click",
    event => {
      const button = event.target.closest(
        "[data-dashboard-event]"
      );

      if (!button) return;

      selectedEventId =
        button.dataset.dashboardEvent;

      location.hash = "navigator";

      if (currentPage === "navigator") {
        selectEvent(selectedEventId);
      }
    }
  );
}

/* ==========================================
   9. EVENTS
   ========================================== */

function renderEvents() {
  const container = byId("eventList");
  if (!container) return;

  container.innerHTML = EVENTS.map(event => `
    <article class="panel event-card">
      <div>
        <h3>
          ${escapeHTML(
            getClubName(event.clubId)
          )}
        </h3>

        <p>
          ${escapeHTML(event.title)}
        </p>

        <p>
          ${escapeHTML(event.day)} ·
          ${escapeHTML(event.time)}
        </p>

        <p>
          ${escapeHTML(event.building)}
        </p>
      </div>

      <button
        type="button"
        class="outline-button"
        data-event-location="${event.id}">
        View on map →
      </button>
    </article>
  `).join("");
}

function setupEvents() {
  byId("eventList")?.addEventListener(
    "click",
    event => {
      const button = event.target.closest(
        "[data-event-location]"
      );

      if (!button) return;

      selectedEventId =
        button.dataset.eventLocation;

      location.hash = "navigator";

      if (currentPage === "navigator") {
        selectEvent(selectedEventId);
      }
    }
  );
}

/* ==========================================
   10. CAMPUS NAVIGATOR CONFIGURATION
   ========================================== */

/*
  OpenFreeMap provides vector map tiles.

  MapLibre renders the map, layers,
  building extrusions, markers and route.

  This demo does not use real club events
  or verified pedestrian routes.
*/

const MAP_STYLE_URL =
  "https://tiles.openfreemap.org/styles/liberty";

const USC_CENTER = [-118.2857, 34.0208];

const MAP_START = [-118.2855, 34.0207];

let campusMap = null;
let mapReady = false;
let mapLoading = false;

let selectedEventId = EVENTS[0].id;

let mapTilted = false;

let mapMarkers = [];

let buildingSource = null;
let buildingSourceLayer = null;

let selectedBuildingGeometry = null;

/* ==========================================
   11. LOAD MAPLIBRE
   ========================================== */

/*
  The HTML from Part 1 includes the
  MapLibre stylesheet but not its JS library.

  This function loads the library automatically
  without requiring another HTML edit.
*/

function loadMapLibre() {
  return new Promise((resolve, reject) => {
    if (window.maplibregl) {
      resolve();
      return;
    }

    const existing = document.querySelector(
      'script[data-odysc-maplibre]'
    );

    if (existing) {
      existing.addEventListener(
        "load",
        resolve,
        { once: true }
      );

      existing.addEventListener(
        "error",
        reject,
        { once: true }
      );

      return;
    }

    const script = document.createElement(
      "script"
    );

    script.src =
      "https://unpkg.com/maplibre-gl@6.18.0/dist/maplibre-gl.js";

    script.dataset.odyscMaplibre = "true";

    script.onload = resolve;
    script.onerror = () => {
      reject(
        new Error("MapLibre could not load.")
      );
    };

    document.head.appendChild(script);
  });
}

/* ==========================================
   12. MAP STYLE AND GRAYSCALE
   ========================================== */

function applyGrayscaleMap() {
  if (!campusMap || !mapReady) return;

  const style = campusMap.getStyle();

  if (!style?.layers) return;

  /*
    Change the base map layer colors rather
    than applying a CSS grayscale filter.

    This preserves the cardinal/gold overlays.
  */

  style.layers.forEach(layer => {
    try {
      if (layer.type === "background") {
        campusMap.setPaintProperty(
          layer.id,
          "background-color",
          "#eeeeee"
        );
      }

      if (layer.type === "fill") {
        campusMap.setPaintProperty(
          layer.id,
          "fill-color",
          "#d4d4d4"
        );
      }

      if (layer.type === "line") {
        campusMap.setPaintProperty(
          layer.id,
          "line-color",
          "#b9b9b9"
        );
      }

      if (layer.type === "fill-extrusion") {
        campusMap.setPaintProperty(
          layer.id,
          "fill-extrusion-color",
          "#b4b4b4"
        );
      }

      if (layer.type === "symbol") {
        if (
          campusMap.getPaintProperty(
            layer.id,
            "text-color"
          ) !== undefined
        ) {
          campusMap.setPaintProperty(
            layer.id,
            "text-color",
            "#686868"
          );
        }
      }
    } catch (error) {
      /*
        Some provider layers use expressions
        or do not expose a given property.
        Leave those layers unchanged.
      */
    }
  });
}

/* ==========================================
   13. BUILDING DATA
   ========================================== */

function findBuildingLayer() {
  const style = campusMap.getStyle();

  const layers = style?.layers || [];

  const buildingLayer = layers.find(layer =>
    layer["source-layer"] === "building" &&
    layer.source
  );

  if (!buildingLayer) {
    return null;
  }

  return {
    source: buildingLayer.source,
    sourceLayer: buildingLayer["source-layer"]
  };
}

function add3DBuildings() {
  if (!campusMap || !mapReady) return;

  const info = findBuildingLayer();

  if (!info) {
    console.warn(
      "Building geometry unavailable in map style."
    );
    return;
  }

  buildingSource = info.source;
  buildingSourceLayer = info.sourceLayer;

  if (campusMap.getLayer("odysc-3d-buildings")) {
    return;
  }

  /*
    These heights are approximations where
    source data has no height information.
  */

  campusMap.addLayer({
    id: "odysc-3d-buildings",
    type: "fill-extrusion",
    source: buildingSource,
    "source-layer": buildingSourceLayer,
    minzoom: 15,
    layout: {
      visibility: "none"
    },
    paint: {
      "fill-extrusion-color": "#aaaaaa",

      "fill-extrusion-height": [
        "coalesce",
        ["to-number", ["get", "render_height"]],
        ["to-number", ["get", "height"]],
        15
      ],

      "fill-extrusion-base": 0,

      "fill-extrusion-opacity": 0.9,

      "fill-extrusion-vertical-gradient": true
    }
  });
}

/* ==========================================
   14. BUILDING HIGHLIGHT LAYERS
   ========================================== */

function emptyFeatureCollection() {
  return {
    type: "FeatureCollection",
    features: []
  };
}

function addHighlightLayers() {
  if (!campusMap || !mapReady) return;

  if (!campusMap.getSource(
    "odysc-selected-building"
  )) {
    campusMap.addSource(
      "odysc-selected-building",
      {
        type: "geojson",
        data: emptyFeatureCollection()
      }
    );
  }

  campusMap.addLayer({
    id: "odysc-building-2d",
    type: "fill",
    source: "odysc-selected-building",
    layout: {
      visibility: "visible"
    },
    paint: {
      "fill-color": "#ffcc00",
      "fill-opacity": 0.85
    }
  });

  campusMap.addLayer({
    id: "odysc-building-outline",
    type: "line",
    source: "odysc-selected-building",
    paint: {
      "line-color": "#990000",
      "line-width": 4
    }
  });

  campusMap.addLayer({
    id: "odysc-building-3d",
    type: "fill-extrusion",
    source: "odysc-selected-building",
    layout: {
      visibility: "none"
    },
    paint: {
      "fill-extrusion-color": "#ffcc00",
      "fill-extrusion-height": 20,
      "fill-extrusion-base": 0,
      "fill-extrusion-opacity": 0.95
    }
  });
}

/* ==========================================
   15. GEOMETRY HELPERS
   ========================================== */

function pointInRing(point, ring) {
  const [x, y] = point;
  let inside = false;

  for (
    let i = 0, j = ring.length - 1;
    i < ring.length;
    j = i++
  ) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];

    const intersects =
      (yi > y) !== (yj > y) &&
      x < (
        (xj - xi) * (y - yi) /
        (yj - yi) + xi
      );

    if (intersects) inside = !inside;
  }

  return inside;
}

function pointInPolygon(point, polygon) {
  if (!polygon?.length) return false;

  if (!pointInRing(point, polygon[0])) {
    return false;
  }

  /*
    Exclude holes inside the outer polygon.
  */

  for (let i = 1; i < polygon.length; i++) {
    if (pointInRing(point, polygon[i])) {
      return false;
    }
  }

  return true;
}

function pointInGeometry(point, geometry) {
  if (!geometry) return false;

  if (geometry.type === "Polygon") {
    return pointInPolygon(
      point,
      geometry.coordinates
    );
  }

  if (geometry.type === "MultiPolygon") {
    return geometry.coordinates.some(
      polygon => pointInPolygon(point, polygon)
    );
  }

  return false;
}

function findSelectedBuilding(coordinates) {
  if (
    !campusMap ||
    !mapReady ||
    !buildingSource ||
    !buildingSourceLayer
  ) {
    return null;
  }

  /*
    Query visible building features.

    We only highlight a polygon containing
    the event coordinate.

    If no polygon contains it, we do not
    pretend that another building is correct.
  */

  let features = [];

  try {
    features = campusMap.querySourceFeatures(
      buildingSource,
      {
        sourceLayer: buildingSourceLayer
      }
    );
  } catch (error) {
    return null;
  }

  const match = features.find(feature =>
    pointInGeometry(
      coordinates,
      feature.geometry
    )
  );

  if (!match) return null;

  return {
    type: "Feature",
    properties: {
      selected: true
    },
    geometry: match.geometry
  };
}

function updateBuildingHighlight(coordinates) {
  const source = campusMap?.getSource(
    "odysc-selected-building"
  );

  if (!source) return;

  const building = findSelectedBuilding(
    coordinates
  );

  selectedBuildingGeometry = building;

  source.setData({
    type: "FeatureCollection",
    features: building ? [building] : []
  });

  const status = byId("mapStatus");

  if (status) {
    status.textContent = building
      ? "Destination building footprint highlighted. Demo coordinates are approximate; verify the building before real use."
      : "Destination highlighted with a gold pin. Exact building footprint could not be verified.";
  }
}

/* ==========================================
   16. EVENT MARKERS
   ========================================== */

function createEventMarkers() {
  if (!campusMap || !mapReady) return;

  mapMarkers.forEach(item => {
    item.marker.remove();
  });

  mapMarkers = [];

  /*
    Group events at the same coordinate so
    the map does not show duplicate markers.
  */

  const uniqueLocations = new Map();

  EVENTS.forEach(event => {
    const key = event.coordinates.join(",");

    if (!uniqueLocations.has(key)) {
      uniqueLocations.set(key, event);
    }
  });

  uniqueLocations.forEach(event => {
    const element = document.createElement(
      "button"
    );

    element.type = "button";
    element.className = "odysc-map-marker";

    element.setAttribute(
      "aria-label",
      `Select events at ${event.building}`
    );

    const popup = new maplibregl.Popup({
      offset: 28,
      closeButton: true
    });

    /*
      Popup text is built using DOM APIs
      instead of inserting untrusted HTML.
    */

    const content = document.createElement(
      "div"
    );

    const heading = document.createElement(
      "h3"
    );

    heading.textContent = event.building;

    const description = document.createElement(
      "p"
    );

    description.textContent =
      "Example campus event location";

    content.append(heading, description);

    popup.setDOMContent(content);

    const marker = new maplibregl.Marker({
      element,
      anchor: "center"
    })
      .setLngLat(event.coordinates)
      .setPopup(popup)
      .addTo(campusMap);

    element.addEventListener("click", () => {
      selectEvent(event.id);

      if (!popup.isOpen()) {
        marker.togglePopup();
      }
    });

    mapMarkers.push({
      eventId: event.id,
      coordinates: event.coordinates,
      marker,
      element
    });
  });
}

function updateSelectedMarker(event) {
  mapMarkers.forEach(item => {
    const sameLocation =
      item.coordinates[0] ===
        event.coordinates[0] &&
      item.coordinates[1] ===
        event.coordinates[1];

    item.element.classList.toggle(
      "selected",
      sameLocation
    );

    item.element.setAttribute(
      "aria-pressed",
      String(sameLocation)
    );
  });
}

/* ==========================================
   17. DEMO ROUTE
   ========================================== */

/*
  IMPORTANT:

  This is a straight-line visualization.

  It is NOT a pedestrian route and should
  never be used as walking instructions.

  Real navigation requires a routing API
  and validated campus paths.
*/

function addRouteLayers() {
  if (!campusMap || !mapReady) return;

  if (!campusMap.getSource("odysc-route")) {
    campusMap.addSource("odysc-route", {
      type: "geojson",
      data: emptyFeatureCollection()
    });
  }

  campusMap.addLayer({
    id: "odysc-route-glow",
    type: "line",
    source: "odysc-route",
    paint: {
      "line-color": "#ffcc00",
      "line-width": 13,
      "line-opacity": 0.35,
      "line-blur": 5
    }
  });

  campusMap.addLayer({
    id: "odysc-route-line",
    type: "line",
    source: "odysc-route",
    paint: {
      "line-color": "#990000",
      "line-width": 5,
      "line-opacity": 0.95,
      "line-dasharray": [2, 1.5]
    }
  });
}

function updateDemoRoute(destination) {
  if (!campusMap || !mapReady) return;

  const source = campusMap.getSource(
    "odysc-route"
  );

  if (!source) return;

  source.setData({
    type: "Feature",
    properties: {
      description:
        "Illustrative straight line only"
    },
    geometry: {
      type: "LineString",
      coordinates: [
        MAP_START,
        destination
      ]
    }
  });
}

/* ==========================================
   18. 2D AND 3D VIEW CONTROLS
   ========================================== */

function setLayerVisibility(id, visible) {
  if (!campusMap?.getLayer(id)) return;

  campusMap.setLayoutProperty(
    id,
    "visibility",
    visible ? "visible" : "none"
  );
}

function setMapMode(tilted) {
  mapTilted = Boolean(tilted);

  byId("map2d")?.classList.toggle(
    "active",
    !mapTilted
  );

  byId("map3d")?.classList.toggle(
    "active",
    mapTilted
  );

  if (!campusMap || !mapReady) return;

  setLayerVisibility(
    "odysc-3d-buildings",
    mapTilted
  );

  setLayerVisibility(
    "odysc-building-2d",
    !mapTilted
  );

  setLayerVisibility(
    "odysc-building-3d",
    mapTilted
  );

  const selected = getEvent(
    selectedEventId
  );

  campusMap.easeTo({
    center: selected
      ? selected.coordinates
      : USC_CENTER,

    zoom: mapTilted ? 17.5 : 16.5,

    pitch: mapTilted ? 65 : 0,

    bearing: mapTilted ? -35 : 0,

    duration: 1200,

    essential: true
  });
}

function resetMapView() {
  if (!campusMap || !mapReady) return;

  mapTilted = false;

  setLayerVisibility(
    "odysc-3d-buildings",
    false
  );

  setLayerVisibility(
    "odysc-building-2d",
    true
  );

  setLayerVisibility(
    "odysc-building-3d",
    false
  );

  byId("map2d")?.classList.add("active");
  byId("map3d")?.classList.remove("active");

  campusMap.easeTo({
    center: USC_CENTER,
    zoom: 16,
    pitch: 0,
    bearing: 0,
    duration: 1200
  });
}

/* ==========================================
   19. SELECT EVENT
   ========================================== */

function selectEvent(id) {
  const event = getEvent(id);
  if (!event) return;

  selectedEventId = id;

  const dropdown = byId("mapEvent");

  if (dropdown) {
    dropdown.value = id;
  }

  const details = byId("mapDetails");

  if (details) {
    details.innerHTML = `
      <h3>
        ${escapeHTML(
          getClubName(event.clubId)
        )}
      </h3>

      <p>
        <strong>Event:</strong>
        ${escapeHTML(event.title)}
      </p>

      <p>
        <strong>When:</strong>
        ${escapeHTML(event.day)} ·
        ${escapeHTML(event.time)}
      </p>

      <p>
        <strong>Destination:</strong>
        ${escapeHTML(event.building)}
      </p>

      <p class="fineprint">
        Fictional event · Approximate location
      </p>
    `;
  }

  /*
    External walking directions remain
    available as a fallback.
  */

  const mapsUrl = new URL(
    "https://www.google.com/maps/dir/"
  );

  mapsUrl.searchParams.set(
    "api",
    "1"
  );

  mapsUrl.searchParams.set(
    "destination",
    `${event.coordinates[1]},${event.coordinates[0]}`
  );

  mapsUrl.searchParams.set(
    "travelmode",
    "walking"
  );

  if (byId("mapDirections")) {
    byId("mapDirections").href =
      mapsUrl.toString();
  }

  if (!campusMap || !mapReady) return;

  updateSelectedMarker(event);

  updateDemoRoute(
    event.coordinates
  );

  /*
    Zoom toward the event.
    Query building geometry after map tiles
    have had an opportunity to load.
  */

  campusMap.easeTo({
    center: event.coordinates,
    zoom: mapTilted ? 17.5 : 17,
    pitch: mapTilted ? 65 : 0,
    bearing: mapTilted ? -35 : 0,
    duration: 1100
  });

  updateBuildingHighlight(
    event.coordinates
  );
}

/* ==========================================
   20. MAP INITIALIZATION
   ========================================== */

async function initializeCampusMap() {
  if (campusMap) {
    campusMap.resize();
    return;
  }

  if (mapLoading) return;

  const container = byId(
    "realCampusMap"
  );

  if (!container) return;

  mapLoading = true;

  showStatus(
    "mapStatus",
    "Loading interactive USC map..."
  );

  try {
    await loadMapLibre();

    campusMap = new maplibregl.Map({
      container: "realCampusMap",

      style: MAP_STYLE_URL,

      center: USC_CENTER,

      zoom: 16,

      pitch: 0,

      bearing: 0,

      antialias: true,

      attributionControl: true
    });

    campusMap.addControl(
      new maplibregl.NavigationControl({
        showCompass: true,
        showZoom: true
      }),
      "top-right"
    );

    campusMap.on("error", error => {
      console.warn(
        "Map rendering issue:",
        error.error || error
      );
    });

    campusMap.on("load", () => {
      mapReady = true;

      /*
        Order matters:
        1. Gray base layers
        2. Building layers
        3. Destination highlight
        4. Route
        5. Markers
      */

      applyGrayscaleMap();

      add3DBuildings();

      addHighlightLayers();

      addRouteLayers();

      createEventMarkers();

      selectEvent(selectedEventId);

      setMapMode(false);

      showStatus(
        "mapStatus",
        "Map ready · Sample locations and illustrative route."
      );
    });

    /*
      Retry footprint selection after new
      map tiles finish loading.

      The current selection may not be in
      the initially loaded tile area.
    */

    campusMap.on("idle", () => {
      if (!mapReady) return;

      const event = getEvent(
        selectedEventId
      );

      if (!event) return;

      if (!selectedBuildingGeometry) {
        updateBuildingHighlight(
          event.coordinates
        );
      }
    });

  } catch (error) {
    console.error(
      "Campus map failed:",
      error
    );

    showStatus(
      "mapStatus",
      "Map could not load. Check your internet connection and browser console."
    );

    campusMap = null;
    mapReady = false;

  } finally {
    mapLoading = false;
  }
}

/* ==========================================
   21. MAP EVENT CONTROLS
   ========================================== */

function setupMapControls() {
  const dropdown = byId("mapEvent");

  if (dropdown) {
    dropdown.innerHTML = EVENTS.map(event => `
      <option value="${escapeHTML(event.id)}">
        ${escapeHTML(
          getClubName(event.clubId)
        )} — ${escapeHTML(event.title)}
      </option>
    `).join("");

    dropdown.value = selectedEventId;

    dropdown.addEventListener(
      "change",
      event => {
        selectedBuildingGeometry = null;

        selectEvent(
          event.target.value
        );
      }
    );
  }

  byId("map2d")?.addEventListener(
    "click",
    () => setMapMode(false)
  );

  byId("map3d")?.addEventListener(
    "click",
    () => setMapMode(true)
  );

  byId("mapReset")?.addEventListener(
    "click",
    resetMapView
  );

  /*
    Populate event details even before
    the map has finished loading.
  */

  selectEvent(selectedEventId);
}

/* ==========================================
   22. INITIALIZE ODYSC
   ========================================== */

function initializeOdysc() {
  setupProfile();

  setupCommonApplication();

  setupDiscover();

  setupApplications();

  setupDashboard();

  setupEvents();

  setupMapControls();

  renderDashboard();

  renderClubs();

  renderApplications();

  renderEvents();

  setupNavigation();

  console.info(
    "Odysc student portal initialized."
  );
}

if (document.readyState === "loading") {
  document.addEventListener(
    "DOMContentLoaded",
    initializeOdysc,
    { once: true }
  );
} else {
  initializeOdysc();
}
