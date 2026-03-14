/* ==========================================
   AIRA — CITIZEN REPORTER MODULE
   ========================================== */

(function () {
  'use strict';

  const CATEGORIES = {
    burning:    { label: 'Illegal Burning',  icon: '🔥', color: '#ef4444' },
    vehicle:    { label: 'Vehicle Smoke',    icon: '🚗', color: '#f97316' },
    industrial: { label: 'Industrial',       icon: '🏭', color: '#8b5cf6' },
    other:      { label: 'Other Hazard',     icon: '⚠️', color: '#fbbf24' }
  };

  /* Report expiry hours — must match server REPORT_EXPIRY */
  const REPORT_EXPIRY = { burning: 2, vehicle: 2, industrial: 6, construction: 6, other: 3 };
  const POLL_WINDOW_MIN = 12;
  const PROXIMITY_KM = 10.0;

  const API_BASE = window.location.origin + '/api';

  /* Anonymous voter ID (persisted per browser) */
  function getVoterUid() {
    let uid = localStorage.getItem('aira_voter_uid');
    if (!uid) { uid = 'v_' + Math.random().toString(36).slice(2) + Date.now().toString(36); localStorage.setItem('aira_voter_uid', uid); }
    return uid;
  }

  /* Default ward: NDMC CHARGE 3 center (for prototype testing) */
  let rs = {
    mainMap:   null,
    miniMap:   null,
    miniPin:   null,
    lat:       28.632,
    lng:       77.210,
    category:  null,
    media:     null,
    markers:   []
  };

  /* ==========================================
     PAGE SWITCHING
     ========================================== */
  const PAGES = ['page-dashboard', 'page-alerts', 'page-report'];

  function activateNav(pageId) {
    document.querySelectorAll('.nav-item').forEach(n => {
      n.classList.remove('active');
      const ind = n.querySelector('.nav-indicator');
      if (ind) ind.remove();
    });
    const navEl = document.querySelector(`[data-page="${pageId}"]`);
    if (navEl) {
      navEl.classList.add('active');
      const ind = document.createElement('div');
      ind.className = 'nav-indicator';
      navEl.prepend(ind);
    }
  }

  window.switchPage = function (pageId) {
    PAGES.forEach(pid => {
      const el = document.getElementById(pid);
      if (el) el.style.display = 'none';
    });

    if (pageId === 'report') {
      document.getElementById('page-report').style.display = 'flex';
      activateNav('report');
      if (!rs.miniMap) setTimeout(initMiniMap, 80);
    } else if (pageId === 'alerts') {
      document.getElementById('page-alerts').style.display = 'flex';
      activateNav('alerts');
      renderAlerts();
    } else {
      document.getElementById('page-dashboard').style.display = 'flex';
      activateNav('dashboard');
    }
  };

  /* ==========================================
     MINI MAP (Report Page)
     ========================================== */
  function initMiniMap() {
    rs.miniMap = L.map('report-map', {
      center: [rs.lat, rs.lng],
      zoom: 11,
      zoomControl: false,
      attributionControl: false
    });

    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      subdomains: 'abcd', maxZoom: 19
    }).addTo(rs.miniMap);

    rs.miniPin = L.marker([rs.lat, rs.lng], {
      draggable: true,
      icon: L.divIcon({
        className: '',
        html: '<div class="mini-pin"></div>',
        iconSize: [22, 22],
        iconAnchor: [11, 11]
      })
    }).addTo(rs.miniMap);

    updateCoords(rs.lat, rs.lng);

    rs.miniPin.on('dragend', function (e) {
      const p = e.target.getLatLng();
      rs.lat = p.lat; rs.lng = p.lng;
      updateCoords(p.lat, p.lng);
    });

    rs.miniMap.on('click', function (e) {
      rs.miniPin.setLatLng(e.latlng);
      rs.lat = e.latlng.lat; rs.lng = e.latlng.lng;
      updateCoords(rs.lat, rs.lng);
    });
  }

  function updateCoords(lat, lng) {
    const el = document.getElementById('rp-coords');
    if (el) el.textContent = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  }

  /* ==========================================
     GEOLOCATION
     ========================================== */
  window.detectLocation = function () {
    const btn = document.getElementById('rp-detect-btn');
    if (btn) { btn.textContent = 'Detecting…'; btn.disabled = true; }

    navigator.geolocation.getCurrentPosition(
      function (pos) {
        rs.lat = pos.coords.latitude;
        rs.lng = pos.coords.longitude;
        updateCoords(rs.lat, rs.lng);
        if (rs.miniMap && rs.miniPin) {
          rs.miniMap.setView([rs.lat, rs.lng], 14);
          rs.miniPin.setLatLng([rs.lat, rs.lng]);
        }
        if (btn) { btn.innerHTML = '✓ Located'; btn.disabled = false; btn.style.color = '#00e676'; }
      },
      function () {
        if (btn) { btn.textContent = '📍 Detect Location'; btn.disabled = false; }
        showToast('Location access denied. Drag the pin manually.', 'error');
      },
      { timeout: 8000 }
    );
  };

  /* ==========================================
     CATEGORY SELECTION
     ========================================== */
  window.selectCategory = function (cat) {
    rs.category = cat;
    document.querySelectorAll('.rp-cat-btn').forEach(b => b.classList.remove('active'));
    const btn = document.querySelector(`.rp-cat-btn[data-cat="${cat}"]`);
    if (btn) btn.classList.add('active');
  };

  /* ==========================================
     MEDIA UPLOAD
     ========================================== */
  window.handleMediaUpload = function (input) {
    const file = input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function (e) {
      rs.media = e.target.result;
      const preview = document.getElementById('rp-media-preview');
      if (!preview) return;
      preview.style.display = 'block';
      if (file.type.startsWith('image/')) {
        preview.innerHTML = `<img src="${e.target.result}" alt="Preview">`;
      } else {
        preview.innerHTML = `<div class="rp-video-placeholder">🎥 Video ready · ${(file.size / 1048576).toFixed(1)} MB</div>`;
      }
    };
    reader.readAsDataURL(file);
  };

  /* ==========================================
     SUBMIT REPORT
     ========================================== */
  window.submitReport = async function () {
    if (!rs.category) {
      showToast('Please select an incident category.', 'error'); return;
    }
    const desc = document.getElementById('rp-description').value.trim();
    if (!desc) {
      showToast('Please add a description of the incident.', 'error'); return;
    }

    const report = {
      lat:         rs.lat,
      lng:         rs.lng,
      category:    rs.category,
      description: desc,
      media:       rs.media,
      voter_uid:   getVoterUid()
    };

    try {
      const resp = await fetch(API_BASE + '/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(report)
      });
      const json = await resp.json();
      if (json.status !== 'ok') throw new Error(json.message);

      // Reload markers from server
      await loadExistingReports();

      showToast('✓ Report submitted successfully!', 'success');
      resetForm();
      setTimeout(() => switchPage('dashboard'), 1400);
    } catch (err) {
      showToast('Failed to submit: ' + err.message, 'error');
    }
  };

  window.cancelReport = function () {
    resetForm();
    switchPage('dashboard');
  };

  function resetForm() {
    rs.category = null; rs.media = null;
    document.querySelectorAll('.rp-cat-btn').forEach(b => b.classList.remove('active'));
    const desc = document.getElementById('rp-description');
    if (desc) desc.value = '';
    const preview = document.getElementById('rp-media-preview');
    if (preview) { preview.style.display = 'none'; preview.innerHTML = ''; }
    const btn = document.getElementById('rp-detect-btn');
    if (btn) { btn.textContent = '📍 Detect Location'; btn.style.color = ''; }
  }

  /* ==========================================
     REPORT MARKER ON MAIN MAP — with Poll + Confidence
     ========================================== */
  function addReportMarker(report) {
    const cat     = CATEGORIES[report.category] || CATEGORIES.other;
    // Ensure UTC parsing — SQLite datetime('now') returns UTC without Z suffix
    const createdStr = report.created_at && !report.created_at.endsWith('Z') ? report.created_at + 'Z' : report.created_at;
    const timeAgo = getTimeAgo(new Date(createdStr));
    const thumb   = report.media && report.media.startsWith('data:image')
      ? `<img src="${report.media}" class="rp-pop-thumb">`
      : '';

    const conf = report.confidence || { score: 50, label: 'Medium', votes: { confirmed: 0, false: 0, unsure: 0 }, totalVotes: 0, nearbyCount: 0 };
    const confColor = conf.score >= 75 ? '#00e676' : conf.score >= 50 ? '#fbbf24' : '#ef4444';

    // Expiry timer
    const expiryHours = REPORT_EXPIRY[report.category] || 3;
    const created = new Date(createdStr).getTime();
    const expiresAt = created + expiryHours * 3600000;
    const minsLeft = Math.max(0, Math.round((expiresAt - Date.now()) / 60000));
    const expiryLabel = minsLeft > 60 ? `${Math.floor(minsLeft / 60)}h ${minsLeft % 60}m left` : `${minsLeft}m left`;

    // Poll open?
    const pollOpen = report.pollOpen !== undefined ? report.pollOpen : ((Date.now() - created) < POLL_WINDOW_MIN * 60000);
    const pollClosesAt = created + POLL_WINDOW_MIN * 60000;
    const pollMinsLeft = Math.max(0, Math.round((pollClosesAt - Date.now()) / 60000));

    const icon = L.divIcon({
      className: '',
      html: `<div class="report-marker" style="--mc:${cat.color}">
               <span class="rm-icon">${cat.icon}</span>
             </div>`,
      iconSize:   [38, 38],
      iconAnchor: [19, 19]
    });

    // Build poll HTML
    const pollHtml = pollOpen
      ? `<div class="rp-poll" data-rid="${report.id}">
           <div class="rp-poll-header">
             <span class="rp-poll-title">Is this accurate?</span>
             <span class="rp-poll-timer">${pollMinsLeft}m left</span>
           </div>
           <div class="rp-poll-btns">
             <button class="rp-vote-btn rp-vote-confirm" data-vote="confirmed" onclick="voteReport(${report.id},'confirmed',this)">
               ✓ Confirm <span class="rp-vc">${conf.votes.confirmed || 0}</span>
             </button>
             <button class="rp-vote-btn rp-vote-false" data-vote="false" onclick="voteReport(${report.id},'false',this)">
               ✗ False <span class="rp-vc">${conf.votes.false || 0}</span>
             </button>
             <button class="rp-vote-btn rp-vote-unsure" data-vote="unsure" onclick="voteReport(${report.id},'unsure',this)">
               ? Unsure <span class="rp-vc">${conf.votes.unsure || 0}</span>
             </button>
           </div>
         </div>`
      : `<div class="rp-poll-closed">Poll closed</div>`;

    const popupContent =
      `<div class="report-popup">
        ${thumb}
        <div class="rp-pop-cat" style="color:${cat.color}">${cat.icon} ${cat.label}</div>
        <div class="rp-pop-desc">${report.description}</div>
        <div class="rp-pop-conf">
          <div class="rp-conf-bar-wrap">
            <div class="rp-conf-bar" style="width:${conf.score}%;background:${confColor}"></div>
          </div>
          <span class="rp-conf-label" style="color:${confColor}">${conf.score}% ${conf.label}</span>
          ${conf.nearbyCount > 0 ? `<span class="rp-nearby-badge">${conf.nearbyCount} nearby</span>` : ''}
        </div>
        ${pollHtml}
        <div class="rp-pop-meta">
          <span>${timeAgo}</span>
          <span class="rp-expiry-badge">⏱ ${expiryLabel}</span>
        </div>
      </div>`;

    const marker = L.marker([report.lat, report.lng], { icon })
      .bindPopup(popupContent, { maxWidth: 260, className: 'report-popup-wrap' })
      .addTo(rs.mainMap);

    rs.markers.push({ id: report.id, marker });
  }

  /* ==========================================
     VOTE ON A REPORT
     ========================================== */
  window.voteReport = async function (reportId, vote, btn) {
    // Use default ward location (NDMC Charge 3) for proximity — not actual browser geolocation
    let userLat = rs.lat, userLng = rs.lng;

    // Client-side proximity check
    const report = rs._reportsCache ? rs._reportsCache.find(r => r.id === reportId) : null;
    if (report) {
      const dist = haversineJS(userLat, userLng, report.lat, report.lng);
      if (dist > PROXIMITY_KM) {
        showToast('You must be near this location to vote.', 'error');
        return;
      }
    }

    try {
      const resp = await fetch(API_BASE + '/reports/' + reportId + '/vote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vote, voter_uid: getVoterUid(), lat: userLat, lng: userLng })
      });
      const json = await resp.json();
      if (json.status !== 'ok') {
        showToast(json.message || 'Vote failed', 'error');
        return;
      }
      // Highlight selected button
      const pollDiv = btn.closest('.rp-poll');
      if (pollDiv) {
        pollDiv.querySelectorAll('.rp-vote-btn').forEach(b => b.classList.remove('voted'));
        btn.classList.add('voted');
        // Update vote counts in the popup
        const conf = json.confidence;
        if (conf && conf.votes) {
          pollDiv.querySelectorAll('.rp-vote-btn').forEach(b => {
            const v = b.getAttribute('data-vote');
            const span = b.querySelector('.rp-vc');
            if (span && conf.votes[v] !== undefined) span.textContent = conf.votes[v];
          });
        }
        // Update confidence bar in popup
        const popup = btn.closest('.report-popup');
        if (popup && conf) {
          const bar = popup.querySelector('.rp-conf-bar');
          const label = popup.querySelector('.rp-conf-label');
          const confColor = conf.score >= 75 ? '#00e676' : conf.score >= 50 ? '#fbbf24' : '#ef4444';
          if (bar) { bar.style.width = conf.score + '%'; bar.style.background = confColor; }
          if (label) { label.textContent = conf.score + '% ' + conf.label; label.style.color = confColor; }
        }
      }
      showToast('Vote recorded!', 'success');
    } catch (err) {
      showToast('Network error', 'error');
    }
  };

  /** Haversine distance in km (client-side) */
  function haversineJS(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  /* ==========================================
     ALERTS RENDERER
     ========================================== */
  function renderAlerts() {
    const list    = document.getElementById('al-alerts-list');
    const tsEl    = document.getElementById('al-timestamp');
    const badgeEl = document.getElementById('alert-badge');
    if (!list) return;

    const wardData = window.getWardAlertData ? window.getWardAlertData() : [];
    const reports  = rs._reportsCache || [];
    const alerts   = [];

    wardData.forEach(w => {
      if (w.aqi >= 300) {
        alerts.push({ type: 'critical', ward: w.name, aqi: w.aqi, pm25: w.pm25, no2: w.no2,
          title: `Hazardous AQI — ${w.name}`,
          detail: `AQI ${w.aqi} exceeds safe limit by ${Math.round(w.aqi/50)}×. Dominant: ${w.dominant}. Immediate action required.`,
          time: 'live', color: '#ef4444' });
      } else if (w.aqi >= 200) {
        alerts.push({ type: 'warning', ward: w.name, aqi: w.aqi, pm25: w.pm25, no2: w.no2,
          title: `Very Unhealthy — ${w.name}`,
          detail: `AQI ${w.aqi}. Sensitive groups must stay indoors. Outdoor exercise prohibited.`,
          time: 'live', color: '#f97316' });
      }
      if (w.pm25 > 150) {
        alerts.push({ type: 'warning', ward: w.name, aqi: w.aqi, pm25: w.pm25, no2: w.no2,
          title: `PM2.5 Spike — ${w.name}`,
          detail: `PM2.5 at ${w.pm25} µg/m³ — ${Math.round(w.pm25 / 15)}× WHO safe limit. Wear N95 mask.`,
          time: 'live', color: '#fbbf24' });
      }
      if (w.no2 > 80) {
        alerts.push({ type: 'warning', ward: w.name, aqi: w.aqi, pm25: w.pm25, no2: w.no2,
          title: `NO₂ Elevated — ${w.name}`,
          detail: `NO₂ at ${w.no2} ppb. Likely traffic or industrial source. DPCC notified.`,
          time: 'live', color: '#fbbf24' });
      }
    });

    // Citizen report cluster alerts
    const clusters = {};
    reports.forEach(r => {
      const key = `${Math.round(r.lat * 40)}_${Math.round(r.lng * 40)}`;
      if (!clusters[key]) clusters[key] = [];
      clusters[key].push(r);
    });
    Object.values(clusters).forEach(cluster => {
      if (cluster.length >= 2) {
        const r   = cluster[0];
        const cat = CATEGORIES[r.category] || CATEGORIES.other;
        alerts.push({ type: 'report', ward: 'Citizen Cluster',
          title: `${cluster.length} Reports: ${cat.label}`,
          detail: `${cluster.length} citizen reports clustered near ${r.lat.toFixed(3)}, ${r.lng.toFixed(3)}. Flagged for inspection.`,
          time: getTimeAgo(new Date(utcStr(r.created_at || r.timestamp))), color: '#8b5cf6' });
      }
    });
    reports.slice(-4).reverse().forEach(r => {
      const cat = CATEGORIES[r.category] || CATEGORIES.other;
      alerts.push({ type: 'report', ward: 'Citizen Report',
        title: `${cat.icon} ${cat.label} Reported`,
        detail: r.description.length > 90 ? r.description.slice(0, 90) + '…' : r.description,
        time: getTimeAgo(new Date(utcStr(r.created_at || r.timestamp))), color: '#8b5cf6' });
    });

    // Update summary stats
    const nCritical = alerts.filter(a => a.type === 'critical').length;
    const nWarning  = alerts.filter(a => a.type === 'warning').length;
    const nWards    = new Set(alerts.filter(a => a.ward !== 'Citizen Report' && a.ward !== 'Citizen Cluster').map(a => a.ward)).size;
    const setEl = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
    setEl('al-stat-critical', nCritical);
    setEl('al-stat-warning',  nWarning);
    setEl('al-stat-reports',  reports.length);
    setEl('al-stat-wards',    nWards);

    // Update bell badge
    const total = nCritical + nWarning;
    if (badgeEl) {
      badgeEl.textContent  = total > 0 ? total : '0';
      badgeEl.style.background = nCritical > 0 ? '#ef4444' : total > 0 ? '#f97316' : '#475569';
    }

    // Timestamp
    if (tsEl) {
      const now = new Date();
      tsEl.textContent = `Updated ${now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })} · ${alerts.length} active alert${alerts.length !== 1 ? 's' : ''}`;
    }

    if (alerts.length === 0) {
      list.innerHTML = `<div class="al-empty">
        <div style="font-size:36px;margin-bottom:12px">✅</div>
        <div style="font-size:15px;font-weight:800;color:#e2e8f0">All Clear</div>
        <div style="font-size:12px;color:#475569;margin-top:6px">No threshold breaches detected across all wards</div>
      </div>`;
      return;
    }

    const TAGS = { critical: '🔴 CRITICAL', warning: '🟡 WARNING', report: '🔵 CITIZEN' };
    list.innerHTML = alerts.map((a, i) => `
      <div class="al-card" style="--ac:${a.color};animation-delay:${i * 0.04}s">
        <div class="al-card-strip" style="background:${a.color}"></div>
        <div class="al-card-body">
          <div class="al-card-top">
            <span class="al-card-tag" style="color:${a.color};border-color:${a.color}40;background:${a.color}15">${TAGS[a.type]}</span>
            <span class="al-card-time">${a.time}</span>
          </div>
          <div class="al-card-title">${a.title}</div>
          <div class="al-card-detail">${a.detail}</div>
          ${a.type !== 'report' ? `<div class="al-card-pills">
            <span class="al-pill">AQI ${a.aqi}</span>
            <span class="al-pill">PM2.5 ${a.pm25}</span>
            <span class="al-pill">NO₂ ${a.no2}</span>
          </div>` : ''}
        </div>
      </div>`).join('');
  }

  /* ==========================================
     LOAD REPORTS FROM SERVER
     ========================================== */
  async function loadExistingReports() {
    // Clear existing markers
    rs.markers.forEach(m => { if (rs.mainMap) rs.mainMap.removeLayer(m.marker); });
    rs.markers = [];

    try {
      const resp = await fetch(API_BASE + '/reports');
      const json = await resp.json();
      if (json.status === 'ok' && json.reports) {
        rs._reportsCache = json.reports;
        json.reports.forEach(r => addReportMarker(r));
      }
    } catch (err) {
      // Fallback: load from localStorage for offline
      const reports = JSON.parse(localStorage.getItem('aira_reports') || '[]');
      reports.forEach(r => {
        r.created_at = r.created_at || r.timestamp;
        addReportMarker(r);
      });
    }
  }

  /* ==========================================
     PUBLIC INIT — called from app.js
     ========================================== */
  window.initReports = function (map) {
    rs.mainMap = map;
    loadExistingReports();
    // Refresh report markers every 2 min (handles expiry + new reports)
    setInterval(loadExistingReports, 120000);
    // Refresh alert badge on load (ward data available by now)
    setTimeout(renderAlerts, 100);
  };

  window.renderAlerts = renderAlerts;

  /* ==========================================
     TOAST
     ========================================== */
  function showToast(msg, type) {
    let toast = document.getElementById('aira-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'aira-toast';
      document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.className   = `aira-toast ${type}`;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { toast.className = 'aira-toast'; }, 3200);
  }

  /* ==========================================
     HELPERS
     ========================================== */
  /** Ensure a datetime string from SQLite (UTC without Z) is treated as UTC */
  function utcStr(s) {
    if (!s) return s;
    return s.endsWith('Z') ? s : s + 'Z';
  }

  function getTimeAgo(date) {
    const mins = Math.floor((Date.now() - date) / 60000);
    if (mins < 1)  return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24)  return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  }

})();
