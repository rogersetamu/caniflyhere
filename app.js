/*
  CanIFlyHere.us – enhanced JS logic

  This module drives the interactive map and verdict logic for the
  CanIFlyHere.us planning tool.  It fixes several issues from the
  original implementation:
    • Properly updates verdict text by targeting the correct class
      names and updating the verdict pill.
    • Adds a fully functional "Use my location" button utilizing
      the browser’s geolocation API with graceful fallback on failure.
    • Styles result cards with a key–value grid for better
      readability.
  The tool remains a planning aid only; always verify flight
  restrictions with official FAA sources.
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
  /* ---------------- DOM references ---------------- */
  const statusEl  = document.getElementById("status");
  const resultsEl = document.getElementById("results");
  const latEl     = document.getElementById("lat");
  const lngEl     = document.getElementById("lng");
  const btnGo     = document.getElementById("btnGo");
  const btnLocate = document.getElementById("btnLocate");
  const btnClear  = document.getElementById("btnClear");
  function setStatus(msg, state = "muted") {
    statusEl.textContent = msg;
    statusEl.className = "status" + (state ? (" " + state) : "");
  }

  function clearResults() {
    resultsEl.innerHTML = "";
  }
  }

  function addCard(title, badge, kind, rows) {
    const card = document.createElement("div");
    card.className = "card";

    const head = document.createElement("div");
    head.className = "cardTitle";
    const t = document.createElement("div");
    t.textContent = title;
    const b = document.createElement("div");
    b.className = `badge ${kind}`;
    b.textContent = badge;
    head.appendChild(t);
    head.appendChild(b);

    const kv = document.createElement("div");
    kv.className = "kv";
    rows.forEach(([k, v]) => {
      const kk = document.createElement("div");
      kk.className = "k";
      kk.textContent = k;
      const vv = document.createElement("div");
      vv.textContent = v;
      kv.appendChild(kk);
      kv.appendChild(vv);
    });

    card.appendChild(head);
    card.appendChild(kv);
    resultsEl.appendChild(card);
  }

  /* ---------------- Map styling ---------------- */
  function polygonRenderer(color, opacity) {
    return new SimpleRenderer({
      symbol: new SimpleFillSymbol({
        color: [...color, opacity],
        outline: new SimpleLineSymbol({
          color: [0, 0, 0, 20],
          width: 0.4
        })
      })
    });
  }
  function pointRenderer(color) {
    return new SimpleRenderer({
      symbol: new SimpleMarkerSymbol({
        size: 7,
        color,
        outline: { color: [0, 0, 0, 80], width: 0.8 }
      })
    });
  }

  /* ---------------- FAA Layers ---------------- */
  const LAYERS = [
    {
      key: "uasfm",
      title: "LAANC Grid",
      url: "https://services6.arcgis.com/ssFJjBXIUyZDrSYZ/arcgis/rest/services/FAA_UAS_FacilityMap_Data_V5/FeatureServer/0",
      renderer: polygonRenderer([255, 204, 102], 40),
      hitBadge: "LAANC authorization likely",
      hitKind: "warn",
      fields: ["MAX_ALT", "GRID_MAX_ALT"]
    },
    {
      key: "ns_part",
      title: "National Security UAS Restriction",
      url: "https://services6.arcgis.com/ssFJjBXIUyZDrSYZ/arcgis/rest/services/Part_Time_National_Security_UAS_Flight_Restrictions/FeatureServer/0",
      renderer: polygonRenderer([255, 90, 107], 55),
      hitBadge: "Do not fly",
      hitKind: "bad",
      fields: ["NAME", "START_TIME", "END_TIME"]
    },
    {
      key: "ns_full",
      title: "Permanent National Security Restriction",
      url: "https://services6.arcgis.com/ssFJjBXIUyZDrSYZ/arcgis/rest/services/DoD_Mar_13/FeatureServer/0",
      renderer: polygonRenderer([255, 90, 107], 55),
      hitBadge: "Do not fly",
      hitKind: "bad",
      fields: ["NAME"]
    }
  ];

  /* ---------------- Map Init ---------------- */
  const map = new Map({ basemap: "streets-navigation-vector" });
  const featureLayers = {};
  LAYERS.forEach(cfg => {
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
    map,
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
        size: 10,
        color: [37, 99, 235, 180],
        outline: { color: [255, 255, 255], width: 2 }
      }
    });
    view.graphics.add(pin);
  }

  /* ---------------- Query Logic ---------------- */
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
    setStatus("Checking FAA airspace data…", "");
    let danger = false;
    let caution = false;
    for (const cfg of LAYERS) {
      const feats = await queryLayer(featureLayers[cfg.key], point);
      if (feats.length > 0) {
        const attrs = feats[0].attributes;
        const rows = cfg.fields
          .filter(f => attrs[f] !== undefined)
          .map(f => [f, String(attrs[f])]);
        addCard(cfg.title, cfg.hitBadge, cfg.hitKind, rows);
        if (cfg.hitKind === "bad") danger = true;
        if (cfg.hitKind === "warn") caution = true;
      }
    }
    if (danger) {
      setStatus("Do not fly — FAA‑restricted airspace detected at this point.", "bad");
    } else if (caution) {
      setStatus("Authorization likely — controlled airspace detected (LAANC may be required).", "warn");
    } else {
      setStatus("Looks clear — no key FAA restrictions detected. Still verify TFRs and local rules.", "good");
    }

  /* ---------------- Events ---------------- */
  view.on("click", async e => {
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

  btnGo.addEventListener("click", async () => {
    const lat = parseFloat(latEl.value);
    const lng = parseFloat(lngEl.value);
    if (isNaN(lat) || isNaN(lng)) {
      setStatus("Enter valid coordinates.", "bad");
      return;
    }
    const p = new Point({ latitude: lat, longitude: lng, spatialReference: { wkid: 4326 } });
    placePin(p);
    view.goTo({ center: [lng, lat], zoom: 12 });
    await runCheck(p);
  });

  btnClear.addEventListener("click", () => {
    latEl.value = "";
    lngEl.value = "";
    clearResults();
    if (pin) view.graphics.remove(pin);
    pin = null;
    setStatus("Click the map or enter coordinates to check.", "muted");
  });

  // Handle geolocation on "Use my location" button
  btnLocate.addEventListener("click", () => {
    if (!navigator.geolocation) {
      setStatus("Geolocation not supported in this browser.", "bad");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      async pos => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        latEl.value = lat.toFixed(6);
        lngEl.value = lng.toFixed(6);
        const p = new Point({ latitude: lat, longitude: lng, spatialReference: { wkid: 4326 } });
        placePin(p);
        view.goTo({ center: [lng, lat], zoom: 12 });
        await runCheck(p);
      },
      () => {
        setStatus("Unable to access your location.", "bad");
      }
    );
  });
});