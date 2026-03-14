/* ==========================================
   AIRA — Express Server Entry Point
   ==========================================
   - Serves frontend static files
   - Mounts REST API at /api
   - Starts AQICN data fetch scheduler
   - Purges old data daily
   ========================================== */

'use strict';

require('dotenv').config();

const express  = require('express');
const cors     = require('cors');
const path     = require('path');
const db       = require('./db');
const fetcher  = require('./fetcher');
const apiRoute = require('./routes/api');

/* ---------- ENVIRONMENT VALIDATION ---------- */
const requiredEnvVars = ['GEMINI_API_KEY'];
const missingVars = requiredEnvVars.filter(v => !process.env[v]);
if (missingVars.length > 0) {
  console.error(`[Server] FATAL: Missing required environment variables: ${missingVars.join(', ')}`);
  console.error('[Server] Please create .env file with required variables. See .env.example for template.');
  process.exit(1);
}

const PORT          = process.env.PORT || 3000;
const NODE_ENV      = process.env.NODE_ENV || 'development';
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'http://localhost:' + PORT).split(',').map(o => o.trim());
const FETCH_INTERVAL = parseInt(process.env.FETCH_INTERVAL || '300000');   // 5 minutes (in ms)
const PURGE_INTERVAL = parseInt(process.env.PURGE_INTERVAL || '2592000000'); // 30 days (in ms)
const ENABLE_PURGE   = process.env.ENABLE_PURGE === 'true'; // Disabled by default

const app = express();

/* ---------- MIDDLEWARE ---------- */
// Secure CORS: only allow specified origins
app.use(cors({
  origin: function (origin, callback) {
    if (!origin || ALLOWED_ORIGINS.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('CORS not allowed'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type']
}));
app.use(express.json({ limit: '20mb' }));

if (NODE_ENV === 'development') {
  console.log('[Server] Running in DEVELOPMENT mode');
  console.log('[Server] Allowed origins:', ALLOWED_ORIGINS);
}

/* ---------- STATIC FILES (frontend) ---------- */
const frontendDir = path.join(__dirname, '..');
app.use(express.static(frontendDir));

/* ---------- API ROUTES ---------- */
app.use('/api', apiRoute);

/* ---------- FALLBACK → index.html ---------- */
app.get('*', (req, res) => {
  // Only for non-API routes
  if (!req.path.startsWith('/api')) {
    res.sendFile(path.join(frontendDir, 'index.html'));
  }
});

/* ---------- START ---------- */
function start() {
  // 1. Init database
  db.init();
  console.log('[Server] Database initialized');

  // 2. Start Express
  app.listen(PORT, () => {
    console.log(`[Server] AIRA backend running at http://localhost:${PORT}`);
    console.log(`[Server] API available at http://localhost:${PORT}/api`);
    console.log(`[Server] Frontend served from ${frontendDir}`);
  });

  // 3. Start AQICN fetch scheduler
  fetcher.startScheduler(FETCH_INTERVAL);

  // 4. Daily purge of old data (keep 30 days) — only if enabled via env
  if (ENABLE_PURGE) {
    setInterval(() => {
      try {
        db.purgeOldData(30);
        console.log('[Server] Old data purged (>30 days)');
      } catch (err) {
        console.error('[Server] Purge error:', err.message);
      }
    }, PURGE_INTERVAL);
    console.log('[Server] Data purge loop enabled');
  } else {
    console.log('[Server] Data purge loop disabled (set ENABLE_PURGE=true to enable)');
  }
}

start();
