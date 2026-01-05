/* CanIFlyHere.us MVP - IMPORTANT LAYERS ONLY + Public-ready polish
   Notes:
   - OK when no major layers hit
   - CAUTION only on UAS Facility Map grid hit (LAANC)
   - NO GO on NSUFR (and optional Prohibited) hits
*/

require([
  "esri/Map",
  "esri/views/MapView",
  "esri/layers/FeatureLayer",
  "esri/Graphic",
  "esri/geometry/Point",
  "esri/geometry/geometryEngine"
], function (
  Map,
  MapView,
  FeatureLayer,
  Graphic,
  Point,
  geometryEngine
) {
  const statusEl = document.getElementById("status");
  const resultsEl = document.getElementById("results");
  const latEl = document.getElementById("lat");
  const lngEl = document.getElementById("lng");
  const btnGo = document.getElementById("btnGo");
  const btnLocate = document.getElementById("btnLocate");
  const btnClear = document.getElementById("btnClear");

  let isChecking = false;

  function setStatus(msg, muted = true) {
    if (!statusEl) return;
    statusEl.textContent = msg;
    statusEl.className = muted ? "status muted" : "status";
  }

  function clearResults() {
    if (!resultsEl) return;
    resultsEl.innerHTML = "";
  }

  function setBusy(busy) {
    isChecking = !!busy;
    if (btnGo) btnGo.disabled = busy;
    if (btnLocate) btnLocate.disabled = busy;
    if (btnClear) btnClear.disabled = busy;
    if (latEl) latEl.disabled = busy;
    if (lngEl) lngEl.disabled = busy;
  }

  function addCard(title, badgeText, badgeKind, rows, targetEl) {
    const container = targetEl || resultsEl;
    if (!container) return;

    const card = document.createElement("div");
    card.className = "card";

    const head = document.createElement("div");
    head.className = "cardTitle";

    const t = document.createElement("div");
    t.textContent = title;

    const b = document.createElement("div");
    b.className = `badge ${badgeKind}`;
    b.textContent = badgeText;

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
    container.appendChild(card);
  }

  function pickFields(attrs, hints) {
    const rows = [];
    if (!attrs) return rows;

    hints.forEach(h => {
      if (attrs[h] !== undefined && attrs[h] !== null && String(attrs[h]).trim() !== "") {
        rows.push([h, String(attrs[h])]);
      }
    });

    if (attrs.OBJECTID !== undefined) rows.push(["OBJECTID", String(attrs.OBJECTID)]);

    if (rows.length === 0) {
      const keys = Object.keys(attrs).slice(0, 6);
      keys.forEach(k => rows.push([k, String(attrs[k])]));
    }
    return rows;
  }

  function hasAny(arr) {
    return Array.isArray(arr) && arr.length > 0;
  }

  function pickFirst(attrs, keys) {
    for (const k of keys) {
      if (attrs && attrs[k] !== undefined && attrs[k] !== null && String(attrs[k]).trim() !== "") {
        return String(attrs[k]);
      }
    }
    return "";
  }

  function renderVerdict(kind, headline, bullets) {
    clearResults();

    const card = document.createElement("div");
    card.className = "card";

    const head = document.createElement("div");
    head.className = "cardTitle";

    const t = document.createElement("div");
    t.textContent = headline;

    const b = document.createElement("div");
    b.className = `badge ${kind}`;
    b.textContent = kind === "good" ? "OK" : (kind === "warn" ? "CAUTION" : "NO GO");

    head.appendChild(t);
    head.appendChild(b);

    const list = document.createElement("ul");
    list.style.margin = "8px 0 0 18px";
    list.style.color = "var(--muted)";
    list.style.fontSize = "13px";
    list.style.lineHeight = "1.35";

    bullets.slice(0, 3).forEach(txt => {
      const li = document.createElement("li");
      li.textContent = txt;
      list.appendChild(li);
    });

    const links = document.createElement("div");
    links.style.marginTop = "10px";
    links.style.display = "flex";
    links.style.flexWrap = "wrap";
    links.style.gap = "10px";
    links.style.fontSize = "13px";

    function mkLink(text, href) {
      const a = document.createElement("a");
      a.textContent = text;
      a.href = href;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.style.color = "var(--accent)";
      a.style.textDecoration = "none";
      return a;
    }

    links.appendChild(mkLink("FAA UAS", "https://www.faa.gov/uas"));
    links.appendChild(mkLink("Check TFRs", "https://tfr.faa.gov"));
    links.appendChild(mkLink("B4UFLY", "https://www.faa.gov/uas/getting_started/b4ufly"));

    card.appendChild(head);
    card.appendChild(list);
    card.appendChild(links);

    const toggleWrap = document.createElement("div");
    toggleWrap.style.marginTop = "10px";

    const btn = document.createElement("button");
    btn.className = "btn";
    btn.type = "button";
    btn.textContent = "Show details";

    const detailsDiv = document.createElement("div");
    detailsDiv.style.display = "none";
    detailsDiv.style.marginTop = "10px";

    btn.addEventListener("click", () => {
      const open = detailsDiv.style.display !== "none";
      detailsDiv.style.display = open ? "none" : "block";
      btn.textContent = open ? "Show details" : "Hide details";
    });

    toggleWrap.appendChild(btn);
    toggleWrap.appendChild(detailsDiv);

    card.appendChild(toggleWrap);
    resultsEl.appendChild(card);

    return detailsDiv;
  }

  function parseLatLng() {
    const lat = Number(String(latEl.value || "").trim());
    const lng = Number(String(lngEl.value || "").trim());
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
    return { lat, lng };
  }

  function safeBuffer(point, meters) {
    try {
      const gb = geometryEngine.geodesicBuffer(point, meters, "meters");
      return gb || point;
    } catch (e) {
      return point;
    }
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

  const LAYERS = [
    {
      key: "uasfm",
      title: "UAS Facility Map (LAANC grid)",
      url: "https://services6.arcgis.com/ssFJjBXIUyZDrSYZ/arcgis/rest/services/FAA_UAS_FacilityMap_Data_V5/FeatureServer/0",
      kind: "warn",
      visible: true,
      opacity: 0.55,
      badgeWhenHit: "LAANC grid present",
      fieldsHint: ["MAX_ALT", "MAX_ALTITUDE", "ALTITUDE", "GRID_MAX_ALT", "FACILITY", "AIRSPACE"]
    },
    {
      key: "nsufr_full",
      title: "National Security UAS Flight Restrictions (Full-Time)",
      url: "https://services6.arcgis.com/ssFJjBXIUyZDrSYZ/arcgis/rest/services/DoD_Mar_13/FeatureServer/0",
      kind: "bad",
      visible: true,
      opacity: 0.50,
      badgeWhenHit: "Restriction",
      fieldsHint: ["NAME", "AGENCY", "NOTAM", "LOWER_VAL", "UPPER_VAL", "REMARKS"]
    },
    {
      key: "nsufr_part",
      title: "National Security UAS Flight Restrictions (Part-Time)",
      url: "https://services6.arcgis.com/ssFJjBXIUyZDrSYZ/arcgis/rest/services/Part_Time_National_Security_UAS_Flight_Restrictions/FeatureServer/0",
      kind: "bad",
      visible: true,
      opacity: 0.50,
      badgeWhenHit: "Restriction",
      fieldsHint: ["NAME", "AGENCY", "NOTAM", "START_TIME", "END_TIME", "REMARKS"]
    },
    {
      key: "prohibited",
      title: "Prohibited Areas",
      url: "https://services6.arcgis.com/ssFJjBXIUyZDrSYZ/arcgis/rest/services/Prohibited_Areas/FeatureServer/0",
      kind: "bad",
      visible: false,
      opacity: 0.60,
      badgeWhenHit: "Prohibited area",
      fieldsHint: ["NAME", "TYPE_CODE", "IDENT", "LOWER_VAL", "UPPER_VAL", "REMARKS"]
    }
  ];

  const featureLayers = {};
  const esriLayers = [];

  LAYERS.forEach(cfg => {
    const layer = new FeatureLayer({
      url: cfg.url,
      title: cfg.title,
      opacity: typeof cfg.opacity === "number" ? cfg.opacity : 0.6,
      visible: !!cfg.visible,
      outFields: ["*"]
    });

    featureLayers[cfg.key] = layer;
    esriLayers.push(layer);
  });

  const map = new Map({
    basemap: "streets-navigation-vector",
    layers: esriLayers
  });

  const view = new MapView({
    container: "viewDiv",
    map,
    center: [-96.3344, 30.6280],
    zoom: 10
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
        color: "#2563eb",
        outline: { color: "#ffffff", width: 1.5 }
      }
    });

    view.graphics.add(pinGraphic);
  }

  async function runCheck(point) {
    if (isChecking) return;
    setBusy(true);

    clearResults();
    setStatus("Checking FAA layers at this point…", false);

    try {
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

      const byKey = {};
      results.forEach(r => { byKey[r.cfg.key] = r; });

      const nsufrHit = hasAny(byKey.nsufr_part?.feats) || hasAny(byKey.nsufr_full?.feats);
      const prohibitedHit = hasAny(byKey.prohibited?.feats);
      const uasfmHit = hasAny(byKey.uasfm?.feats);

      let verdictKind = "good";
      let headline = "OK to fly here (no major FAA restrictions found)";
      const bullets = [];

      if (nsufrHit || prohibitedHit) {
        verdictKind = "bad";
        headline = "Do not fly here (restriction present)";
        if (nsufrHit) bullets.push("National Security UAS Flight Restriction detected.");
        if (prohibitedHit) bullets.push("Prohibited area detected.");
        bullets.push("Verify official FAA restrictions and do not fly without proper authorization.");
      } else if (uasfmHit) {
        verdictKind = "warn";
        headline = "Caution: LAANC likely required (controlled grid area)";
        const attrs = byKey.uasfm.feats[0]?.attributes;
        const maxAlt = pickFirst(attrs, ["CEILING", "MaxAlt", "MAX_ALT", "MAX_ALTITUDE", "ALTITUDE", "GRID_MAX_ALT"]);
        bullets.push("This point falls inside a UAS Facility Map (LAANC) grid.");
        bullets.push(maxAlt ? `Max altitude shown for this grid: ${maxAlt} ft.` : "Check the grid altitude ceiling before flight.");
        bullets.push("Request LAANC authorization if required for your operation.");
      } else {
        bullets.push("No intersecting NSUFR or LAANC grid was detected here.");
        bullets.push("Still check for active TFRs, NOTAMs, local rules, and safe operations.");
      }

      const detailsDiv = renderVerdict(verdictKind, headline, bullets);
      setStatus("Done.", false);

      const showDetails = results.some(r => (r.error || (r.feats && r.feats.length > 0)));
      const toggleBtn = resultsEl.querySelector(".btn");
      if (toggleBtn && !showDetails) {
        toggleBtn.style.display = "none";
      }

      results.forEach(r => {
        const cfg = r.cfg;

        if (r.error) {
          addCard(cfg.title, "Query failed", "warn", [
            ["Note", "This layer could not be queried right now."],
            ["Details", r.error?.message ? String(r.error.message) : String(r.error)]
          ], detailsDiv);
          return;
        }

        if (!r.feats || r.feats.length === 0) return;

        const attrs = r.feats[0].attributes;
        const rows = pickFields(attrs, cfg.fieldsHint || []);
        addCard(cfg.title, cfg.badgeWhenHit || "Hit", cfg.kind || "warn", rows, detailsDiv);
      });

    } catch (e) {
      setStatus("Something went wrong running the check.", false);
      addCard("System", "Error", "bad", [
        ["Details", e?.message ? String(e.message) : String(e)]
      ]);
    } finally {
      setBusy(false);
    }
  }

  view.on("click", async (evt) => {
    const p = evt.mapPoint;
    if (!p) return;

    const point = new Point({
      longitude: p.longitude,
      latitude: p.latitude,
      spatialReference: { wkid: 4326 }
    });

    if (latEl) latEl.value = point.latitude.toFixed(6);
    if (lngEl) lngEl.value = point.longitude.toFixed(6);

    placePin(point);

    view.goTo(
      { center: [point.longitude, point.latitude], zoom: Math.max(view.zoom, 11) },
      { duration: 300 }
    ).catch(() => {});

    await runCheck(point);
  });

  if (btnGo) {
    btnGo.addEventListener("click", async () => {
      const ll = parseLatLng();
      if (!ll) {
        setStatus("Invalid coordinates. Example: 30.6280 and -96.3344", false);
        return;
      }

      const point = new Point({
        longitude: ll.lng,
        latitude: ll.lat,
        spatialReference: { wkid: 4326 }
      });

      placePin(point);
      view.goTo({ center: [ll.lng, ll.lat], zoom: 11 }, { duration: 300 }).catch(() => {});
      await runCheck(point);
    });
  }

  if (btnLocate) {
    btnLocate.addEventListener("click", async () => {
      if (!navigator.geolocation) {
        setStatus("Geolocation not available in this browser.", false);
        return;
      }

      setStatus("Getting your location…", false);

      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          const ll = { lat: pos.coords.latitude, lng: pos.coords.longitude };

          if (latEl) latEl.value = ll.lat.toFixed(6);
          if (lngEl) lngEl.value = ll.lng.toFixed(6);

          const point = new Point({
            longitude: ll.lng,
            latitude: ll.lat,
            spatialReference: { wkid: 4326 }
          });

          placePin(point);
          view.goTo({ center: [ll.lng, ll.lat], zoom: 11 }, { duration: 300 }).catch(() => {});
          await runCheck(point);
        },
        () => setStatus("Location failed. You may have blocked permissions.", false),
        { enableHighAccuracy: true, timeout: 12000, maximumAge: 5000 }
      );
    });
  }

  if (btnClear) {
    btnClear.addEventListener("click", () => {
      if (isChecking) return;

      if (latEl) latEl.value = "";
      if (lngEl) lngEl.value = "";
      clearResults();
      setStatus("Pick a point (click map) or enter coordinates.", true);

      if (pinGraphic) view.graphics.remove(pinGraphic);
      pinGraphic = null;
    });
  }

  setStatus("Ready. Click the map or enter coordinates to check.", true);
});
