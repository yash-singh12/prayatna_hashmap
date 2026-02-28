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

  let state = {
    map: null,
    heatmapLayer: null,
    wardLayers: [],
    heatmapVisible: true,
    chart: null
  };

  /* ==========================================
     CHART.JS FORECAST INIT
     ========================================== */
  function initChart() {
    const ctx = document.getElementById('forecastChart');
    if (!ctx) return;

    // Faux 24h data resembling the reference chart
    const dataVals = Array.from({ length: 24 }, (_, i) => {
      let v = 40 + Math.random() * 20;
      if (i > 6 && i < 11) v += 30; // Morning peak
      if (i > 17 && i < 22) v += 40; // Evening peak
      return v;
    });

    const colors = dataVals.map(v => v > 100 ? '#ff6b35' : v > 50 ? '#fbbf24' : '#4ade80');

    state.chart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: Array.from({ length: 24 }, (_, i) => i),
        datasets: [{
          data: dataVals,
          backgroundColor: colors,
          borderRadius: 4,
          barPercentage: 0.6
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { enabled: false } },
        scales: {
          x: { display: false },
          y: { display: false, min: 0, max: 150 }
        }
      }
    });

    // Custom labels are done dynamically in HTML
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

    // Update AQI Details Card
    document.getElementById('aqi-card-location').textContent = `📍 ${data.name}`;
    document.getElementById('aqi-card-val').textContent = data.aqi;
    document.getElementById('aqi-card-val').style.color = info.color;
    document.getElementById('aqi-card-val').style.filter = `drop-shadow(0 0 20px ${info.color}60)`;

    document.getElementById('aqi-card-risk').textContent = info.label;
    document.getElementById('aqi-card-risk').style.color = info.color;

    document.getElementById('aqi-card-risk-fill').style.width = `${pct * 100}%`;
    document.getElementById('aqi-pulse-ring').style.borderColor = info.color;

    document.getElementById('aqi-card-dominant').textContent = data.dominant;

    // Update Bubbles
    const domElem = document.getElementById(`bubble-${data.dominant.toLowerCase().replace('.', '')}`);
    if (domElem) {
      // Highlight dominant bubble slightly
      document.querySelectorAll('.pollutant-bubble').forEach(b => b.style.transform = 'scale(1)');
      domElem.style.transform = 'scale(1.1)';
    }

    // Set Faux Pollutant Data
    document.querySelector('#bubble-pm25 .b-value').textContent = Math.round(data.aqi * 0.75);
    document.querySelector('#bubble-pm10 .b-value').textContent = Math.round(data.aqi * 0.98);
    document.querySelector('#bubble-no2 .b-value').textContent = Math.round(data.aqi * 0.32);
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
      const geojson = await response.json();

      const heatPoints = [];
      let totalAqi = 0;
      let validCount = 0;

      geojson.features.forEach(feature => {
        const randomAqi = Math.floor(Math.random() * 350) + 20;
        feature.properties.simulatedAqi = randomAqi;
        feature.properties.dominant = ['PM2.5', 'PM10', 'NO2'][Math.floor(Math.random() * 3)];

        totalAqi += randomAqi;
        validCount++;

        if (feature.geometry && feature.geometry.coordinates) {
          const center = getPolygonCentroid(feature.geometry.coordinates);
          feature.properties.center = center;

          const intensity = Math.min(randomAqi / 350, 1.0);
          heatPoints.push([center[0], center[1], intensity]);

          for (let i = 0; i < 5; i++) {
            heatPoints.push([
              center[0] + (Math.random() - 0.5) * 0.03,
              center[1] + (Math.random() - 0.5) * 0.03,
              intensity * (0.4 + Math.random() * 0.5)
            ]);
          }
        }
      });

      // Init cards with average data
      updateSidebarCards({
        name: "DELHI NCR — ALL WARDS",
        aqi: Math.round(totalAqi / validCount),
        dominant: "PM2.5"
      });

      const geoJsonLayer = L.geoJSON(geojson, {
        style: function (feature) {
          const info = getAQIInfo(feature.properties.simulatedAqi);
          return { color: info.color, weight: 1, opacity: 0.8, fillColor: info.color, fillOpacity: 0.15 };
        },
        onEachFeature: function (feature, layer) {
          const wardName = feature.properties.Ward_Name || 'Unknown Ward';

          layer.on({
            mouseover: function (e) {
              const rect = e.target;
              rect.setStyle({ fillOpacity: 0.4, weight: 2 });
              rect.bringToFront();

              updateSidebarCards({
                name: "WARD: " + wardName,
                aqi: feature.properties.simulatedAqi,
                dominant: feature.properties.dominant
              });
            },
            mouseout: function (e) {
              geoJsonLayer.resetStyle(e.target);
            }
          });
          state.wardLayers.push(layer);
        }
      }).addTo(state.map);

      if (L.heatLayer) {
        state.heatmapLayer = L.heatLayer(heatPoints, {
          radius: 35, blur: 25, maxZoom: 13, minOpacity: 0.3,
          gradient: { 0: '#00e676', 0.3: '#fbbf24', 0.5: '#ff9800', 0.75: '#f44336', 1: '#9c27b0' }
        });

        if (state.heatmapVisible) { state.heatmapLayer.addTo(state.map); }
      }

    } catch (error) {
      console.error("GeoJSON load error:", error);
    }
  }

  window.mapZoomIn = () => state.map?.zoomIn();
  window.mapZoomOut = () => state.map?.zoomOut();
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
     BOOTSTRAP
     ========================================== */
  document.addEventListener('DOMContentLoaded', () => {
    initChart();
    initMap();
  });

})();
