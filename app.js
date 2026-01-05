/*
  CanIFlyHere.us - Pilot friendly FAA layer check (planning tool)

  Verdict logic:
  - DO NOT FLY: National Security UAS Flight Restrictions (full or part time) OR Prohibited Areas
  - LAANC LIKELY: UAS Facility Map grid hit (shows ceiling)
  - OK: none of the above detected

  Notes:
  - This is not a TFR feed. TFRs change fast. Always verify official FAA sources.
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

  /* ---------------- DOM ---------------- */

  const statusEl   = document.getElementById("status");
  const resultsEl  = document.getElementById("results");
  const verdictEl  = document.getElementById("verdict");
  const latEl      = document.getElementById("lat");
  const lngEl      = document.getElementById("lng");
  const btnGo      = document.getElementById("btnGo");
  const btnLocate  = document.getElementById("btnLocate");
  const btnClear   = document.getElementById("btnClear");

  // Ensure verdict NEVER shows on load
  if (verdictEl) verdictEl.classList.add("hidden");

  function setStatus(msg, muted = true) {
    statusEl.textContent = msg;
    statusEl.className = muted ? "status muted" : "status";
  }

  function clearResults() {
    resultsEl.innerHTML = "";
    if (verdictEl) verdictEl.classList.add("hidden");
  }

  function setVerdict(type, title, message) {
    if (!verdictEl) return;
    verdictEl.className = `verdict ${type}`;
    verdictEl.querySelector(".verdict-title").textContent = title;
    verdictEl.querySelector(".verdict-message").textContent = message;
    verdictEl.classList.remove("hidden");
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

  /* ---------------- FAA Layers (ONLY IMPORTANT) ---------------- */

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
    setStatus("Checking FAA airspace data…", false);

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
      setVerdict(
        "bad",
        "Do not fly",
        "This location falls within FAA-restricted airspace."
      );
    } else if (caution) {
      setVerdict(
        "warn",
        "Authorization likely",
        "This location is within controlled airspace. LAANC authorization may be required."
      );
    } else {
      setVerdict(
        "good",
        "Looks clear",
        "No key FAA restrictions detected at this point. Always verify TFRs and local rules."
      );
    }

    setStatus("Check complete.", true);
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
      setStatus("Enter valid coordinates.", false);
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
    setStatus("Click the map or enter coordinates to check.", true);
  });

});
