/* Cambodia Hotspot Monitor — Main App */
(function () {
  "use strict";

  // --- State ---
  var map, firesLayer, coordControl;
  var allFires = [];
  var summaryData = null;
  var currentFilter = "all";
  var currentProvince = "all";

  // --- Classification ---
  function classifyHotspot(fire) {
    if (fire.classification) return fire.classification;
    var conf = (fire.confidence || "").toString().toLowerCase();
    var frp = parseFloat(fire.frp) || 0;
    var confLevel;
    if (conf === "h" || conf === "high" || parseInt(conf) >= 80) confLevel = "high";
    else if (conf === "n" || conf === "nominal" || parseInt(conf) >= 30) confLevel = "nominal";
    else confLevel = "low";
    if (confLevel === "high" && frp >= 15) return "likely_wildfire";
    if (confLevel === "high" || (confLevel === "nominal" && frp >= 10)) return "possible_wildfire";
    return "thermal_anomaly";
  }

  var CLASS_LABELS = {
    likely_wildfire: "Likely Wildfire",
    possible_wildfire: "Possible Wildfire",
    thermal_anomaly: "Thermal Anomaly",
  };
  var FILTER_LABELS = {
    all: "All Hotspots",
    likely_wildfire: "Likely Wildfires",
    possible_wildfire: "Possible + Likely Wildfires",
    thermal_anomaly: "Thermal Anomalies",
  };
  var CLASS_COLORS = {
    likely_wildfire: "#d32f2f",
    possible_wildfire: "#e65100",
    thermal_anomaly: "#5c6b7a",
  };

  // Cambodia bounding box
  var cambodiaBounds = L.latLngBounds(L.latLng(9.5, 102.0), L.latLng(14.8, 108.2));

  // --- Map Init ---
  function initMap() {
    map = L.map("map", {
      center: [12.5, 105.0],
      zoom: 7,
      zoomControl: false,
      minZoom: 7,
      maxZoom: 18,
      maxBounds: cambodiaBounds.pad(0.1),
      maxBoundsViscosity: 0.9,
      attributionControl: false,
    });

    L.tileLayer(
      "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
      { maxZoom: 18 }
    ).addTo(map);

    L.control.zoom({ position: "bottomleft" }).addTo(map);
    firesLayer = L.layerGroup().addTo(map);

    // Coordinate + temperature display
    coordControl = L.control({ position: "bottomleft" });
    coordControl.onAdd = function () {
      var div = L.DomUtil.create("div", "coord-display");
      div.innerHTML = "Lat: — &nbsp; Lon: — &nbsp; | &nbsp; Temp: —";
      return div;
    };
    coordControl.addTo(map);

    var tempCache = {};
    var tempTimeout = null;
    var lastTempText = "Temp: —";

    function getCacheKey(lat, lon) {
      return (Math.round(lat * 10) / 10) + "," + (Math.round(lon * 10) / 10);
    }

    function fetchTemp(lat, lon) {
      var key = getCacheKey(lat, lon);
      if (tempCache[key]) {
        lastTempText = tempCache[key];
        updateCoordDisplay(lat, lon);
        return;
      }
      var rLat = Math.round(lat * 100) / 100;
      var rLon = Math.round(lon * 100) / 100;
      fetch("https://api.open-meteo.com/v1/forecast?latitude=" + rLat + "&longitude=" + rLon + "&current=temperature_2m,relative_humidity_2m&timezone=Asia%2FPhnom_Penh")
        .then(function (r) { return r.json(); })
        .then(function (data) {
          if (data.current) {
            var t = data.current.temperature_2m;
            var h = data.current.relative_humidity_2m;
            lastTempText = t + "\u00B0C &nbsp; " + h + "% humidity";
            tempCache[key] = lastTempText;
            updateCoordDisplay(lat, lon);
          }
        })
        .catch(function () {});
    }

    function updateCoordDisplay(lat, lon) {
      var el = document.querySelector(".coord-display");
      if (el) {
        el.innerHTML = "Lat: " + lat.toFixed(4) + " &nbsp; Lon: " + lon.toFixed(4) + " &nbsp; | &nbsp; " + lastTempText;
      }
    }

    map.on("mousemove", function (e) {
      var lat = e.latlng.lat;
      var lon = e.latlng.lng;
      updateCoordDisplay(lat, lon);
      clearTimeout(tempTimeout);
      tempTimeout = setTimeout(function () { fetchTemp(lat, lon); }, 400);
    });

    map.on("mouseout", function () {
      clearTimeout(tempTimeout);
      lastTempText = "Temp: —";
      var el = document.querySelector(".coord-display");
      if (el) el.innerHTML = "Lat: — &nbsp; Lon: — &nbsp; | &nbsp; Temp: —";
    });
  }

  // --- Data Loading ---
  async function loadJSON(url) {
    var resp = await fetch(url + "?t=" + Date.now());
    if (!resp.ok) throw new Error("Failed to load " + url);
    return resp.json();
  }

  async function loadAllData() {
    var results = await Promise.all([
      loadJSON("data/fires_latest.json"),
      loadJSON("data/summary.json"),
    ]);
    return { fires: results[0], summary: results[1] };
  }

  // --- Render Hotspots ---
  function getHotspotColor(fire) {
    return CLASS_COLORS[classifyHotspot(fire)] || "#5c6b7a";
  }

  function getHotspotRadius(frp) {
    var f = parseFloat(frp) || 0;
    if (f < 5) return 4;
    if (f < 20) return 6;
    if (f < 50) return 8;
    if (f < 100) return 10;
    return 13;
  }

  function getConfidenceOpacity(conf) {
    if (!conf) return 0.7;
    var c = conf.toString().toLowerCase();
    if (c === "high" || c === "h" || parseInt(c) >= 80) return 1.0;
    if (c === "nominal" || c === "n" || parseInt(c) >= 50) return 0.7;
    return 0.4;
  }

  function formatTime(acqDate, acqTime) {
    if (!acqDate) return "Unknown";
    var time = acqTime || "0000";
    var h = time.substring(0, time.length - 2) || "0";
    var m = time.substring(time.length - 2);
    var ictHour = (parseInt(h) + 7) % 24;
    return acqDate + " " + String(ictHour).padStart(2, "0") + ":" + m + " ICT";
  }

  function buildPopup(fire) {
    var cls = classifyHotspot(fire);
    var clsLabel = CLASS_LABELS[cls];
    var clsColor = CLASS_COLORS[cls];

    var html = '<div class="popup-title">' + formatTime(fire.acq_date, fire.acq_time) + "</div>";
    html += '<span class="popup-cls-badge" style="background:' + clsColor + '">' + clsLabel + "</span><br><br>";
    html += "<b>Coordinates:</b> " + parseFloat(fire.latitude).toFixed(4) + ", " + parseFloat(fire.longitude).toFixed(4) + "<br>";
    html += "<b>Province:</b> " + (fire.province || "Unknown") + "<br>";
    html += "<b>Satellite:</b> " + (fire.satellite || fire.source || "N/A") + "<br>";
    html += "<b>Confidence:</b> " + (fire.confidence || "N/A") + "<br>";
    html += "<b>FRP:</b> " + (fire.frp || "N/A") + " MW<br>";
    html += "<b>Day/Night:</b> " + (fire.daynight === "D" ? "Day" : "Night") + "<br>";
    return html;
  }

  function applyFilters(fires) {
    var filtered = fires;
    if (currentProvince !== "all") {
      filtered = filtered.filter(function (f) { return f.province === currentProvince; });
    }
    if (currentFilter === "likely_wildfire") {
      filtered = filtered.filter(function (f) { return classifyHotspot(f) === "likely_wildfire"; });
    } else if (currentFilter === "possible_wildfire") {
      filtered = filtered.filter(function (f) {
        var c = classifyHotspot(f);
        return c === "likely_wildfire" || c === "possible_wildfire";
      });
    } else if (currentFilter === "thermal_anomaly") {
      filtered = filtered.filter(function (f) { return classifyHotspot(f) === "thermal_anomaly"; });
    }
    return filtered;
  }

  function renderHotspots(fires) {
    firesLayer.clearLayers();
    var filtered = applyFilters(fires);

    filtered.forEach(function (fire) {
      var color = getHotspotColor(fire);
      var marker = L.circleMarker([fire.latitude, fire.longitude], {
        radius: getHotspotRadius(fire.frp),
        fillColor: color,
        color: "#fff",
        weight: 1,
        fillOpacity: getConfidenceOpacity(fire.confidence),
        opacity: 0.8,
      });
      marker.bindPopup(buildPopup(fire));
      firesLayer.addLayer(marker);
    });

    updateFilterSummary(fires, filtered);
  }

  // --- Filter Summary Box ---
  function updateFilterSummary(allData, filtered) {
    var el = document.getElementById("filter-summary");
    if (!el) return;

    var isFiltered = currentProvince !== "all" || currentFilter !== "all";
    if (!isFiltered) {
      el.classList.remove("visible");
      return;
    }

    var counts = { likely_wildfire: 0, possible_wildfire: 0, thermal_anomaly: 0 };
    filtered.forEach(function (f) {
      var cls = classifyHotspot(f);
      counts[cls] = (counts[cls] || 0) + 1;
    });

    var provinceName = currentProvince === "all" ? "All Provinces" : currentProvince;
    var filterName = FILTER_LABELS[currentFilter] || "All Hotspots";

    var html = '<div class="fs-header">';
    html += '<span class="fs-title">' + provinceName + '</span>';
    if (currentFilter !== "all") html += '<span class="fs-filter">' + filterName + '</span>';
    html += '</div>';
    html += '<div class="fs-total">' + filtered.length + ' hotspot' + (filtered.length !== 1 ? 's' : '') + '</div>';
    html += '<div class="fs-breakdown">';
    if (counts.likely_wildfire > 0) html += '<span class="fs-tag" style="background:#d32f2f">' + counts.likely_wildfire + ' likely wildfire' + (counts.likely_wildfire !== 1 ? 's' : '') + '</span>';
    if (counts.possible_wildfire > 0) html += '<span class="fs-tag" style="background:#e65100">' + counts.possible_wildfire + ' possible</span>';
    if (counts.thermal_anomaly > 0) html += '<span class="fs-tag" style="background:#5c6b7a">' + counts.thermal_anomaly + ' thermal</span>';
    html += '</div>';

    el.innerHTML = html;
    el.classList.add("visible");
  }

  // --- Province Dropdown ---
  function buildProvinceDropdown(fires) {
    var select = document.getElementById("province-filter");
    if (!select) return;

    var counts = {};
    fires.forEach(function (f) { counts[f.province || "Unknown"] = (counts[f.province || "Unknown"] || 0) + 1; });
    var provinces = Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; });

    var html = '<option value="all">All Provinces (' + fires.length + ')</option>';
    provinces.forEach(function (p) { html += '<option value="' + p + '">' + p + ' (' + counts[p] + ')</option>'; });
    select.innerHTML = html;

    select.addEventListener("change", function () {
      currentProvince = this.value;
      renderHotspots(allFires);
    });
  }

  // --- Summary Panel ---
  function timeAgo(isoString) {
    if (!isoString) return "Never";
    var diff = Math.floor((new Date() - new Date(isoString)) / 1000);
    if (diff < 60) return "Just now";
    if (diff < 3600) return Math.floor(diff / 60) + " min ago";
    if (diff < 86400) return Math.floor(diff / 3600) + " hours ago";
    return Math.floor(diff / 86400) + " days ago";
  }

  function renderSummary(summary) {
    var el = document.getElementById("summary-content");
    if (!summary) {
      el.innerHTML = '<p style="color:var(--text-secondary)">No data yet. Run the scraper.</p>';
      return;
    }

    var wfClass = (summary.likely_wildfires || 0) > 0 ? "danger" : "";
    var html = "";

    html += '<div class="stat-row"><span class="stat-label">Total Hotspots</span><span class="stat-value">' + (summary.total_hotspots || 0) + '</span></div>';
    html += '<div class="stat-row"><span class="stat-label">Likely Wildfires</span><span class="stat-value ' + wfClass + '">' + (summary.likely_wildfires || 0) + '</span></div>';
    html += '<div class="stat-row"><span class="stat-label">Possible Wildfires</span><span class="stat-value" style="color:var(--accent-orange)">' + (summary.possible_wildfires || 0) + '</span></div>';
    html += '<div class="stat-row"><span class="stat-label">Thermal Anomalies</span><span class="stat-value" style="color:var(--text-secondary)">' + (summary.thermal_anomalies || 0) + '</span></div>';

    if (summary.top_provinces && summary.top_provinces.length) {
      html += '<div class="province-list"><div class="stat-label" style="margin-bottom:6px">Top Provinces</div>';
      summary.top_provinces.slice(0, 5).forEach(function (p) {
        html += '<div class="province-item"><span>' + p.province + '</span><span class="count">' + p.count + '</span></div>';
      });
      html += '</div>';
    }

    html += '<div class="updated">Updated: ' + timeAgo(summary.last_updated) + '</div>';
    if (summary.date_range && summary.date_range.start) {
      html += '<div class="updated">Data: ' + summary.date_range.start + ' — ' + summary.date_range.end + '</div>';
    }

    el.innerHTML = html;
  }

  // --- Controls ---
  function setupControls() {
    var filterBtns = {
      all:               document.getElementById("btn-filter-all"),
      likely_wildfire:   document.getElementById("btn-filter-wildfire"),
      possible_wildfire: document.getElementById("btn-filter-possible"),
      thermal_anomaly:   document.getElementById("btn-filter-thermal"),
    };

    filterBtns.all.classList.add("filter-active");

    function setFilter(filter) {
      currentFilter = filter;
      Object.keys(filterBtns).forEach(function (k) { filterBtns[k].classList.remove("filter-active"); });
      filterBtns[filter].classList.add("filter-active");
      renderHotspots(allFires);
    }

    Object.keys(filterBtns).forEach(function (key) {
      filterBtns[key].addEventListener("click", function () { setFilter(key); });
    });
  }

  // --- Legend ---
  function addLegend() {
    var legend = L.control({ position: "bottomright" });
    legend.onAdd = function () {
      var div = L.DomUtil.create("div", "legend");
      div.innerHTML =
        '<div class="legend-title">Hotspot Classification</div>' +
        '<div class="legend-item"><span class="legend-dot" style="background:#d32f2f"></span> Likely Wildfire</div>' +
        '<div class="legend-item"><span class="legend-dot" style="background:#e65100"></span> Possible Wildfire</div>' +
        '<div class="legend-item"><span class="legend-dot" style="background:#5c6b7a"></span> Thermal Anomaly</div>' +
        '<div class="legend-note">Dot size = FRP intensity</div>';
      return div;
    };
    legend.addTo(map);
  }

  // --- Modal ---
  function setupModal() {
    var overlay = document.getElementById("modal-overlay");
    document.getElementById("about-btn").addEventListener("click", function () { overlay.classList.add("show"); });
    document.getElementById("modal-close").addEventListener("click", function () { overlay.classList.remove("show"); });
    overlay.addEventListener("click", function (e) { if (e.target === overlay) overlay.classList.remove("show"); });
  }

  // --- Mobile Panel ---
  function setupMobilePanel() {
    var toggle = document.getElementById("panel-toggle");
    var panel = document.getElementById("panel");
    toggle.addEventListener("click", function () {
      panel.classList.toggle("open");
      toggle.textContent = panel.classList.contains("open") ? "\u2715" : "\ud83d\udcca";
    });
  }

  // --- Main ---
  async function main() {
    initMap();
    setupControls();
    setupModal();
    setupMobilePanel();
    addLegend();

    try {
      var data = await loadAllData();
      allFires = data.fires;
      summaryData = data.summary;

      allFires.forEach(function (f) {
        if (!f.classification) f.classification = classifyHotspot(f);
      });

      buildProvinceDropdown(allFires);
      renderHotspots(allFires);
      renderSummary(summaryData);
    } catch (err) {
      console.error("Failed to load data:", err);
      renderSummary(null);
    }

    document.getElementById("loading").classList.add("hidden");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", main);
  } else {
    main();
  }
})();
