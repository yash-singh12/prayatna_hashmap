/* ==========================================
   AIRA — Civic Monitoring & Mitigation JS
   ========================================== */
'use strict';

const API = window.location.origin + '/api';

/* ---------- STATE ---------- */
let civicMap = null;
let wardLayers = {};
let hotspotMarkers = [];
let allSummaries = [];
let selectedWard = null;

/* ---------- HELPERS ---------- */
function aqiColor(aqi) {
  if (aqi <= 50)  return '#4ade80';
  if (aqi <= 100) return '#facc15';
  if (aqi <= 200) return '#fb923c';
  if (aqi <= 300) return '#ef4444';
  if (aqi <= 400) return '#a855f7';
  return '#be123c';
}

function aqiLabel(aqi) {
  if (aqi <= 50)  return 'Good';
  if (aqi <= 100) return 'Satisfactory';
  if (aqi <= 200) return 'Moderate';
  if (aqi <= 300) return 'Poor';
  if (aqi <= 400) return 'Very Poor';
  return 'Severe';
}

function riskColor(score) {
  if (score >= 80) return '#ef4444';
  if (score >= 60) return '#f97316';
  if (score >= 40) return '#facc15';
  if (score >= 20) return '#4ade80';
  return '#94a3b8';
}

function trendIcon(trend) {
  if (trend === 'rising')  return '<span class="cv-trend cv-trend-up">▲ Rising</span>';
  if (trend === 'falling') return '<span class="cv-trend cv-trend-down">▼ Falling</span>';
  return '<span class="cv-trend cv-trend-stable">● Stable</span>';
}

function clean(s) { return (s || '').replace(/\*+/g, ''); }

/* ---------- INIT MAP ---------- */
async function initCivicMap() {
  civicMap = L.map('civic-map', {
    center: [28.63, 77.22],
    zoom: 11,
    zoomControl: true,
    attributionControl: false
  });

  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    maxZoom: 18
  }).addTo(civicMap);

  try {
    const resp = await fetch('Delhi_Boundary.geojson');
    const geojson = await resp.json();
    geojson.features.forEach(feature => {
      const name = feature.properties.Ward_Name || 'Unknown';
      const layer = L.geoJSON(feature, {
        style: { color: '#334155', weight: 1, fillColor: '#1e293b', fillOpacity: 0.4 }
      }).addTo(civicMap);
      layer.on('click', () => selectWardOnMap(name));
      wardLayers[name] = layer;
    });
  } catch (err) {
    console.error('[Civic] GeoJSON error:', err);
  }
}

/* ---------- FETCH DATA ---------- */
async function fetchWardSummary() {
  try {
    const resp = await fetch(API + '/civic/ward-summary');
    const json = await resp.json();
    if (!json.ok) throw new Error(json.error);

    allSummaries = json.all || [];
    document.getElementById('cv-severe-count').textContent = json.severe_count || 0;
    document.getElementById('cv-hotspot-count').textContent = json.hotspot_count || 0;
    const totalReports = allSummaries.reduce((s, w) => s + w.total_reports, 0);
    document.getElementById('cv-total-reports').textContent = totalReports;

    renderCommandPanel(json.top5 || []);
    colorMap(allSummaries);
    renderHotspots(allSummaries.filter(w => w.is_hotspot));
    document.getElementById('cv-map-badge').textContent = `${json.hotspot_count || 0} ACTIVE`;
  } catch (err) {
    console.error('[Civic] ward-summary error:', err);
  }
}

async function fetchTimeline() {
  try {
    const resp = await fetch(API + '/civic/timeline');
    const json = await resp.json();
    if (!json.ok) throw new Error(json.error);
    renderTimeline(json.events || []);
  } catch (err) {
    console.error('[Civic] timeline error:', err);
  }
}

async function fetchCivicReco(wardName) {
  const listEl = document.getElementById('cv-action-list');
  const assessEl = document.getElementById('cv-assessment');
  const srcBadge = document.getElementById('cv-source-badge');
  listEl.innerHTML = '<div class="cv-empty"><div class="cv-spinner"></div>Generating administrative directives…</div>';
  assessEl.textContent = '';
  srcBadge.textContent = '…';
  srcBadge.className = 'cv-badge cv-badge-blue';

  try {
    const resp = await fetch(API + '/civic/recommendations?ward=' + encodeURIComponent(wardName));
    const json = await resp.json();
    if (!json.ok) throw new Error(json.error);

    // Show source badge
    if (json.source === 'ai') {
      srcBadge.textContent = '🤖 AI';
      srcBadge.className = 'cv-badge cv-badge-green';
    } else {
      srcBadge.textContent = '📐 RULES';
      srcBadge.className = 'cv-badge cv-badge-amber';
    }

    renderActions(json);
  } catch (err) {
    console.error('[Civic] reco error:', err);
    listEl.innerHTML = '<div class="cv-empty">Failed to load directives</div>';
    srcBadge.textContent = 'ERROR';
    srcBadge.className = 'cv-badge cv-badge-red';
  }
}

