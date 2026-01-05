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
  "esri/symbols/SimpleLineSymbol"
], function (
  Map,
  MapView,
  FeatureLayer,
  Graphic,
  Point,
  geometryEngine,
  SimpleRenderer,
  SimpleFillSymbol,
  SimpleLineSymbol
) {
  const statusEl = document.getElementById("status");
  const resultsEl = document.getElementById("results");
  const verdictWrap = document.getElementById("verdict");
  const verdictPill = document.getElementById("verdictPill");
  const verdictTitle = document.getElementById("verdictTitle");
  const verdictMsg = document.getElementById("verdictMsg");

  const latEl = document.getElementById("lat");
  const lngEl = document.getElementById("lng");
  const btnGo = document.getElementById("btnGo");
  const btnLocate = document.getElementById("btnLocate");
  const btnClear = document.getElementById("btnClear");

  function setStatus(msg, muted) {
    statusEl.textContent = msg;
    statusEl.className = muted ? "status muted" : "status";
  }

  function clearResults() {
    resultsEl.innerHTML = "";
  }

  function setVerdict(kind, title, msg) {
    verdictWrap.classList.remove("hidden");

    verdictPill.className = "pill " + (kind === "bad" ? "bad" : kind === "warn" ? "warn" : "good");
    verdictPill.textContent = kind === "bad" ? "DO NOT FLY" : kind === "warn" ? "LAANC LIKELY" : "OK";

    verdictTitle.textContent = title;
    verdictMsg.textContent = msg;
  }

  function makeCleanPolyRenderer(kind) {
    const outline = new SimpleLineSymbol({
      style: "solid",
      color: [0, 0, 0, 30],
      width: 0.6
    });

    const fill = new SimpleFillSymbol({
      style: "solid",
      color:
        kind === "bad" ? [255, 90, 107, 55] :
        kind === "warn" ? [255, 204, 102, 40] :
        [53, 208, 127, 28],
      outline
    });

    return new SimpleRenderer({ symbol: fill });
  }

  // IMPORTANT LAYERS ONLY
  const LAYERS = [
    {
      key: "uasfm",
      title: "LAANC grid (UAS Facility Map)",
      url: "https://services6.arcgis.com/ssFJjBXIUyZDrSYZ/arcgis/rest/services/FAA_UAS_FacilityMap_Data_V5/FeatureServer/0",
      kind: "warn",
      visible: true,
      minScale: 2000000,
      badgeHit: "LAANC likely",
      badgeMiss: "No LAANC grid here"
    },
    {
      key: "ns_part",
      title: "National security UAS restrictions (part time)",
      url: "https://services6.arcgis.com/ssFJjBXIUyZDrSYZ/arcgis/rest/services/Part_Time_National_Security_UAS_Flight_Restrictions/FeatureServer/0",
      kind: "bad",
      visible: true,
      minScale: 3000000,
      badgeHit: "Restriction",
      badgeMiss: "No restriction here"
    },
    {
      key: "ns_full",
      title: "National security UAS restrictions (full time)",
      url: "https://services6.arcgis.com/ssFJjBXIUyZDrSYZ/arcgis/rest/services/DoD_Mar_13/FeatureServer/0",
      kind: "bad",
      visible: true,
      minScale: 3000000,
      badgeHit: "Restriction",
      badgeMiss: "No restriction here"
    },
    {
      key: "prohibited",
      title: "Prohibited areas",
      url: "https://services6.arcgis.com/ssFJjBXIUyZDrSYZ/arcgis/rest/services/Prohibited_Areas/FeatureServer/0",
      kind: "bad",
      visible: true,
      minScale: 3000000,
      badgeHit: "Prohibited",
      badgeMiss: "None detected"
    }
  ];

  const map = new Map({
    basemap: "streets-navigation-vector"
  });

  const featureLayers = {};
  LAYERS.forEach(cfg => {
    const layer = new FeatureLayer({
      url: cfg.url,
      title: cfg.title,
      outFields: ["*"],
      visible: cfg.visible,
      minScale: cfg.minScale
    });

    layer.renderer = makeCleanPolyRenderer(cfg.kind);
    featureLayers[cfg.key] = layer;
    map.add(layer);
  });

  const view = new MapView({
    container: "viewDiv",
    map: map,
    center: [-96.3344, 30.6280],
    zoom: 9,
    constraints: { minZoom: 3 }
  });

  let pinGraphic = null;

  function placePin(point) {
    if (pinGraphic) view.graphics.remove(pinGraphic);

    pinGraphic = new Graphic({
      geometry: point,
      symbol: {
        type: "simple-marker",
        style: "circle",
        size: 10,
        color: [74, 163, 255, 190],
        outline: { color: [255, 255, 255, 230], width: 2 }
      }
    });

    view.graphics.add(pinGraphic);
  }

  function parseLatLng() {
    const lat = Number(String(latEl.value || "").trim());
    const lng = Number(String(lngEl.value || "").trim());
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
    return { lat, lng };
  }

  function safeBuffer(geom, meters) {
    try {
      const gb = geometryEngine.geodesicBuffer(geom, meters, "meters");
      return gb || geom;
    } catch {
      return geom;
    }
  }

  function toCeilingFeet(attrs) {
    if (!attrs) return null;
    const candidates = [
      "CEILING", "Ceiling", "GRID_MAX_ALT", "MAX_ALT", "MAX_ALTITUDE",
      "ALTITUDE", "GridCeiling", "GRIDCEILING", "MaxAlt", "max_alt"
    ];
    for (const k of candidates) {
      const v = attrs[k];
      if (v === undefined || v === null) continue;
      const n = Number(v);
      if (Number.isFinite(n)) return n;
      const s = String(v).trim();
      const parsed = Number(s);
      if (Number.isFinite(parsed)) return parsed;
    }
    return null;
  }

  function addCard(title, badgeText, badgeKind, shortLine, bullets) {
    const card = document.createElement("div");
    card.className = "card";

    const head = document.createElement("div");
    head.className = "cardHead";

    const left = document.createElement("div");
    const t = document.createElement("div");
    t.className = "cardTitle";
    t.textContent = title;

    const s = document.createElement("div");
    s.className = "cardSmall";
    s.textContent = shortLine;

    left.appendChild(t);
    left.appendChild(s);

    const badge = document.createElement("div");
    badge.className = "badge " + badgeKind;
    badge.textContent = badgeText;

    head.appendChild(left);
    head.appendChild(badge);
    card.appendChild(head);

    if (bullets && bullets.length) {
      const details = document.createElement("details");
      details.className = "details";

      const summary = document.createElement("summary");
      summary.textContent = "Show details";
      details.appendChild(summary);

      const list = document.createElement("ul");
      bullets.slice(0, 6).forEach(txt => {
        const li = document.createElement("li");
        li.textContent = txt;
        list.appendChild(li);
      });
      details.appendChild(list);
      card.appendChild(details);
    }

    resultsEl.appendChild(card);
  }

  async function queryLayerAtPoint(layer, point) {
    const buffered = safeBuffer(point, 250);
    const q = layer.createQuery();
    q.geometry = buffered;
    q.spatialRelationship = "intersects";
    q.returnGeometry = false;
    q.outFields = ["*"];
    q.num = 5;
    const res = await layer.queryFeatures(q);
    return res.features || [];
  }

  async function runCheck(point) {
    clearResults();
    setStatus("Checking FAA layers…", false);

    const results = await Promise.all(
      LAYERS.map(async cfg => {
        const layer = featureLayers[cfg.key];
        try {
          const feats = await queryLayerAtPoint(layer, point);
          return { cfg, feats, error: null };
        } catch (err) {
          return { cfg, feats: [], error: err };
        }
      })
    );

    const hits = {};
    results.forEach(r => {
      hits[r.cfg.key] = (r.feats && r.feats.length) ? r.feats : [];
    });

    const hasNS = (hits.ns_full && hits.ns_full.length) || (hits.ns_part && hits.ns_part.length);
    const hasProhibited = (hits.prohibited && hits.prohibited.length);
    const hasUASFM = (hits.uasfm && hits.uasfm.length);

    if (hasNS || hasProhibited) {
      setVerdict(
        "bad",
        "Do not fly here",
        "This point intersects an FAA restriction or prohibited area. Do not fly unless you have explicit authorization."
      );
    } else if (hasUASFM) {
      const a = hits.uasfm[0].attributes || {};
      const ceiling = toCeilingFeet(a);
      const msg = ceiling !== null
        ? "This point is inside a LAANC grid. The grid ceiling here is about " + ceiling + " ft AGL. Authorization may be required."
        : "This point is inside a LAANC grid. Authorization may be required.";
      setVerdict("warn", "LAANC likely required", msg);
    } else {
      setVerdict(
        "good",
        "Looks clear",
        "This tool did not detect key FAA restriction layers at this point. Still verify TFRs and local rules before flying."
      );
    }

    // Cards (simple)
    for (const r of results) {
      const cfg = r.cfg;

      if (r.error) {
        addCard(
          cfg.title,
          "Unavailable",
          "warn",
          "This layer could not be checked right now.",
          ["Try again later or verify using official FAA tools."]
        );
        continue;
      }

      const feats = r.feats || [];
      if (!feats.length) {
        addCard(cfg.title, cfg.badgeMiss, "good", "No match detected near this point.", []);
        continue;
      }

      // Build human bullets per layer
      const attrs = feats[0].attributes || {};
      const bullets = [];

      if (cfg.key === "uasfm") {
        const ceiling = toCeilingFeet(attrs);
        if (ceiling !== null) bullets.push("LAANC grid ceiling: about " + ceiling + " ft AGL");
        bullets.push("If you are flying Part 107 in controlled airspace, LAANC authorization is commonly required.");
      }

      if (cfg.key === "ns_full" || cfg.key === "ns_part") {
        if (attrs.NAME) bullets.push("Name: " + String(attrs.NAME));
        if (attrs.AGENCY) bullets.push("Agency: " + String(attrs.AGENCY));
        if (attrs.REMARKS) bullets.push("Notes: " + String(attrs.REMARKS));
        bullets.push("Treat this as a hard stop unless you have explicit approval.");
      }

      if (cfg.key === "prohibited") {
        if (attrs.NAME) bullets.push("Area: " + String(attrs.NAME));
        if (attrs.REMARKS) bullets.push("Notes: " + String(attrs.REMARKS));
        bullets.push("Prohibited areas are not optional. Do not fly here.");
      }

      addCard(cfg.title, cfg.badgeHit, cfg.kind, "Match found near this point.", bullets);
    }

    setStatus("Done.", true);
  }

  // Map click
  view.on("click", async (evt) => {
    const p = evt.mapPoint;
    if (!p) return;

    const point = new Point({
      longitude: p.longitude,
      latitude: p.latitude,
      spatialReference: { wkid: 4326 }
    });

    latEl.value = point.latitude.toFixed(6);
    lngEl.value = point.longitude.toFixed(6);

    placePin(point);

    view.goTo(
      { center: [point.longitude, point.latitude], zoom: Math.max(view.zoom, 11) },
      { duration: 250 }
    ).catch(function(){});

    await runCheck(point);
  });

  // Coordinate check
  btnGo.addEventListener("click", async () => {
    const ll = parseLatLng();
    if (!ll) {
      setStatus("Invalid coordinates. Example: 30.628000 and -96.334400", false);
      return;
    }

    const point = new Point({
      longitude: ll.lng,
      latitude: ll.lat,
      spatialReference: { wkid: 4326 }
    });

    placePin(point);
    view.goTo({ center: [ll.lng, ll.lat], zoom: 11 }, { duration: 250 }).catch(function(){});
    await runCheck(point);
  });

  // Locate
  btnLocate.addEventListener("click", async () => {
    if (!navigator.geolocation) {
      setStatus("Geolocation not available in this browser.", false);
      return;
    }

    setStatus("Getting your location…", false);

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const ll = { lat: pos.coords.latitude, lng: pos.coords.longitude };

        latEl.value = ll.lat.toFixed(6);
        lngEl.value = ll.lng.toFixed(6);

        const point = new Point({
          longitude: ll.lng,
          latitude: ll.lat,
          spatialReference: { wkid: 4326 }
        });

        placePin(point);
        view.goTo({ center: [ll.lng, ll.lat], zoom: 11 }, { duration: 250 }).catch(function(){});
        await runCheck(point);
      },
      () => setStatus("Location failed. You may have blocked permissions.", false),
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 5000 }
    );
  });

  // Clear
  btnClear.addEventListener("click", () => {
    latEl.value = "";
    lngEl.value = "";
    clearResults();
    verdictWrap.classList.add("hidden");
    setStatus("Tip: click anywhere on the map to run a check.", true);

    if (pinGraphic) view.graphics.remove(pinGraphic);
    pinGraphic = null;
  });

  setStatus("Tip: click anywhere on the map to run a check.", true);
});
