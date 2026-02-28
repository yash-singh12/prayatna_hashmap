/* ==========================================
   AIRA — AQICN Data Fetcher
   ==========================================
   Periodically fetches live AQI data from
   AQICN's WAQI API for Delhi NCR stations.

   Endpoints used:
     /v2/map/bounds  — all stations in bbox
     /feed/@{uid}    — detailed station feed
   ========================================== */

'use strict';

const fetch          = require('node-fetch');
const db             = require('./db');
const { interpolateWards } = require('./interpolation');

const API_TOKEN = 'b584b150e750a7e27dbcffb9cea73ae408dc7622';

// Delhi NCR bounding box [N_lat, W_lng, S_lat, E_lng]
const DELHI_BOUNDS = { N: 28.88, W: 76.84, S: 28.40, E: 77.35 };

const BOUNDS_URL = `https://api.waqi.info/v2/map/bounds/?latlng=${DELHI_BOUNDS.N},${DELHI_BOUNDS.W},${DELHI_BOUNDS.S},${DELHI_BOUNDS.E}&token=${API_TOKEN}`;
const FEED_URL   = (uid) => `https://api.waqi.info/feed/@${uid}/?token=${API_TOKEN}`;

// Listener list for SSE (Server-Sent Events)
let sseClients = [];

function addSSEClient(res) { sseClients.push(res); }
function removeSSEClient(res) { sseClients = sseClients.filter(c => c !== res); }
function broadcast(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  sseClients.forEach(res => {
    try { res.write(payload); } catch (_) { /* client gone */ }
  });
}

/* ---------- FETCH ALL STATIONS IN BOUNDS ---------- */
async function fetchStations() {
  try {
    console.log('[Fetcher] Fetching stations from map/bounds...');
    const resp = await fetch(BOUNDS_URL);
    const json = await resp.json();

    if (json.status !== 'ok' || !Array.isArray(json.data)) {
      console.error('[Fetcher] Bad bounds response:', json);
      return [];
    }

    // Filter out offline stations (aqi === "-")
    const stations = json.data
      .filter(s => s.aqi !== '-' && !isNaN(Number(s.aqi)))
      .map(s => ({
        uid:  s.uid,
        name: s.station?.name || 'Unknown',
        lat:  s.lat,
        lon:  s.lon,
        url:  s.station?.name || '',
        aqi:  Number(s.aqi)
      }));

    console.log(`[Fetcher] Got ${stations.length} online stations (${json.data.length} total)`);
    return stations;
  } catch (err) {
    console.error('[Fetcher] Station fetch error:', err.message);
    return [];
  }
}

/* ---------- FETCH DETAILED DATA FOR ONE STATION ---------- */
async function fetchStationFeed(uid) {
  try {
    const resp = await fetch(FEED_URL(uid));
    const json = await resp.json();

    if (json.status !== 'ok' || !json.data) return null;

    const d   = json.data;
    const iaqi = d.iaqi || {};
    const val  = (key) => iaqi[key]?.v ?? null;

    return {
      uid,
      aqi:      d.aqi,
      pm25:     val('pm25'),
      pm10:     val('pm10'),
      no2:      val('no2'),
      o3:       val('o3'),
      so2:      val('so2'),
      co:       val('co'),
      temp:     val('t'),
      humidity: val('h'),
      wind:     val('w'),
      pressure: val('p'),
      dominant: d.dominentpol || null,
      forecast: d.forecast?.daily || null,
      time:     d.time?.iso || null
    };
  } catch (err) {
    console.error(`[Fetcher] Feed error (uid ${uid}):`, err.message);
    return null;
  }
}

/* ---------- FULL FETCH CYCLE ---------- */
async function runFetchCycle() {
  const start = Date.now();
  console.log('\n[Fetcher] === Starting fetch cycle ===');

  // 1. Get station list
  const stations = await fetchStations();
  if (stations.length === 0) {
    console.warn('[Fetcher] No stations — skipping cycle');
    return;
  }

  // Save station metadata
  db.saveStations(stations);

  // 2. Fetch detailed data for each station (with rate limiting)
  const detailedStations = [];
  const readings = [];

  for (const s of stations) {
    const feed = await fetchStationFeed(s.uid);
    if (!feed) continue;

    detailedStations.push({
      uid:      s.uid,
      lat:      s.lat,
      lon:      s.lon,
      name:     s.name,
      aqi:      feed.aqi,
      pm25:     feed.pm25,
      pm10:     feed.pm10,
      no2:      feed.no2,
      o3:       feed.o3,
      so2:      feed.so2,
      co:       feed.co,
      dominant: feed.dominant
    });

    readings.push({
      station_uid: s.uid,
      aqi:         feed.aqi,
      pm25:        feed.pm25,
      pm10:        feed.pm10,
      no2:         feed.no2,
      o3:          feed.o3,
      so2:         feed.so2,
      co:          feed.co,
      temp:        feed.temp,
      humidity:    feed.humidity,
      wind:        feed.wind,
      pressure:    feed.pressure,
      dominant:    feed.dominant
    });

    // Save forecasts if available
    if (feed.forecast) {
      const forecastRows = [];
      for (const [pollutant, days] of Object.entries(feed.forecast)) {
        if (!Array.isArray(days)) continue;
        for (const day of days) {
          forecastRows.push({
            day:       day.day,
            pollutant: pollutant,
            avg:       day.avg,
            min:       day.min,
            max:       day.max
          });
        }
      }
      if (forecastRows.length > 0) {
        db.saveForecasts(s.uid, forecastRows);
      }
    }

    // Small delay to avoid API rate limits (250ms between requests)
    await sleep(250);
  }

  // 3. Save readings in batch
  if (readings.length > 0) {
    db.saveReadingsBatch(readings);
    console.log(`[Fetcher] Saved ${readings.length} station readings`);
  }

  // 4. Run IDW interpolation → ward AQI
  if (detailedStations.length > 0) {
    const wardAqi = interpolateWards(detailedStations);
    if (wardAqi.length > 0) {
      db.saveWardAqi(wardAqi);
      // Save history snapshot for trend tracking
      db.saveWardAqiHistory(wardAqi);
      // 5. Broadcast to SSE clients
      broadcast('ward-update', {
        wards: wardAqi,
        stations: detailedStations.map(s => ({
          uid: s.uid, name: s.name, lat: s.lat, lon: s.lon,
          aqi: s.aqi, dominant: s.dominant
        })),
        timestamp: new Date().toISOString()
      });
    }
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`[Fetcher] === Cycle complete in ${elapsed}s ===\n`);
}

/* ---------- SCHEDULER ---------- */
let fetchInterval = null;

function startScheduler(intervalMs = 5 * 60 * 1000) {
  console.log(`[Fetcher] Scheduler: every ${intervalMs / 1000}s`);

  // Run immediately on start
  runFetchCycle().catch(err => console.error('[Fetcher] Cycle error:', err));

  // Then repeat
  fetchInterval = setInterval(() => {
    runFetchCycle().catch(err => console.error('[Fetcher] Cycle error:', err));
  }, intervalMs);
}

function stopScheduler() {
  if (fetchInterval) {
    clearInterval(fetchInterval);
    fetchInterval = null;
  }
}

/* ---------- UTIL ---------- */
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/* ---------- EXPORT ---------- */
module.exports = {
  fetchStations,
  fetchStationFeed,
  runFetchCycle,
  startScheduler,
  stopScheduler,
  addSSEClient,
  removeSSEClient
};