/* ---------- RENDER: Command Panel (Top 5 Risk Wards) ---------- */
function renderCommandPanel(top5) {
  const el = document.getElementById('cv-ward-list');
  if (!top5.length) {
    el.innerHTML = '<div class="cv-empty">No ward data available</div>';
    return;
  }

  el.innerHTML = top5.map((w, i) => {
    const sel = selectedWard === w.ward_name ? 'cv-row-active' : '';
    return `
    <div class="cv-ward-row ${sel}" onclick="selectWardOnMap('${w.ward_name.replace(/'/g, "\\'")}')">
      <div class="cv-row-rank">${i + 1}</div>
      <div class="cv-row-body">
        <div class="cv-row-top">
          <span class="cv-row-name">${w.ward_name}${w.is_hotspot ? ' <span class="cv-hotspot-tag">🔥 HOTSPOT</span>' : ''}</span>
          <span class="cv-row-score" style="background:${riskColor(w.risk_score)}22;color:${riskColor(w.risk_score)};border:1px solid ${riskColor(w.risk_score)}44">${w.risk_score}</span>
        </div>
        <div class="cv-row-bottom">
          <span class="cv-row-aqi" style="color:${aqiColor(w.aqi)}">AQI ${w.aqi}</span>
          ${trendIcon(w.trend)}
          <span class="cv-row-reports">📝 ${w.verified_reports} verified / ${w.total_reports} total</span>
        </div>
        <div class="cv-row-bar">
          <div class="cv-row-bar-fill" style="width:${Math.min(w.risk_score, 100)}%;background:${riskColor(w.risk_score)}"></div>
        </div>
      </div>
    </div>`;
  }).join('');
}

/* ---------- RENDER: Color Map ---------- */
function colorMap(summaries) {
  summaries.forEach(w => {
    const layer = wardLayers[w.ward_name];
    if (!layer) return;
    layer.setStyle({
      fillColor: riskColor(w.risk_score),
      fillOpacity: 0.25 + (w.risk_score / 250),
      color: w.is_hotspot ? '#ef4444' : '#475569',
      weight: w.is_hotspot ? 2.5 : 1
    });
    // Enhanced tooltip
    layer.unbindTooltip();
    layer.bindTooltip(
      `<strong>${w.ward_name}</strong><br>AQI: <span style="color:${aqiColor(w.aqi)}">${w.aqi} (${aqiLabel(w.aqi)})</span><br>Risk: ${w.risk_score}/100 · ${w.trend}${w.is_hotspot ? '<br>⚠️ Active Hotspot' : ''}`,
      { sticky: true, className: 'cv-tooltip', direction: 'top' }
    );
  });
}

/* ---------- RENDER: Hotspot Markers ---------- */
function renderHotspots(hotspots) {
  hotspotMarkers.forEach(m => civicMap.removeLayer(m));
  hotspotMarkers = [];

  hotspots.forEach(w => {
    const layer = wardLayers[w.ward_name];
    if (!layer) return;
    const center = layer.getBounds().getCenter();
    const icon = L.divIcon({
      className: 'cv-hotspot-marker',
      html: `<div class="cv-fire-pulse">${w.hotspot_type === 'emergency' ? '🚨' : '🔥'}</div>`,
      iconSize: [36, 36],
      iconAnchor: [18, 18]
    });
    const marker = L.marker(center, { icon }).addTo(civicMap);
    marker.bindTooltip(
      `<strong>${w.ward_name}</strong><br>${w.hotspot_type === 'emergency' ? '🚨 EMERGENCY' : '🔥 Active Event'}<br>Risk: ${w.risk_score}/100`,
      { className: 'cv-tooltip' }
    );
    marker.on('click', () => selectWardOnMap(w.ward_name));
    hotspotMarkers.push(marker);
  });
}

