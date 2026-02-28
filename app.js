/* ==========================================
   AIRA AQI DASHBOARD — VANILLA JS
   ========================================== */

(function () {
  'use strict';

  /* ==========================================
     CONSTANTS & STATE
     ========================================== */
  const AQI_LEVELS = {
    good: { max: 50, label: 'Good', color: '#00e676' },
    moderate: { max: 100, label: 'Moderate', color: '#fbbf24' },
    unhealthy_s: { max: 150, label: 'Unhealthy (Sens.)', color: '#ff9800' },
    unhealthy: { max: 200, label: 'Unhealthy', color: '#ff9800' },
    very_unhealthy: { max: 300, label: 'Very Unhealthy', color: '#f44336' },
    hazardous: { max: 999, label: 'Hazardous', color: '#9c27b0' },
  };

  function getAQIInfo(aqi) {
    if (aqi <= 50) return AQI_LEVELS.good;
    if (aqi <= 100) return AQI_LEVELS.moderate;
    if (aqi <= 150) return AQI_LEVELS.unhealthy_s;
    if (aqi <= 200) return AQI_LEVELS.unhealthy;
    if (aqi <= 300) return AQI_LEVELS.very_unhealthy;
    return AQI_LEVELS.hazardous;
  }

  const API_BASE = window.location.origin + '/api';

  let state = {
    map: null,
    heatmapLayer: null,
    wardLayers: [],
    heatmapVisible: true,
    chart: null,
    detailChart: null,
    isExpanded: false,
    wardAlertData: [],
    geojson: null,
    geoJsonLayer: null,
    wardDataMap: {},     // { wardName: { aqi, pm25, pm10, no2, ... } }
    sseConnected: false,
    cityData: null,      // { aqi, pm25, pm10, ... }
    selectedWard: 'NDMC CHARGE 3'
  };

  /* ==========================================
     EXPAND / COLLAPSE DETAIL PANEL
     ========================================== */
  function toggleExpanded() {
    state.isExpanded = !state.isExpanded;
    const main = document.querySelector('.main-content');
    const btn = document.getElementById('expand-btn');
    const mapCol = document.querySelector('.map-col');

    if (state.isExpanded) {
      main.classList.add('expanded');
      btn.classList.add('active');
      // Lazy-init detail chart on first open
      if (!state.detailChart) {
        initDetailChart();
      }
      updateDetailTimeLabel();
      fetchWardForecast7Day(state.selectedWard);
    } else {
      main.classList.remove('expanded');
      btn.classList.remove('active');
    }

    // Trigger Leaflet map resize after CSS transition ends
    mapCol.addEventListener('transitionend', function handler() {
      if (state.map) state.map.invalidateSize();
      mapCol.removeEventListener('transitionend', handler);
    });
  }

  /* ==========================================
     DETAIL PANEL — TIME LABEL
     ========================================== */
  function updateDetailTimeLabel() {
    const el = document.getElementById('dp-time-label');
    if (!el) return;
    const now = new Date();
    const opts = { hour: '2-digit', minute: '2-digit', weekday: 'short', month: 'short', day: 'numeric' };
    const parts = now.toLocaleString('en-US', opts).toUpperCase();
    el.textContent = '7-DAY FORECAST \u2014 ' + state.selectedWard + ' \u2014 ' + parts;
  }

  /* ==========================================
     DETAIL CHART (7-Day Ward Forecast)
     ========================================== */
  function initDetailChart() {
    const ctx = document.getElementById('detailChart');
    if (!ctx) return;

    state.detailChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: [],
        datasets: [{
          data: [],
          backgroundColor: [],
          borderRadius: 3,
          barPercentage: 0.7
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 800, easing: 'easeOutQuart' },
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            enabled: true,
            backgroundColor: 'rgba(15, 23, 42, 0.92)',
            titleColor: '#94a3b8',
            bodyColor: '#f1f5f9',
            titleFont: { size: 11, family: 'Inter' },
            bodyFont: { size: 13, weight: 'bold', family: 'Inter' },
            padding: 10,
            cornerRadius: 8,
            displayColors: false,
            callbacks: {
              title: function (items) { return items[0] ? items[0].label : ''; },
              label: function (item) { return 'AQI: ' + item.raw; }
            }
          }
        },
        scales: {
          x: {
            display: true,
            ticks: {
              color: '#94a3b8',
              font: { size: 9, family: 'Inter' },
              maxRotation: 0,
              autoSkip: true,
              maxTicksLimit: 7
            },
            grid: { display: false }
          },
          y: { display: false, min: 0, max: 350 }
        }
      }
    });
  }

  /* ==========================================
     CHART.JS FORECAST INIT (1-Day Ward Forecast)
     ========================================== */
  function initChart() {
    const ctx = document.getElementById('forecastChart');
    if (!ctx) return;

    state.chart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: [],
        datasets: [{
          data: [],
          backgroundColor: [],
          borderRadius: 4,
          barPercentage: 0.6
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            enabled: true,
            backgroundColor: 'rgba(15, 23, 42, 0.92)',
            titleColor: '#94a3b8',
            bodyColor: '#f1f5f9',
            titleFont: { size: 11, family: 'Inter' },
            bodyFont: { size: 13, weight: 'bold', family: 'Inter' },
            padding: 10,
            cornerRadius: 8,
            displayColors: false,
            callbacks: {
              title: function (items) { return items[0] ? items[0].label : ''; },
              label: function (item) { return 'AQI: ' + item.raw; }
            }
          }
        },
        scales: {
          x: {
            display: true,
            ticks: {
              color: '#64748b',
              font: { size: 9, family: 'Inter' },
              maxRotation: 0,
              autoSkip: true,
              maxTicksLimit: 6
            },
            grid: { display: false }
          },
          y: { display: false, min: 0, max: 350 }
        }
      }
    });
  }

  /* ==========================================
     DOM UPDATES (Left Column Cards)
     ========================================== */
  function updateSidebarCards(data) {
    const info = getAQIInfo(data.aqi);

    // Update Forecast Card
    document.getElementById('fc-location-name').innerHTML = `${data.name} <svg viewBox="0 0 24 24" class="icon-sm" fill="none"><path d="M12 2L2 22l10-4 10 4L12 2z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>`;
    document.getElementById('fc-status').textContent = info.label;
    document.getElementById('fc-aqi-val').textContent = data.aqi;

    // Animate Top Circular Progress
    const pct = Math.min(data.aqi / 300, 1);
    const offset = 175.9 * (1 - pct);
    const ring = document.getElementById('fc-ring-progress');
    const dot = document.getElementById('fc-ring-dot');
    if (ring && dot) {
      ring.style.strokeDashoffset = offset;
      ring.setAttribute('stroke', info.color);
      dot.style.transform = `rotate(${pct * 360}deg)`;
      dot.setAttribute('fill', info.color);
    }

    // AQI Action Plan card is locked to NDMC CHARGE 3 — do not overwrite here

    // Pollutant values for detail panel
    const pm25 = data.pm25 != null ? Math.round(data.pm25) : Math.round(data.aqi * 0.75);
    const pm10 = data.pm10 != null ? Math.round(data.pm10) : Math.round(data.aqi * 0.98);
    const no2  = data.no2  != null ? Math.round(data.no2)  : Math.round(data.aqi * 0.32);
    const o3   = data.o3   != null ? Math.round(data.o3)   : Math.round(data.aqi * 0.08);
    const so2  = data.so2  != null ? Math.round(data.so2)  : 0;
    const co   = data.co   != null ? Math.round(data.co)   : 0;

    // ------ Sync Detail Panel ------
    const cityName = data.name.replace('WARD: ', '').split('\u2014')[0].trim();

    const setEl = (id, val) => { const e = document.getElementById(id); if (e) e.textContent = val; };
    const locEl = document.getElementById('dp-location');
    if (locEl) locEl.innerHTML = `${cityName} <svg class="icon-sm" viewBox="0 0 24 24" fill="none"><path d="M12 2L2 22l10-4 10 4L12 2z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>`;
    setEl('dp-condition', info.label);
    setEl('dp-aqi-num',   data.aqi);
    setEl('dp-p-aqi',     data.aqi);
    setEl('dp-p-no2',     no2);
    setEl('dp-p-pm25',    pm25);
    setEl('dp-p-pm10',    pm10);
    setEl('dp-p-o3',      o3);

    const badge = document.querySelector('.dp-aqi-badge');
    if (badge) {
      badge.style.borderColor = info.color + '80';
      badge.style.boxShadow   = `0 0 24px ${info.color}40, inset 0 0 16px ${info.color}15`;
      badge.style.background  = info.color + '18';
    }
    const numEl = document.getElementById('dp-aqi-num');
    if (numEl) numEl.style.color = info.color;

    // Update forecast card time
    const timeEl = document.getElementById('fc-time');
    if (timeEl) {
      const now = new Date();
      timeEl.textContent = now.toLocaleString('en-IN', {
        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
      }) + ', local time';
    }
  }

  /* ==========================================
     MAP — LEAFLET + HEATMAP
     ========================================== */
  function getPolygonCentroid(coords) {
    let ring = coords;
    while (Array.isArray(ring[0]) && Array.isArray(ring[0][0])) { ring = ring[0]; }
    let sumLat = 0, sumLng = 0, count = 0;
    for (const point of ring) { sumLng += point[0]; sumLat += point[1]; count++; }
    return [sumLat / count, sumLng / count];
  }

  async function initMap() {
    state.map = L.map('map', { center: [28.6139, 77.2090], zoom: 10, zoomControl: false, attributionControl: false, zoomSnap: 0.5 });
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { subdomains: 'abcd', maxZoom: 19 }).addTo(state.map);

    try {
      const response = await fetch('Delhi_Boundary.geojson');
      state.geojson = await response.json();

      // Create GeoJSON layer (initially neutral gray)
      state.geoJsonLayer = L.geoJSON(state.geojson, {
        style: function (feature) {
          const aqi = feature.properties.liveAqi || 0;
          const info = aqi > 0 ? getAQIInfo(aqi) : { color: '#475569' };
          return { color: info.color, weight: 1, opacity: 0.8, fillColor: info.color, fillOpacity: 0.15 };
        },
        onEachFeature: function (feature, layer) {
          const wardName = feature.properties.Ward_Name || 'Unknown Ward';

          layer.on({
            click: function (e) {
              L.DomEvent.stopPropagation(e);
              state.selectedWard = wardName;
              const wd = state.wardDataMap[wardName];
              if (wd) {
                updateSidebarCards({
                  name: "WARD: " + wardName,
                  aqi: wd.aqi, pm25: wd.pm25, pm10: wd.pm10,
                  no2: wd.no2, o3: wd.o3, so2: wd.so2, co: wd.co,
                  dominant: wd.dominant || 'PM2.5'
                });
              }
              // Reset all ward styles, then highlight selected
              if (state.geoJsonLayer) state.geoJsonLayer.resetStyle();
              e.target.setStyle({ fillOpacity: 0.45, weight: 2.5 });
              // Update charts for selected ward
              fetchWardForecast(wardName);
              if (state.isExpanded) updateDetailTimeLabel();
            },
            mouseover: function (e) {
              const rect = e.target;
              rect.setStyle({ fillOpacity: 0.4, weight: 2 });
              rect.bringToFront();

              const wd = state.wardDataMap[wardName];
              if (wd) {
                updateSidebarCards({
                  name: "WARD: " + wardName,
                  aqi: wd.aqi, pm25: wd.pm25, pm10: wd.pm10,
                  no2: wd.no2, o3: wd.o3, so2: wd.so2, co: wd.co,
                  dominant: wd.dominant || 'PM2.5'
                });
              } else {
                updateSidebarCards({
                  name: "WARD: " + wardName,
                  aqi: feature.properties.liveAqi || 0,
                  dominant: feature.properties.dominant || 'PM2.5'
                });
              }
            },
            mouseout: function (e) {
              state.geoJsonLayer.resetStyle(e.target);
              // Re-highlight if this is the selected ward
              if (wardName === state.selectedWard) {
                e.target.setStyle({ fillOpacity: 0.45, weight: 2.5 });
              }
              // Revert sidebar to selected ward
              const selWd = state.wardDataMap[state.selectedWard];
              if (selWd) {
                updateSidebarCards({
                  name: "WARD: " + state.selectedWard,
                  aqi: selWd.aqi, pm25: selWd.pm25, pm10: selWd.pm10,
                  no2: selWd.no2, o3: selWd.o3, so2: selWd.so2, co: selWd.co,
                  dominant: selWd.dominant || 'PM2.5'
                });
              }
            }
          });
          state.wardLayers.push(layer);
        }
      }).addTo(state.map);

      // Compute centroids for heatmap use
      state.geojson.features.forEach(feature => {
        if (feature.geometry && feature.geometry.coordinates) {
          feature.properties.center = getPolygonCentroid(feature.geometry.coordinates);
        }
      });

      // Try to fetch live data from backend
      await fetchLiveData();

      // Connect SSE for real-time updates
      connectSSE();

    } catch (error) {
      console.error("GeoJSON/API load error:", error);
    }
  }

  /* ==========================================
     LIVE DATA FETCH FROM BACKEND
     ========================================== */
  async function fetchLiveData() {
    try {
      const resp = await fetch(API_BASE + '/wards');
      const json = await resp.json();
      if (json.status === 'ok' && json.wards && json.wards.length > 0) {
        applyWardData(json.wards, json.city);
        console.log('[AIRA] Live data loaded:', json.wards.length, 'wards');
        updateLiveIndicator(true);
      } else {
        console.warn('[AIRA] No live data yet — backend may be fetching');
        updateLiveIndicator(false);
      }
    } catch (err) {
      console.warn('[AIRA] Backend not available:', err.message);
      updateLiveIndicator(false);
    }
  }

  /* ==========================================
     APPLY WARD DATA TO MAP + CARDS
     ========================================== */
  function applyWardData(wards, cityAvg) {
    state.wardAlertData = [];
    state.wardDataMap = {};

    let totalAqi = 0, validCount = 0;
    const heatPoints = [];

    // Build ward lookup
    wards.forEach(w => {
      state.wardDataMap[w.ward_name] = w;
      state.wardAlertData.push({
        name:     w.ward_name,
        aqi:      w.aqi || 0,
        pm25:     w.pm25 || 0,
        no2:      w.no2  || 0,
        dominant: w.dominant || 'PM2.5'
      });
    });

    // Update GeoJSON features  with live data
    if (state.geojson) {
      state.geojson.features.forEach(feature => {
        const wName = feature.properties.Ward_Name || '';
        const wd = state.wardDataMap[wName];
        if (wd) {
          feature.properties.liveAqi = wd.aqi;
          feature.properties.dominant = wd.dominant || 'PM2.5';
          totalAqi += wd.aqi;
          validCount++;
        }

        if (feature.properties.center) {
          const center = feature.properties.center;
          const aqi = wd ? wd.aqi : 0;
          const intensity = Math.min(aqi / 350, 1.0);
          if (intensity > 0) {
            heatPoints.push([center[0], center[1], intensity]);
            for (let i = 0; i < 5; i++) {
              heatPoints.push([
                center[0] + (Math.random() - 0.5) * 0.03,
                center[1] + (Math.random() - 0.5) * 0.03,
                intensity * (0.4 + Math.random() * 0.5)
              ]);
            }
          }
        }
      });
    }

    // Restyle GeoJSON layer
    if (state.geoJsonLayer) {
      state.geoJsonLayer.setStyle(function (feature) {
        const aqi = feature.properties.liveAqi || 0;
        const info = aqi > 0 ? getAQIInfo(aqi) : { color: '#475569' };
        return { color: info.color, weight: 1, opacity: 0.8, fillColor: info.color, fillOpacity: 0.15 };
      });
      // Re-highlight selected ward
      state.geoJsonLayer.eachLayer(function (lyr) {
        if (lyr.feature && lyr.feature.properties.Ward_Name === state.selectedWard) {
          lyr.setStyle({ fillOpacity: 0.45, weight: 2.5 });
        }
      });
    }

    // Update heatmap
    if (state.heatmapLayer) {
      state.heatmapLayer.remove();
    }
    if (L.heatLayer && heatPoints.length > 0) {
      state.heatmapLayer = L.heatLayer(heatPoints, {
        radius: 35, blur: 25, maxZoom: 13, minOpacity: 0.3,
        gradient: { 0: '#00e676', 0.3: '#fbbf24', 0.5: '#ff9800', 0.75: '#f44336', 1: '#9c27b0' }
      });
      if (state.heatmapVisible) state.heatmapLayer.addTo(state.map);
    }

    // Store city average
    const avg = cityAvg || {
      aqi: validCount > 0 ? Math.round(totalAqi / validCount) : 0,
      dominant: 'PM2.5'
    };
    state.cityData = avg;

    // Show selected ward data (default: NDMC CHARGE 3)
    const selWd = state.wardDataMap[state.selectedWard];
    if (selWd) {
      updateSidebarCards({
        name: "WARD: " + state.selectedWard,
        aqi: selWd.aqi, pm25: selWd.pm25, pm10: selWd.pm10,
        no2: selWd.no2, o3: selWd.o3, so2: selWd.so2, co: selWd.co,
        dominant: selWd.dominant || 'PM2.5'
      });
    } else {
      updateSidebarCards({
        name: "DELHI NCR — ALL WARDS",
        aqi: avg.aqi || 0, pm25: avg.pm25, pm10: avg.pm10,
        no2: avg.no2, o3: avg.o3, so2: avg.so2, co: avg.co,
        dominant: avg.dominant || 'PM2.5'
      });
    }

    // Fetch ward forecast chart data
    fetchWardForecast(state.selectedWard);
  }

  /* ==========================================
     WARD FORECAST — 1-DAY & 7-DAY
     ========================================== */
  async function fetchWardForecast(wardName) {
    fetchWardForecast1Day(wardName);
    if (state.detailChart) {
      fetchWardForecast7Day(wardName);
    }
  }

  async function fetchWardForecast1Day(wardName) {
    try {
      const resp = await fetch(API_BASE + '/ward-history?ward=' + encodeURIComponent(wardName) + '&days=1');
      const json = await resp.json();
      if (json.status === 'ok' && json.data && json.data.length > 0) {
        update1DayChart(json.data);
      }
    } catch (_) { /* keep existing chart */ }
  }

  async function fetchWardForecast7Day(wardName) {
    try {
      const resp = await fetch(API_BASE + '/ward-history?ward=' + encodeURIComponent(wardName) + '&days=7');
      const json = await resp.json();
      if (json.status === 'ok' && json.data && json.data.length > 0) {
        update7DayChart(json.data);
      }
    } catch (_) { /* keep existing chart */ }
  }

  function update1DayChart(data) {
    if (!state.chart) return;
    const labels = data.map(function (d) {
      var dt = new Date((d.computed_at || '').replace(' ', 'T') + 'Z');
      return dt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
    });
    var vals = data.map(function (d) { return d.aqi || 0; });
    var colors = vals.map(function (v) {
      return v > 300 ? '#9c27b0' : v > 200 ? '#f44336' : v > 150 ? '#ff9800' :
             v > 100 ? '#ff6b35' : v > 50  ? '#fbbf24' : '#4ade80';
    });
    state.chart.data.labels = labels;
    state.chart.data.datasets[0].data = vals;
    state.chart.data.datasets[0].backgroundColor = colors;
    state.chart.options.scales.y.max = Math.max(200, Math.max.apply(null, vals)) + 50;
    state.chart.update('none');
  }

  function update7DayChart(data) {
    if (!state.detailChart) return;
    // Aggregate by day for clean weekly view
    var dayMap = new Map();
    data.forEach(function (d) {
      var dt = new Date((d.computed_at || '').replace(' ', 'T') + 'Z');
      var dayKey = dt.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
      if (!dayMap.has(dayKey)) dayMap.set(dayKey, []);
      dayMap.get(dayKey).push(d.aqi || 0);
    });
    var labels = [];
    var vals = [];
    dayMap.forEach(function (arr, key) {
      labels.push(key);
      vals.push(Math.round(arr.reduce(function (a, b) { return a + b; }, 0) / arr.length));
    });
    var colors = vals.map(function (v) {
      return v > 300 ? 'rgba(156, 39, 176, 0.8)' :
             v > 200 ? 'rgba(244, 67, 54, 0.8)' :
             v > 150 ? 'rgba(255, 152, 0, 0.8)' :
             v > 100 ? 'rgba(139, 92, 246, 0.85)' :
                       'rgba(139, 92, 246, 0.5)';
    });
    state.detailChart.data.labels = labels;
    state.detailChart.data.datasets[0].data = vals;
    state.detailChart.data.datasets[0].backgroundColor = colors;
    state.detailChart.options.scales.y.max = Math.max(300, Math.max.apply(null, vals)) + 50;
    state.detailChart.update('none');
  }

  /* ==========================================
     SSE (Server-Sent Events) — REAL-TIME
     ========================================== */
  function connectSSE() {
    try {
      const es = new EventSource(API_BASE + '/events');

      es.addEventListener('connected', () => {
        state.sseConnected = true;
        console.log('[AIRA] SSE connected');
        updateLiveIndicator(true);
      });

      es.addEventListener('ward-update', (e) => {
        try {
          const payload = JSON.parse(e.data);
          if (payload.wards) {
            applyWardData(payload.wards, payload.city || null);
            console.log('[AIRA] Real-time update:', payload.wards.length, 'wards');
            // Re-render alerts if on that page
            if (window.renderAlerts) window.renderAlerts();
          }
        } catch (err) {
          console.error('[AIRA] SSE parse error:', err);
        }
      });

      es.addEventListener('ping', () => { /* heartbeat */ });

      es.onerror = () => {
        state.sseConnected = false;
        updateLiveIndicator(false);
        // EventSource auto-reconnects
      };
    } catch (_) {
      console.warn('[AIRA] SSE not available');
    }
  }

  function updateLiveIndicator(live) {
    const dot = document.querySelector('.sidebar-status .status-dot');
    const label = document.querySelector('.sidebar-status span');
    if (dot) {
      dot.classList.toggle('online', live);
      dot.classList.toggle('offline', !live);
    }
    if (label) label.textContent = live ? 'Live' : 'Offline';
  }

  window.mapZoomIn = () => state.map?.zoomIn();
  window.mapZoomOut = () => state.map?.zoomOut();
  window.toggleExpanded = toggleExpanded;
  window.getWardAlertData = () => state.wardAlertData;
  window.toggleHeatmap = () => {
    if (!state.heatmapLayer) return;
    state.heatmapVisible = !state.heatmapVisible;
    const lbl = document.getElementById('heatmap-toggle-lbl');

    if (state.heatmapVisible) {
      state.heatmapLayer.addTo(state.map);
      if (lbl) lbl.textContent = '🗺️ Ward View';
    } else {
      state.heatmapLayer.remove();
      if (lbl) lbl.textContent = '🌡️ Heatmap';
    }
  };

  /* ==========================================
     GEMINI RECOMMENDATIONS
     ========================================== */
  const DEFAULT_WARD = 'NDMC CHARGE 3';

  async function fetchRecommendations() {
    const wardName = DEFAULT_WARD;

    const card = document.getElementById('reco-card');
    if (!card) return;

    try {
      const resp = await fetch(API_BASE + '/recommendations?ward=' + encodeURIComponent(wardName));
      const json = await resp.json();
      if (json.status !== 'ok') throw new Error(json.message);
      renderRecommendations(json);
    } catch (err) {
      console.error('[AIRA] Recommendations error:', err);
      // Show fallback content
      const headline = document.getElementById('reco-headline');
      if (headline) headline.textContent = 'Unable to load — retrying soon';
    }
  }

  function renderRecommendations(data) {
    const info = getAQIInfo(data.aqi || 0);
    function clean(s) { return (s || '').replace(/\*+/g, ''); }

    // Headline + summary
    const hl = document.getElementById('reco-headline');
    if (hl) hl.textContent = clean(data.headline) || `AQI ${data.aqi} ${info.label}`;

    const summary = document.getElementById('reco-summary');
    if (summary) summary.textContent = clean(data.summary) || '';

    // Confidence
    const confBadge = document.getElementById('reco-conf-badge');
    const confVal = document.getElementById('reco-conf-val');
    if (confVal) confVal.textContent = data.confidence || '—';

    // AQI pill
    const pill = document.getElementById('reco-aqi-pill');
    if (pill) pill.style.borderColor = info.color + '60';
    const aqiVal = document.getElementById('aqi-card-val');
    if (aqiVal) { aqiVal.textContent = data.aqi || '—'; aqiVal.style.color = info.color; }

    // Location
    const loc = document.getElementById('aqi-card-location');
    if (loc) loc.textContent = '📍 WARD: ' + DEFAULT_WARD;

    // Alerts (time-sensitive, from reports)
    const alertsEl = document.getElementById('reco-alerts');
    if (alertsEl) {
      if (data.alerts && data.alerts.length > 0) {
        alertsEl.innerHTML = data.alerts.map(a =>
          `<div class="reco-alert-item">
            <span class="reco-alert-icon">⚠</span>
            <span class="reco-alert-text">${clean(a.text)}</span>
            ${a.timeLeft ? `<span class="reco-alert-time">${a.timeLeft}</span>` : ''}
          </div>`
        ).join('');
      } else {
        alertsEl.innerHTML = '';
      }
    }

    // Outdoor guidelines
    const outdoorEl = document.getElementById('reco-outdoor');
    if (outdoorEl && data.outdoor) {
      outdoorEl.innerHTML = data.outdoor.map(g =>
        `<li><strong>${clean(g.title)}:</strong> ${clean(g.detail)}</li>`
      ).join('');
    }

    // Indoor guidelines
    const indoorEl = document.getElementById('reco-indoor');
    if (indoorEl && data.indoor) {
      indoorEl.innerHTML = data.indoor.map(g =>
        `<li><strong>${clean(g.title)}:</strong> ${clean(g.detail)}</li>`
      ).join('');
    }

    // Footer meta
    const meta = document.getElementById('reco-meta');
    if (meta) {
      const reportNote = data.reportCount > 0 ? ` · ${data.reportCount} active report${data.reportCount > 1 ? 's' : ''}` : '';
      meta.textContent = `Based on local data & map pins${reportNote}`;
    }

    // Pulse ring color
    const ring = document.getElementById('aqi-pulse-ring');
    if (ring) ring.style.borderColor = info.color;
  }

  window.refreshRecommendations = function () {
    const btn = document.querySelector('.reco-refresh-btn');
    if (btn) { btn.classList.add('spinning'); setTimeout(() => btn.classList.remove('spinning'), 1500); }
    fetchRecommendations();
  };

  /* ==========================================
     BOOTSTRAP
     ========================================== */
  document.addEventListener('DOMContentLoaded', () => {
    initChart();
    initMap().then(() => {
      if (window.initReports) window.initReports(state.map);
      // Fetch recommendations for NDMC CHARGE 3 only
      setTimeout(() => fetchRecommendations(), 3000);
      // Auto-refresh every 5 min
      setInterval(() => fetchRecommendations(), 5 * 60 * 1000);
    });
  });

})();
