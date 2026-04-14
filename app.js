/*
  CanIFlyHere.us – updated map and airspace query logic
  Fixes:
  - parallel FAA layer queries
  - proper time-window handling for part-time restrictions
  - separate blocked / LAANC / advisory verdicts
  - exact point intersection for actual airspace checks
  - optional nearby search for fixed sites only
*/

require([
  "esri/Map",
  "esri/views/MapView",
  "esri/layers/FeatureLayer",
  "esri/Graphic",
  "esri/geometry/Point"
], function (
  Map,
  MapView,
  FeatureLayer,
  Graphic,
  Point
) {
  const statusEl = document.getElementById("status");
  const resultsEl = document.getElementById("results");
  const latEl = document.getElementById("lat");
  const lngEl = document.getElementById("lng");
  const btnGo = document.getElementById("btnGo");
  const btnLocate = document.getElementById("btnLocate");
  const btnClear = document.getElementById("btnClear");

  if (!statusEl || !resultsEl || !latEl || !lngEl || !btnGo || !btnLocate || !btnClear) {
    return;
  }

  function setStatus(msg, state) {
    statusEl.textContent = msg;
    statusEl.className = "status" + (state ? " " + state : "");
  }

  function clearResults() {
    resultsEl.innerHTML = "";
  }

  function addCard(title, badge, kind, rows) {
    const card = document.createElement("div");
    card.className = "card";

    const head = document.createElement("div");
    head.className = "cardTitle";

    const t = document.createElement("div");
    t.textContent = title;

    const b = document.createElement("div");
    b.className = "badge " + kind;
    b.textContent = badge;

    head.appendChild(t);
    head.appendChild(b);

    const kv = document.createElement("div");
    kv.className = "kv";

    rows.forEach(function (pair) {
      const kk = document.createElement("div");
      kk.className = "k";
      kk.textContent = pair[0];

      const vv = document.createElement("div");
      vv.textContent = pair[1];

      kv.appendChild(kk);
      kv.appendChild(vv);
    });

    card.appendChild(head);
    card.appendChild(kv);
    resultsEl.appendChild(card);
  }

  function formatDateTime(value) {
    if (!value) return "";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return String(value);
    return d.toLocaleString();
  }

  function isPartTimeRestrictionActive(attrs) {
    const now = Date.now();
    const start = attrs.START_TIME ? new Date(attrs.START_TIME).getTime() : null;
    const end = attrs.END_TIME ? new Date(attrs.END_TIME).getTime() : null;

    if (start && now < start) return false;
    if (end && now > end) return false;

    return true;
  }

  function buildRows(cfg, attrs) {
    const rows = [];

    cfg.fields.forEach(function (f) {
      if (attrs[f] === undefined || attrs[f] === null || attrs[f] === "") return;

      let value = attrs[f];

      if (f === "START_TIME" || f === "END_TIME") {
        value = formatDateTime(value);
      }

      rows.push([f, String(value)]);
    });

    if (cfg.key === "ns_part") {
      rows.push(["ACTIVE_NOW", isPartTimeRestrictionActive(attrs) ? "Yes" : "No"]);
    }

    return rows;
  }

  function makeFillRenderer(fillRgba, outlineRgba) {
    return {
      type: "simple",
      symbol: {
        type: "simple-fill",
        color: fillRgba,
        outline: {
          color: outlineRgba,
          width: 1
        }
      }
    };
  }

  const LAYERS = [
    {
      key: "uasfm",
      title: "LAANC / UAS Facility Map Grid",
      url: "https://services6.arcgis.com/ssFJjBXIUyZDrSYZ/arcgis/rest/services/FAA_UAS_FacilityMap_Data/FeatureServer/0",
      renderer: makeFillRenderer([14, 165, 233, 0.18], [14, 165, 233, 0.7]),
      hitBadge: "Authorization likely",
      hitKind: "warn",
      category: "laanc",
      fields: ["MAX_ALT", "CEILING", "GRID_MAX_ALT"],
      queryMode: "point"
    },
    {
      key: "ns_full",
      title: "Permanent National Security Restriction",
      url: "https://services6.arcgis.com/ssFJjBXIUyZDrSYZ/arcgis/rest/services/DoD_Mar_13/FeatureServer/0",
      renderer: makeFillRenderer([244, 63, 94, 0.22], [244, 63, 94, 0.75]),
      hitBadge: "Do not fly",
      hitKind: "bad",
      category: "blocked",
      fields: ["NAME"],
      queryMode: "point"
    },
    {
      key: "ns_part",
      title: "Part-Time National Security Restriction",
      url: "https://services6.arcgis.com/ssFJjBXIUyZDrSYZ/arcgis/rest/services/Part_Time_National_Security_UAS_Flight_Restrictions/FeatureServer/0",
      renderer: makeFillRenderer([249, 115, 22, 0.20], [249, 115, 22, 0.70]),
      hitBadge: "Do not fly",
      hitKind: "bad",
      category: "blocked",
      fields: ["NAME", "START_TIME", "END_TIME"],
      queryMode: "point"
    },
    {
      key: "prohibited",
      title: "Prohibited Area",
      url: "https://services6.arcgis.com/ssFJjBXIUyZDrSYZ/arcgis/rest/services/Prohibited_Areas/FeatureServer/0",
      renderer: makeFillRenderer([220, 38, 38, 0.28], [220, 38, 38, 0.85]),
      hitBadge: "Do not fly",
      hitKind: "bad",
      category: "blocked",
      fields: ["NAME"],
      queryMode: "point"
    },
    {
      key: "rec_flyer",
      title: "Recreational Flyer Fixed Site",
      url: "https://services6.arcgis.com/ssFJjBXIUyZDrSYZ/arcgis/rest/services/Recreational_Flyer_Fixed_Sites/FeatureServer/0",
      renderer: makeFillRenderer([34, 211, 165, 0.18], [34, 211, 165, 0.65]),
      hitBadge: "Fixed site nearby",
      hitKind: "warn",
      category: "advisory",
      fields: ["NAME"],
      queryMode: "nearby",
      nearbyDistanceMeters: 5000
    },
    {
      key: "fria",
      title: "FAA Recognized Identification Area (FRIA)",
      url: "https://services6.arcgis.com/ssFJjBXIUyZDrSYZ/arcgis/rest/services/FAA_Recognized_Identification_Areas/FeatureServer/0",
      renderer: makeFillRenderer([139, 92, 246, 0.18], [139, 92, 246, 0.65]),
      hitBadge: "FRIA",
      hitKind: "warn",
      category: "advisory",
      fields: ["NAME"],
      queryMode: "point"
    }
  ];

  const map = new Map({ basemap: "streets-navigation-vector" });
  const featureLayers = {};

  LAYERS.forEach(function (cfg) {
    const layer = new FeatureLayer({
      url: cfg.url,
      outFields: ["*"],
      renderer: cfg.renderer,
      visible: true
    });

    featureLayers[cfg.key] = layer;
    map.add(layer);
  });

  const view = new MapView({
    container: "viewDiv",
    map: map,
    center: [-96.7970, 32.7767],
    zoom: 9
  });

  let pin = null;

  function placePin(point) {
    if (pin) view.graphics.remove(pin);

    pin = new Graphic({
      geometry: point,
      symbol: {
        type: "simple-marker",
        size: 11,
        color: [14, 165, 233, 230],
        outline: {
          color: [255, 255, 255, 220],
          width: 2
        }
      }
    });

    view.graphics.add(pin);
  }

  async function queryLayer(cfg, point) {
    const layer = featureLayers[cfg.key];
    const q = layer.createQuery();

    q.returnGeometry = false;
    q.outFields = ["*"];
    q.num = 1;

    if (cfg.queryMode === "nearby") {
      q.geometry = point;
      q.distance = cfg.nearbyDistanceMeters || 1000;
      q.units = "meters";
      q.spatialRelationship = "intersects";
    } else {
      q.geometry = point;
      q.spatialRelationship = "intersects";
    }

    const res = await layer.queryFeatures(q);
    return res.features || [];
  }

  function shouldUseFeature(cfg, attrs) {
    if (cfg.key === "ns_part") {
      return isPartTimeRestrictionActive(attrs);
    }
    return true;
  }

  async function runCheck(point) {
    clearResults();
    setStatus("Querying FAA airspace data…", "");

    const verdict = {
      blocked: false,
      laanc: false,
      advisory: false
    };

    const checks = await Promise.all(
      LAYERS.map(async function (cfg) {
        try {
          const feats = await queryLayer(cfg, point);
          return { cfg, feats };
        } catch (err) {
          console.warn("Query error for layer " + cfg.key, err);
          return { cfg, feats: [], error: err };
        }
      })
    );

    checks.forEach(function (result) {
      const cfg = result.cfg;
      const feats = result.feats;

      if (!feats || feats.length === 0) return;

      const usable = feats.find(function (f) {
        return shouldUseFeature(cfg, f.attributes || {});
      });

      if (!usable) return;

      const attrs = usable.attributes || {};
      const rows = buildRows(cfg, attrs);

      addCard(cfg.title, cfg.hitBadge, cfg.hitKind, rows);

      if (cfg.category === "blocked") verdict.blocked = true;
      if (cfg.category === "laanc") verdict.laanc = true;
      if (cfg.category === "advisory") verdict.advisory = true;
    });

    if (verdict.blocked) {
      setStatus("Do not fly. An active FAA-restricted area was detected at this location.", "bad");
    } else if (verdict.laanc) {
      setStatus("Controlled airspace detected. LAANC authorization is likely required before flight.", "warn");
    } else if (verdict.advisory) {
      setStatus("No blocking FAA restriction found, but an advisory layer applies at or near this location.", "warn");
    } else {
      setStatus("No key FAA restrictions found at this point. Still verify TFRs and local rules before flying.", "good");
    }
  }

  view.on("click", async function (e) {
    const p = new Point({
      latitude: e.mapPoint.latitude,
      longitude: e.mapPoint.longitude,
      spatialReference: { wkid: 4326 }
    });

    latEl.value = p.latitude.toFixed(6);
    lngEl.value = p.longitude.toFixed(6);

    placePin(p);
    view.goTo({ center: [p.longitude, p.latitude], zoom: 12 });

    await runCheck(p);
  });

  btnGo.addEventListener("click", async function () {
    const lat = parseFloat(latEl.value);
    const lng = parseFloat(lngEl.value);

    if (Number.isNaN(lat) || Number.isNaN(lng)) {
      setStatus("Enter valid decimal coordinates.", "bad");
      return;
    }

    const p = new Point({
      latitude: lat,
      longitude: lng,
      spatialReference: { wkid: 4326 }
    });

    placePin(p);
    view.goTo({ center: [lng, lat], zoom: 12 });

    await runCheck(p);
  });

  btnClear.addEventListener("click", function () {
    latEl.value = "";
    lngEl.value = "";
    clearResults();

    if (pin) view.graphics.remove(pin);
    pin = null;

    setStatus("Click the map or enter coordinates to run a check.", "muted");
  });

  btnLocate.addEventListener("click", function () {
    if (!navigator.geolocation) {
      setStatus("Geolocation is not supported by this browser.", "bad");
      return;
    }

    setStatus("Getting your location…", "");

    navigator.geolocation.getCurrentPosition(
      async function (pos) {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;

        latEl.value = lat.toFixed(6);
        lngEl.value = lng.toFixed(6);

        const p = new Point({
          latitude: lat,
          longitude: lng,
          spatialReference: { wkid: 4326 }
        });

        placePin(p);
        view.goTo({ center: [lng, lat], zoom: 12 });

        await runCheck(p);
      },
      function (err) {
        setStatus("Location access denied or unavailable.", "bad");
        console.warn("Geolocation error:", err);
      },
      {
        enableHighAccuracy: true,
        timeout: 12000,
        maximumAge: 0
      }
    );
  });

  setStatus("Click the map or enter coordinates to run a check.", "muted");
});