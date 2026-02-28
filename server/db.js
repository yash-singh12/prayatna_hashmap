/* ==========================================
   AIRA — SQLite Database Layer
   ==========================================
   Tables:
     stations  — AQICN station metadata
     readings  — per-station AQI snapshots (hourly)
     forecasts — 7-day forecast rows per station
     ward_aqi  — interpolated per-ward AQI
   ========================================== */

'use strict';

const Database = require('better-sqlite3');
const path     = require('path');

const DB_PATH = path.join(__dirname, 'aira.db');
let db;

/* ---------- INIT ---------- */
function init() {
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS stations (
      uid       INTEGER PRIMARY KEY,
      name      TEXT NOT NULL,
      lat       REAL NOT NULL,
      lon       REAL NOT NULL,
      url       TEXT,
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS readings (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      station_uid INTEGER NOT NULL,
      aqi         INTEGER,
      pm25        REAL,
      pm10        REAL,
      no2         REAL,
      o3          REAL,
      so2         REAL,
      co          REAL,
      temp        REAL,
      humidity    REAL,
      wind        REAL,
      pressure    REAL,
      dominant    TEXT,
      fetched_at  TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (station_uid) REFERENCES stations(uid)
    );

    CREATE TABLE IF NOT EXISTS forecasts (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      station_uid INTEGER NOT NULL,
      day         TEXT NOT NULL,
      pollutant   TEXT NOT NULL,
      avg         REAL,
      min         REAL,
      max         REAL,
      fetched_at  TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (station_uid) REFERENCES stations(uid)
    );

    CREATE TABLE IF NOT EXISTS ward_aqi (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      ward_name   TEXT NOT NULL,
      aqi         REAL,
      pm25        REAL,
      pm10        REAL,
      no2         REAL,
      o3          REAL,
      so2         REAL,
      co          REAL,
      dominant    TEXT,
      computed_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_readings_station  ON readings(station_uid, fetched_at);
    CREATE INDEX IF NOT EXISTS idx_forecasts_station  ON forecasts(station_uid, fetched_at);
    CREATE INDEX IF NOT EXISTS idx_ward_aqi_time      ON ward_aqi(computed_at);
    CREATE INDEX IF NOT EXISTS idx_ward_aqi_name      ON ward_aqi(ward_name, computed_at);

    CREATE TABLE IF NOT EXISTS reports (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      lat         REAL NOT NULL,
      lng         REAL NOT NULL,
      category    TEXT NOT NULL,
      description TEXT,
      media       TEXT,
      created_at  TEXT DEFAULT (datetime('now')),
      voter_uid   TEXT
    );

    CREATE TABLE IF NOT EXISTS report_votes (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      report_id   INTEGER NOT NULL,
      vote        TEXT NOT NULL CHECK(vote IN ('confirmed','false','unsure')),
      voter_uid   TEXT NOT NULL,
      lat         REAL,
      lng         REAL,
      voted_at    TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (report_id) REFERENCES reports(id),
      UNIQUE(report_id, voter_uid)
    );

    CREATE INDEX IF NOT EXISTS idx_reports_created   ON reports(created_at);
    CREATE INDEX IF NOT EXISTS idx_reports_category  ON reports(category);
    CREATE INDEX IF NOT EXISTS idx_report_votes_rid  ON report_votes(report_id);

    CREATE TABLE IF NOT EXISTS ward_aqi_history (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      ward_name  TEXT NOT NULL,
      aqi        REAL,
      cycle_at   TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_aqi_hist_ward ON ward_aqi_history(ward_name, cycle_at DESC);

    CREATE TABLE IF NOT EXISTS civic_events (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      ward_name  TEXT NOT NULL,
      event_type TEXT NOT NULL DEFAULT 'pollution_event',
      severity   TEXT NOT NULL DEFAULT 'warning',
      details    TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      expires_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_civic_events_ward ON civic_events(ward_name, created_at DESC);
  `);

  return db;
}

/* ---------- STATION UPSERT ---------- */
const upsertStation = () => db.prepare(`
  INSERT INTO stations (uid, name, lat, lon, url, updated_at)
  VALUES (@uid, @name, @lat, @lon, @url, datetime('now'))
  ON CONFLICT(uid) DO UPDATE SET
    name=excluded.name, lat=excluded.lat, lon=excluded.lon,
    url=excluded.url, updated_at=datetime('now')
`);

function saveStations(stations) {
  const stmt = upsertStation();
  const tx = db.transaction((list) => {
    for (const s of list) stmt.run(s);
  });
  tx(stations);
}

/* ---------- READING INSERT ---------- */
function saveReading(r) {
  db.prepare(`
    INSERT INTO readings (station_uid, aqi, pm25, pm10, no2, o3, so2, co, temp, humidity, wind, pressure, dominant)
    VALUES (@station_uid, @aqi, @pm25, @pm10, @no2, @o3, @so2, @co, @temp, @humidity, @wind, @pressure, @dominant)
  `).run(r);
}

function saveReadingsBatch(readings) {
  const stmt = db.prepare(`
    INSERT INTO readings (station_uid, aqi, pm25, pm10, no2, o3, so2, co, temp, humidity, wind, pressure, dominant)
    VALUES (@station_uid, @aqi, @pm25, @pm10, @no2, @o3, @so2, @co, @temp, @humidity, @wind, @pressure, @dominant)
  `);
  const tx = db.transaction((list) => {
    for (const r of list) stmt.run(r);
  });
  tx(readings);
}

/* ---------- FORECAST INSERT ---------- */
function saveForecasts(stationUid, forecasts) {
  // Delete old forecasts for this station
  db.prepare('DELETE FROM forecasts WHERE station_uid = ?').run(stationUid);
  const stmt = db.prepare(`
    INSERT INTO forecasts (station_uid, day, pollutant, avg, min, max)
    VALUES (@station_uid, @day, @pollutant, @avg, @min, @max)
  `);
  const tx = db.transaction((list) => {
    for (const f of list) stmt.run({ station_uid: stationUid, ...f });
  });
  tx(forecasts);
}

/* ---------- WARD AQI INSERT ---------- */
function saveWardAqi(wards) {
  const stmt = db.prepare(`
    INSERT INTO ward_aqi (ward_name, aqi, pm25, pm10, no2, o3, so2, co, dominant)
    VALUES (@ward_name, @aqi, @pm25, @pm10, @no2, @o3, @so2, @co, @dominant)
  `);
  const tx = db.transaction((list) => {
    for (const w of list) stmt.run(w);
  });
  tx(wards);
}

/* ---------- QUERIES ---------- */

/** Latest reading per station */
function getLatestReadings() {
  return db.prepare(`
    SELECT r.*, s.name AS station_name, s.lat, s.lon
    FROM readings r
    JOIN stations s ON s.uid = r.station_uid
    WHERE r.id IN (
      SELECT MAX(id) FROM readings GROUP BY station_uid
    )
    ORDER BY s.name
  `).all();
}

/** Latest ward AQI snapshot */
function getLatestWardAqi() {
  const latest = db.prepare(`SELECT MAX(computed_at) AS t FROM ward_aqi`).get();
  if (!latest || !latest.t) return [];
  return db.prepare(`SELECT * FROM ward_aqi WHERE computed_at = ?`).all(latest.t);
}

/** City-wide average from latest ward data */
function getCityAverage() {
  const wards = getLatestWardAqi();
  if (wards.length === 0) return null;
  const avg = (field) => {
    const vals = wards.map(w => w[field]).filter(v => v != null && !isNaN(v));
    return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
  };
  return {
    aqi: avg('aqi'), pm25: avg('pm25'), pm10: avg('pm10'),
    no2: avg('no2'), o3: avg('o3'), so2: avg('so2'), co: avg('co'),
    dominant: 'PM2.5', wardCount: wards.length
  };
}

/** Forecast for a station */
function getForecast(stationUid) {
  return db.prepare(`
    SELECT day, pollutant, avg, min, max FROM forecasts
    WHERE station_uid = ? ORDER BY day
  `).all(stationUid);
}

/** Historical ward AQI (for trend charts) */
function getWardHistory(wardName, days = 7) {
  return db.prepare(`
    SELECT ward_name, aqi, pm25, pm10, no2, o3, so2, co, dominant, computed_at
    FROM ward_aqi
    WHERE ward_name = ? AND computed_at >= datetime('now', '-' || ? || ' days')
    ORDER BY computed_at
  `).all(wardName, days);
}

/** All stations */
function getAllStations() {
  return db.prepare('SELECT * FROM stations ORDER BY name').all();
}

/** Station detail with latest reading */
function getStationDetail(uid) {
  const station = db.prepare('SELECT * FROM stations WHERE uid = ?').get(uid);
  const reading = db.prepare('SELECT * FROM readings WHERE station_uid = ? ORDER BY id DESC LIMIT 1').get(uid);
  const forecast = getForecast(uid);
  return { station, reading, forecast };
}

/** City average history for chart */
function getCityHistory(days = 7) {
  return db.prepare(`
    SELECT computed_at,
           ROUND(AVG(aqi))  AS aqi,
           ROUND(AVG(pm25)) AS pm25,
           ROUND(AVG(pm10)) AS pm10,
           ROUND(AVG(no2))  AS no2
    FROM ward_aqi
    WHERE computed_at >= datetime('now', '-' || ? || ' days')
    GROUP BY computed_at
    ORDER BY computed_at
  `).all(days);
}

/** Purge readings older than N days */
function purgeOldData(days = 30) {
  db.prepare(`DELETE FROM readings WHERE fetched_at < datetime('now', '-' || ? || ' days')`).run(days);
  db.prepare(`DELETE FROM ward_aqi WHERE computed_at < datetime('now', '-' || ? || ' days')`).run(days);
  db.prepare(`DELETE FROM ward_aqi_history WHERE cycle_at < datetime('now', '-2 hours')`).run();
  db.prepare(`DELETE FROM civic_events WHERE expires_at < datetime('now')`).run();
  // Purge old reports (>24h)
  db.prepare(`DELETE FROM report_votes WHERE report_id IN (SELECT id FROM reports WHERE created_at < datetime('now', '-1 day'))`).run();
  db.prepare(`DELETE FROM reports WHERE created_at < datetime('now', '-1 day')`).run();
}

/* ---------- WARD AQI HISTORY (trend tracking) ---------- */

/** Save a snapshot of all ward AQI values for trend detection */
function saveWardAqiHistory(wards) {
  const stmt = db.prepare(`INSERT INTO ward_aqi_history (ward_name, aqi) VALUES (?, ?)`);
  const tx = db.transaction((list) => {
    for (const w of list) stmt.run(w.ward_name, w.aqi);
  });
  tx(wards);
  // Prune old history (keep last 1 hour = ~12 cycles at 5-min interval)
  db.prepare(`DELETE FROM ward_aqi_history WHERE cycle_at < datetime('now', '-1 hour')`).run();
}

/** Get the last N history rows for a ward (most recent first) */
function getWardAqiHistory(wardName, limit = 3) {
  return db.prepare(`
    SELECT aqi, cycle_at FROM ward_aqi_history
    WHERE ward_name = ? ORDER BY cycle_at DESC LIMIT ?
  `).all(wardName, limit);
}

/** Get all ward names with their recent AQI snapshots */
function getAllWardTrends() {
  // Get last 3 distinct cycle timestamps
  const cycles = db.prepare(`
    SELECT DISTINCT cycle_at FROM ward_aqi_history ORDER BY cycle_at DESC LIMIT 3
  `).all().map(c => c.cycle_at);
  if (cycles.length === 0) return {};
  const rows = db.prepare(`
    SELECT ward_name, aqi, cycle_at FROM ward_aqi_history
    WHERE cycle_at IN (${cycles.map(() => '?').join(',')})
    ORDER BY ward_name, cycle_at DESC
  `).all(...cycles);
  const map = {};
  for (const r of rows) {
    if (!map[r.ward_name]) map[r.ward_name] = [];
    map[r.ward_name].push(r.aqi);
  }
  return map;
}

/* ---------- CIVIC EVENTS ---------- */

function saveCivicEvent(wardName, severity, details, expiresInHours = 1) {
  db.prepare(`
    INSERT INTO civic_events (ward_name, severity, details, expires_at)
    VALUES (?, ?, ?, datetime('now', '+' || ? || ' hours'))
  `).run(wardName, severity, details, expiresInHours);
}

function getActiveCivicEvents() {
  return db.prepare(`
    SELECT * FROM civic_events WHERE expires_at > datetime('now') ORDER BY created_at DESC
  `).all();
}

function getWardCivicEvents(wardName) {
  return db.prepare(`
    SELECT * FROM civic_events WHERE ward_name = ? AND expires_at > datetime('now') ORDER BY created_at DESC
  `).all(wardName);
}

/* ---------- REPORT EXPIRY DURATIONS (hours) ---------- */
const REPORT_EXPIRY = {
  burning:    2,
  vehicle:    2,
  industrial: 6,
  construction: 6,
  other:      3
};

const POLL_WINDOW_MINUTES = 12; // Poll available for ~12 min after report creation

/* ---------- REPORTS ---------- */
function saveReport(r) {
  const stmt = db.prepare(`
    INSERT INTO reports (lat, lng, category, description, media, voter_uid)
    VALUES (@lat, @lng, @category, @description, @media, @voter_uid)
  `);
  const info = stmt.run(r);
  return info.lastInsertRowid;
}

/** Get active (non-expired) reports */
function getActiveReports() {
  const all = db.prepare(`SELECT * FROM reports ORDER BY created_at DESC`).all();
  const now = Date.now();
  return all.filter(r => {
    const expiryHours = REPORT_EXPIRY[r.category] || 3;
    const created = new Date(r.created_at + 'Z').getTime();
    return (now - created) < expiryHours * 3600000;
  });
}

function getReportById(id) {
  return db.prepare(`SELECT * FROM reports WHERE id = ?`).get(id);
}

/* ---------- VOTES ---------- */
function addVote(reportId, voterUid, vote, lat, lng) {
  const stmt = db.prepare(`
    INSERT INTO report_votes (report_id, vote, voter_uid, lat, lng)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(report_id, voter_uid) DO UPDATE SET vote=excluded.vote, voted_at=datetime('now')
  `);
  stmt.run(reportId, vote, voterUid, lat, lng);
}

function getVotesForReport(reportId) {
  return db.prepare(`SELECT vote, COUNT(*) as cnt FROM report_votes WHERE report_id = ? GROUP BY vote`).all(reportId);
}

/** Confidence score: 0–100 based on votes + nearby similar reports */
function getReportConfidence(reportId) {
  const report = getReportById(reportId);
  if (!report) return { score: 0, label: 'Unknown', votes: {} };

  // 1. Tally votes
  const voteRows = getVotesForReport(reportId);
  const votes = { confirmed: 0, false: 0, unsure: 0 };
  voteRows.forEach(v => { votes[v.vote] = v.cnt; });
  const totalVotes = votes.confirmed + votes.false + votes.unsure;

  // 2. Count nearby similar reports (same category, within ~2km, last few hours)
  const expiryHours = REPORT_EXPIRY[report.category] || 3;
  const nearby = db.prepare(`
    SELECT COUNT(*) as cnt FROM reports
    WHERE id != ? AND category = ?
      AND ABS(lat - ?) < 0.02 AND ABS(lng - ?) < 0.02
      AND created_at >= datetime('now', '-' || ? || ' hours')
  `).get(reportId, report.category, report.lat, report.lng, expiryHours);
  const nearbyCount = nearby ? nearby.cnt : 0;

  // 3. Calculate score
  let score = 50; // base
  if (totalVotes > 0) {
    const voteSignal = ((votes.confirmed - votes.false) / totalVotes) * 35;
    score += voteSignal;
  }
  // Nearby reports boost (up to +15)
  score += Math.min(nearbyCount * 5, 15);
  // Unsure votes slightly reduce confidence
  if (totalVotes > 0) {
    score -= (votes.unsure / totalVotes) * 5;
  }
  score = Math.max(0, Math.min(100, Math.round(score)));

  let label = 'Low';
  if (score >= 75) label = 'High';
  else if (score >= 50) label = 'Medium';

  return { score, label, votes, nearbyCount, totalVotes };
}

/** Check if poll is still open for a report */
function isPollOpen(report) {
  const created = new Date(report.created_at + 'Z').getTime();
  return (Date.now() - created) < POLL_WINDOW_MINUTES * 60000;
}

/** Check if report is still active (not expired) */
function isReportActive(report) {
  const expiryHours = REPORT_EXPIRY[report.category] || 3;
  const created = new Date(report.created_at + 'Z').getTime();
  return (Date.now() - created) < expiryHours * 3600000;
}

module.exports = {
  init,
  saveStations,
  saveReading,
  saveReadingsBatch,
  saveForecasts,
  saveWardAqi,
  getLatestReadings,
  getLatestWardAqi,
  getCityAverage,
  getForecast,
  getWardHistory,
  getAllStations,
  getStationDetail,
  getCityHistory,
  purgeOldData,
  saveReport,
  getActiveReports,
  getReportById,
  addVote,
  getVotesForReport,
  getReportConfidence,
  isPollOpen,
  isReportActive,
  REPORT_EXPIRY,
  POLL_WINDOW_MINUTES,
  // Civic monitoring
  saveWardAqiHistory,
  getWardAqiHistory,
  getAllWardTrends,
  saveCivicEvent,
  getActiveCivicEvents,
  getWardCivicEvents
};
