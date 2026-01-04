require([
  "esri/Map", "esri/views/MapView", "esri/layers/FeatureLayer",
  "esri/Graphic", "esri/geometry/Point", "esri/geometry/geometryEngine"
], (Map, MapView, FeatureLayer, Graphic, Point, geometryEngine) => {

  const state = {
    isBusy: false,
    elements: {
      status: document.getElementById("status"),
      results: document.getElementById("results"),
      lat: document.getElementById("lat"),
      lng: document.getElementById("lng")
    }
  };

  // --- API / Data Config ---
  const LAYERS = [
    { key: "uasfm", title: "LAANC Grid", url: "https://services6.arcgis.com/ssFJjBXIUyZDrSYZ/arcgis/rest/services/FAA_UAS_FacilityMap_Data_V5/FeatureServer/0", color: "warn" },
    { key: "nsufr_full", title: "Security Restriction (Full)", url: "https://services6.arcgis.com/ssFJjBXIUyZDrSYZ/arcgis/rest/services/DoD_Mar_13/FeatureServer/0", color: "bad" },
    { key: "nsufr_part", title: "Security Restriction (Part)", url: "https://services6.arcgis.com/ssFJjBXIUyZDrSYZ/arcgis/rest/services/Part_Time_National_Security_UAS_Flight_Restrictions/FeatureServer/0", color: "bad" },
    { key: "prohibited", title: "Prohibited Airspace", url: "https://services6.arcgis.com/ssFJjBXIUyZDrSYZ/arcgis/rest/services/Prohibited_Areas/FeatureServer/0", color: "bad" }
  ];

  const esriLayers = LAYERS.map(l => new FeatureLayer({ url: l.url, visible: true, opacity: 0.4 }));
  const map = new Map({ basemap: "dark-gray-vector", layers: esriLayers });
  const view = new MapView({ container: "viewDiv", map, center: [-96.33, 30.62], zoom: 10 });

  // --- Core Functions ---
  const updateStatus = (msg) => state.elements.status.innerText = msg;

  const runCheck = async (pt) => {
    if (state.isBusy) return;
    state.isBusy = true;
    state.elements.results.innerHTML = "Checking airspace...";
    updateStatus("Analyzing FAA data layers...");

    try {
      const queries = esriLayers.map(layer => {
        const q = layer.createQuery();
        q.geometry = geometryEngine.geodesicBuffer(pt, 100, "meters");
        q.returnGeometry = false;
        q.outFields = ["*"];
        return layer.queryFeatures(q);
      });

      const responses = await Promise.all(queries);
      renderResults(responses, pt);
    } catch (err) {
      updateStatus("Error querying FAA layers.");
      console.error(err);
    } finally {
      state.isBusy = false;
      if (window.innerWidth < 768) state.elements.results.scrollIntoView({ behavior: 'smooth' });
    }
  };

  const renderResults = (responses, pt) => {
    state.elements.results.innerHTML = "";
    let hasAlert = false;

    responses.forEach((res, i) => {
      if (res.features.length > 0) {
        hasAlert = true;
        const meta = LAYERS[i];
        const attr = res.features[0].attributes;
        const card = document.createElement("div");
        card.className = "card";
        card.innerHTML = `
          <span class="badge ${meta.color}">${meta.color.toUpperCase()}</span>
          <div style="font-weight:700">${meta.title}</div>
          <div style="font-size:12px; margin-top:8px; color:var(--muted)">
            ID: ${attr.OBJECTID || 'N/A'} | Facility: ${attr.FACILITY || 'No Name'}
          </div>
        `;
        state.elements.results.appendChild(card);
      }
    });

    if (!hasAlert) {
      state.elements.results.innerHTML = `<div class="card"><span class="badge good">CLEAR</span><div>No major restrictions found.</div></div>`;
    }
    updateStatus("Analysis complete.");
  };

  // --- UI Handlers ---
  view.on("click", (e) => {
    const pt = e.mapPoint;
    state.elements.lat.value = pt.latitude.toFixed(5);
    state.elements.lng.value = pt.longitude.toFixed(5);
    runCheck(pt);
  });

  document.getElementById("btnGo").onclick = () => {
    const pt = new Point({ 
        latitude: parseFloat(state.elements.lat.value), 
        longitude: parseFloat(state.elements.lng.value) 
    });
    if (pt.latitude && pt.longitude) runCheck(pt);
  };

  document.getElementById("btnLocate").onclick = () => {
    navigator.geolocation.getCurrentPosition(pos => {
      const pt = new Point({ latitude: pos.coords.latitude, longitude: pos.coords.longitude });
      state.elements.lat.value = pt.latitude.toFixed(5);
      state.elements.lng.value = pt.longitude.toFixed(5);
      view.goTo({ center: pt, zoom: 12 });
      runCheck(pt);
    });
  };
});
