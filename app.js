/*
  CanIFlyHere.us – map and airspace query logic
  Queries FAA ArcGIS feature layers and displays results in the sidebar.
  Requires ArcGIS JS API 4.30 loaded via CDN.
*/

require([
  "esri/Map",
  "esri/views/MapView",
  "esri/layers/FeatureLayer",
  "esri/Graphic",
  "esri/geometry/Point",
  "esri/geometry/geometryEngine",
  "esri/renderers/SimpleRenderer",
  "esri/symbols/SimpleFillSymbol",
  "esri/symbols/SimpleLineSymbol",
  "esri/symbols/SimpleMarkerSymbol"
], function (
  Map,
  MapView,
  FeatureLayer,
  Graphic,
  Point,
  geometryEngine,
  SimpleRenderer,
  SimpleFillSymbol,
  SimpleLineSymbol,
  SimpleMarkerSymbol
) {

  /* ── DOM refs ─────────────────────────────── */
  const statusEl  = document.getElementById("status");
  const resultsEl = document.getElementById("results");
  const latEl     = document.getElementById("lat");
  const lngEl     = document.getElementById("lng");
  const btnGo     = document.getElementById("btnGo");
  const btnLocate = document.getElementById("btnLocate");
  const btnClear  = document.getElementById("btnClear");

  if (!statusEl || !resultsEl || !latEl || !lngEl || !btnGo || !btnLocate || !btnClear) {
    return; // not on the homepage
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

    rows.forEach(function(pair) {
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

  /* ── Layer renderers ──────────────────────── */
  // Semi-transparent fills so basemap roads/labels remain visible underneath
  function makeFillRenderer(fillRgba, outlineRgba) {
    return new SimpleRenderer({
      symbol: new SimpleFillSymbol({
        color: fillRgba,
        outline: new SimpleLineSymbol({ color: outlineRgba, width: 1 })
      })
    });
  }

  /* ── FAA layer definitions ────────────────── */
  const LAYERS = [
    {
      key:      "uasfm",
      title:    "LAANC / UAS Facility Map Grid",
      url:      "https://services6.arcgis.com/ssFJjBXIUyZDrSYZ/arcgis/rest/services/FAA_UAS_FacilityMap_Data/FeatureServer/0",
      renderer: makeFillRenderer([14, 165, 233, 0.18], [14, 165, 233, 0.7]),
      hitBadge: "Authorization likely",
      hitKind:  "warn",
      fields:   ["MAX_ALT", "CEILING", "GRID_MAX_ALT"]
    },
    {
      key:      "ns_full",
      title:    "Permanent National Security Restriction",
      url:      "https://services6.arcgis.com/ssFJjBXIUyZDrSYZ/arcgis/rest/services/DoD_Mar_13/FeatureServer/0",
      renderer: makeFillRenderer([244, 63, 94, 0.22], [244, 63, 94, 0.75]),
      hitBadge: "Do not fly",
      hitKind:  "bad",
      fields:   ["NAME"]
    },
    {
      key:      "ns_part",
      title:    "Part-Time National Security Restriction",
      url:      "https://services6.arcgis.com/ssFJjBXIUyZDrSYZ/arcgis/rest/services/Part_Time_National_Security_UAS_Flight_Restrictions/FeatureServer/0",
      renderer: makeFillRenderer([249, 115, 22, 0.20], [249, 115, 22, 0.70]),
      hitBadge: "Do not fly",
      hitKind:  "bad",
      fields:   ["NAME", "START_TIME", "END_TIME"]
    },
    {
      key:      "prohibited",
      title:    "Prohibited Area",
      url:      "https://services6.arcgis.com/ssFJjBXIUyZDrSYZ/arcgis/rest/services/Prohibited_Areas/FeatureServer/0",
      renderer: makeFillRenderer([220, 38, 38, 0.28], [220, 38, 38, 0.85]),
      hitBadge: "Do not fly",
      hitKind:  "bad",
      fields:   ["NAME"]
    },
    {
      key:      "rec_flyer",
      title:    "Recreational Flyer Fixed Site",
      url:      "https://services6.arcgis.com/ssFJjBXIUyZDrSYZ/arcgis/rest/services/Recreational_Flyer_Fixed_Sites/FeatureServer/0",
      renderer: makeFillRenderer([34, 211, 165, 0.18], [34, 211, 165, 0.65]),
      hitBadge: "Fixed site nearby",
      hitKind:  "warn",
      fields:   ["NAME"]
    },
    {
      key:      "fria",
      title:    "FAA Recognized Identification Area (FRIA)",
      url:      "https://services6.arcgis.com/ssFJjBXIUyZDrSYZ/arcgis/rest/services/FAA_Recognized_Identification_Areas/FeatureServer/0",
      renderer: makeFillRenderer([139, 92, 246, 0.18], [139, 92, 246, 0.65]),
      hitBadge: "FRIA",
      hitKind:  "warn",
      fields:   ["NAME"]
    }
  ];

  /* ── Map setup ────────────────────────────── */
  const map = new Map({ basemap: "streets-navigation-vector" });
  const featureLayers = {};

  LAYERS.forEach(function(cfg) {
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
    center: [-96.3344, 30.6280],
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
        outline: { color: [255, 255, 255, 220], width: 2 }
      }
    });
    view.graphics.add(pin);
  }

  /* ── Query ────────────────────────────────── */
  async function queryLayer(layer, point) {
    const q = layer.createQuery();
    q.geometry = geometryEngine.geodesicBuffer(point, 250, "meters");
    q.spatialRelationship = "intersects";
    q.returnGeometry = false;
    q.outFields = ["*"];
    q.num = 1;
    const res = await layer.queryFeatures(q);
    return res.features || [];
  }

  async function runCheck(point) {
    clearResults();
    setStatus("Querying FAA airspace data…", "");

    let danger  = false;
    let caution = false;

    for (const cfg of LAYERS) {
      try {
        const feats = await queryLayer(featureLayers[cfg.key], point);
        if (feats.length > 0) {
          const attrs = feats[0].attributes;
          const rows = cfg.fields
            .filter(function(f) { return attrs[f] !== undefined && attrs[f] !== null; })
            .map(function(f) { return [f, String(attrs[f])]; });

          addCard(cfg.title, cfg.hitBadge, cfg.hitKind, rows);

          if (cfg.hitKind === "bad")  danger  = true;
          if (cfg.hitKind === "warn") caution = true;
        }
      } catch (err) {
        console.warn("Query error for layer " + cfg.key, err);
      }
    }

    if (danger) {
      setStatus("Do not fly — FAA-restricted airspace detected at this location.", "bad");
    } else if (caution) {
      setStatus("LAANC authorization likely required — controlled airspace detected.", "warn");
    } else {
      setStatus("No key FAA restrictions found. Verify TFRs and local rules before flying.", "good");
    }
  }

  /* ── Events ───────────────────────────────── */
  view.on("click", async function(e) {
    const p = new Point({
      latitude:  e.mapPoint.latitude,
      longitude: e.mapPoint.longitude,
      spatialReference: { wkid: 4326 }
    });
    latEl.value = p.latitude.toFixed(6);
    lngEl.value = p.longitude.toFixed(6);
    placePin(p);
    view.goTo({ center: [p.longitude, p.latitude], zoom: 12 });
    await runCheck(p);
  });

  btnGo.addEventListener("click", async function() {
    const lat = parseFloat(latEl.value);
    const lng = parseFloat(lngEl.value);
    if (isNaN(lat) || isNaN(lng)) {
      setStatus("Enter valid decimal coordinates.", "bad");
      return;
    }
    const p = new Point({ latitude: lat, longitude: lng, spatialReference: { wkid: 4326 } });
    placePin(p);
    view.goTo({ center: [lng, lat], zoom: 12 });
    await runCheck(p);
  });

  btnClear.addEventListener("click", function() {
    latEl.value = "";
    lngEl.value = "";
    clearResults();
    if (pin) view.graphics.remove(pin);
    pin = null;
    setStatus("Click the map or enter coordinates to run a check.", "muted");
  });

  btnLocate.addEventListener("click", function() {
    if (!navigator.geolocation) {
      setStatus("Geolocation is not supported by this browser.", "bad");
      return;
    }
    setStatus("Getting your location…", "");
    navigator.geolocation.getCurrentPosition(
      async function(pos) {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        latEl.value = lat.toFixed(6);
        lngEl.value = lng.toFixed(6);
        const p = new Point({ latitude: lat, longitude: lng, spatialReference: { wkid: 4326 } });
        placePin(p);
        view.goTo({ center: [lng, lat], zoom: 12 });
        await runCheck(p);
      },
      function(err) {
        setStatus("Location access denied or unavailable.", "bad");
        console.warn("Geolocation error:", err);
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 }
    );
  });

  setStatus("Click the map or enter coordinates to run a check.", "muted");
});