/* ---------- RENDER: Admin Action Cards ---------- */
function renderActions(data) {
  const listEl = document.getElementById('cv-action-list');
  const assessEl = document.getElementById('cv-assessment');

  // Ward detail card
  const detail = document.getElementById('cv-ward-detail');
  detail.style.display = 'flex';
  document.getElementById('cv-selected-ward').textContent = data.ward_name;
  const riskEl = document.getElementById('cv-selected-risk');
  riskEl.textContent = data.risk_score;
  riskEl.style.background = riskColor(data.risk_score) + '22';
  riskEl.style.color = riskColor(data.risk_score);
  riskEl.style.border = `1px solid ${riskColor(data.risk_score)}44`;

  document.getElementById('cv-selected-aqi').innerHTML =
    `<span style="color:${aqiColor(data.aqi)}">AQI ${data.aqi}</span> · ${aqiLabel(data.aqi)}`;
  document.getElementById('cv-selected-trend').innerHTML = trendIcon(data.trend);
  document.getElementById('cv-selected-reports').textContent =
    `${data.verified_reports} verified reports`;

  // Assessment
  assessEl.textContent = clean(data.assessment) || '';

  if (!data.actions || !data.actions.length) {
    listEl.innerHTML = '<div class="cv-empty">No directives generated</div>';
    return;
  }

  listEl.innerHTML = data.actions.map((a, i) => {
    const urgCls = a.urgency === 'high' ? 'cv-act-high' : a.urgency === 'medium' ? 'cv-act-med' : 'cv-act-low';
    const urgLabel = a.urgency === 'high' ? 'HIGH' : a.urgency === 'medium' ? 'MEDIUM' : 'LOW';
    const dept = clean(a.dept) || 'Municipal Admin';
    return `
    <div class="cv-action-card ${urgCls}">
      <div class="cv-act-header">
        <span class="cv-act-num">${i + 1}</span>
        <span class="cv-act-title">${clean(a.title)}</span>
        <span class="cv-act-urg ${urgCls}-badge">${urgLabel}</span>
      </div>
      <div class="cv-act-detail">${clean(a.detail)}</div>
      <div class="cv-act-footer">
        <span class="cv-act-dept">🏢 ${dept}</span>
      </div>
    </div>`;
  }).join('');
}

/* ---------- RENDER: Timeline ---------- */
function renderTimeline(events) {
  const el = document.getElementById('cv-timeline-list');
  if (!events.length) {
    el.innerHTML = '<div class="cv-empty">No recent incidents</div>';
    return;
  }

  el.innerHTML = events.slice(0, 25).map(e => {
    const t = new Date(e.time + 'Z');
    const timeStr = t.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
    const dateStr = t.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

    let label = '', cls = '';
    if (e.type === 'report_created') {
      label = `New ${e.category} report filed`;
      cls = 'cv-tl-new';
    } else if (e.type === 'report_verified') {
      label = `${e.category} report verified (${e.confidence}% confidence)`;
      cls = 'cv-tl-verified';
    } else if (e.type === 'report_expired') {
      label = `${e.category} report expired`;
      cls = 'cv-tl-expired';
    }

    return `
    <div class="cv-tl-row ${cls}">
      <div class="cv-tl-time-col">
        <span class="cv-tl-time">${timeStr}</span>
        <span class="cv-tl-date">${dateStr}</span>
      </div>
      <div class="cv-tl-line">
        <div class="cv-tl-dot"></div>
      </div>
      <div class="cv-tl-body">
        <span class="cv-tl-icon">${e.icon}</span>
        <span class="cv-tl-label">${label}</span>
      </div>
    </div>`;
  }).join('');
}

/* ---------- WARD SELECTION ---------- */
function selectWardOnMap(wardName) {
  selectedWard = wardName;

  // Highlight on map
  Object.entries(wardLayers).forEach(([name, layer]) => {
    if (name === wardName) {
      layer.setStyle({ weight: 3, color: '#00d4ff', fillOpacity: 0.5 });
      layer.bringToFront();
      civicMap.fitBounds(layer.getBounds(), { padding: [40, 40], maxZoom: 13 });
    } else {
      const s = allSummaries.find(w => w.ward_name === name);
      layer.setStyle({
        weight: s && s.is_hotspot ? 2.5 : 1,
        color: s && s.is_hotspot ? '#ef4444' : '#475569',
        fillOpacity: s ? 0.25 + (s.risk_score / 250) : 0.4
      });
    }
  });

  // Re-render command panel highlight
  const top5 = allSummaries.slice(0, 5);
  renderCommandPanel(top5);

  // Fetch admin directives
  fetchCivicReco(wardName);
}

/* ---------- REFRESH ---------- */
function civicRefresh() {
  const btn = document.querySelector('.cv-refresh-btn');
  if (btn) btn.classList.add('cv-refreshing');
  setTimeout(() => btn && btn.classList.remove('cv-refreshing'), 1500);
  fetchWardSummary();
  fetchTimeline();
  if (selectedWard) fetchCivicReco(selectedWard);
}
window.civicRefresh = civicRefresh;
window.selectWardOnMap = selectWardOnMap;

/* ---------- BOOTSTRAP ---------- */
document.addEventListener('DOMContentLoaded', async () => {
  await initCivicMap();
  await fetchWardSummary();
  await fetchTimeline();

  // Auto-refresh every 2 min
  setInterval(() => { fetchWardSummary(); fetchTimeline(); }, 2 * 60 * 1000);

  // Auto-select highest-risk ward
  if (allSummaries.length > 0) {
    selectWardOnMap(allSummaries[0].ward_name);
  }
});
