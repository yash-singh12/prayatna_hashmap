# AIRA — Air Quality Dashboard for Delhi

A real-time air quality monitoring and citizen reporting platform for Delhi NCR, powered by AQICN data and AI-driven recommendations.

## Features

- **Live AQI Data**: Real-time air quality readings from AQICN API (100+ stations)
- **Ward-Level Insights**: Interpolated AQI per ward with trend analysis
- **Citizen Reports**: Community-driven pollution incident reporting with confidence scoring
- **AI Recommendations**: AI-powered mitigation advice using Google Gemini API
- **Civic Dashboard**: Municipality-focused actionable directives for pollution control
- **SSE Real-Time Updates**: Server-sent events for live data streaming
- **Progressive Web App**: Offline-capable mobile-first interface

---

## Tech Stack

**Frontend:**
- HTML5 / CSS3 / Vanilla JavaScript
- Service Worker for offline support
- Mapbox GL (maps & geospatial visualization)
- Responsive design for mobile/tablet/desktop

**Backend:**
- Node.js + Express
- SQLite (better-sqlite3) for persistence
- AQICN WAQI API integration
- Google Generative AI (Gemini) for recommendations

---

## Installation & Setup

### Prerequisites
- Node.js 16+ 
- npm or yarn
- Google Gemini API key (free tier available at [aistudio.google.com](https://aistudio.google.com/app/apikey))

### Development Setup

1. **Clone & Install**
```bash
cd prayatna_hashmap
npm install
cd server && npm install && cd ..
```

2. **Configure Environment**
```bash
cd server
cp .env.example .env
# Edit .env and set GEMINI_API_KEY
```

3. **Start Server**
```bash
cd server
npm start
# or for development with auto-reload:
npm run dev
```

4. **Access Application**
- Frontend: `http://localhost:3000`
- API: `http://localhost:3000/api`

---

## Production Deployment

### Environment Configuration

Copy `.env.example` to `.env` and configure for production:

```bash
cp server/.env.example server/.env
# Edit server/.env with production values:
```

**Critical .env Variables:**

| Variable | Required | Example | Notes |
|----------|----------|---------|-------|
| `NODE_ENV` | Yes | `production` | Always use `production` in live |
| `GEMINI_API_KEY` | **Yes** | `AIza...` | Get from [aistudio.google.com](https://aistudio.google.com/app/apikey). Server won't start without it |
| `PORT` | No | `3000` | Default: 3000. Change if port is in use |
| `ALLOWED_ORIGINS` | Yes | `https://yourdomain.com` | CORS whitelist. For multiple origins: `https://yourdomain.com,https://www.yourdomain.com` |
| `DATABASE_PATH` | No | `/var/lib/aira/aira.db` | Absolute path recommended for production. Ensure directory is writable |
| `ENABLE_PURGE` | No | `true` | Enable automatic cleanup of data >30 days old. Disable in dev |
| `FETCH_INTERVAL` | No | `300000` | How often to fetch AQICN data (in ms). Default: 5 min |

### Docker Deployment (Recommended)

**Dockerfile:**
```dockerfile
FROM node:18-alpine

WORKDIR /app

# Copy frontend files
COPY . .

# Install and build server
WORKDIR /app/server
RUN npm install --production

ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "index.js"]
```

**Build & Run:**
```bash
docker build -t aira-dashboard .
docker run -p 3000:3000 \
  -e NODE_ENV=production \
  -e GEMINI_API_KEY=YOUR_KEY \
  -e ALLOWED_ORIGINS=https://yourdomain.com \
  -e DATABASE_PATH=/data/aira.db \
  -v aira-data:/data \
  aira-dashboard
```

### Manual Server Deployment

1. **SSH into Server**
```bash
ssh user@your-server.com
```

2. **Clone Repository**
```bash
cd /app
git clone <repo-url> aira
cd aira/server
npm install --production
```

3. **Create .env**
```bash
cp .env.example .env
nano .env
# Set GEMINI_API_KEY and ALLOWED_ORIGINS
```

4. **Run with PM2** (keeps app running)
```bash
npm install -g pm2
pm2 start index.js --name "aira" --watch
pm2 save
pm2 startup
```

5. **Nginx Reverse Proxy** (recommended)
```nginx
server {
    listen 80;
    server_name yourdomain.com;
    
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
    
    # SSE heartbeat
    proxy_connect_timeout 7d;
    proxy_send_timeout 7d;
    proxy_read_timeout 7d;
}
```

6. **Enable HTTPS** (Let's Encrypt)
```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d yourdomain.com
```

---

## API Endpoints

### Public Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/wards` | GET | Latest AQI per ward |
| `/api/city` | GET | City average AQI |
| `/api/stations` | GET | All AQICN stations + readings |
| `/api/station/:uid` | GET | Single station detail |
| `/api/forecast/:uid` | GET | 7-day forecast |
| `/api/events` | GET | SSE stream for real-time updates |
| `/api/recommendations?ward=WARD_NAME` | GET | AI recommendations for a ward |
| `/api/reports` | GET | All active citizen reports |
| `/api/reports` | POST | Submit new report |
| `/api/reports/:id/vote` | POST | Vote on report (confirmed/false/unsure) |

### Civic API (Municipality)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/civic/ward-summary` | GET | Risk scores & hotspots per ward |
| `/api/civic/hotspots` | GET | Critical pollution hotspot alerts |
| `/api/civic/recommendations?ward=WARD_NAME` | GET | AI municipal mitigation directives |
| `/api/civic/timeline` | GET | Recent report activity |

---

## Performance & Scaling

### Database Optimization
- WAL mode enabled for SQLite (concurrent reads)
- Indexes on frequently queried columns
- Data purge: automatic cleanup of records >30 days (configurable)

### Caching
- In-memory recommendation cache (5-minute TTL)
- SSE broadcasts to minimize API calls
- AQICN fetch interval: 5 minutes (default)

### Recommendations for Large Deployment
- Use PostgreSQL instead of SQLite (change in `db.js`)
- Add Redis for session/cache management
- Deploy multiple server instances behind load balancer
- Use CDN for static frontend assets

---

## Troubleshooting

### Server won't start
**Error:** `FATAL: Missing required environment variables: GEMINI_API_KEY`
```
Solution: Set GEMINI_API_KEY in .env file
```

### CORS errors in browser
**Error:** `Access to XMLHttpRequest blocked by CORS policy`
```
Solution: Add your frontend domain to ALLOWED_ORIGINS in .env
Example: ALLOWED_ORIGINS=https://yourdomain.com,https://app.yourdomain.com
```

### Database locked error
```
Solution: Ensure only one server process is running
Kill any stray processes: killall node
```

### Slow API responses
```
Solutions:
- Increase FETCH_INTERVAL (server is overloaded)
- Check database size: du -h server/aira.db
- Enable purge loop: ENABLE_PURGE=true
```

### SSE (real-time updates) not working
```
Check Nginx timeout configs — SSE needs long-lived connections
Ensure proxy_read_timeout is >= 7d
```

---

## Development

### Project Structure
```
prayatna_hashmap/
├── index.html           # Main app
├── app.js              # Frontend logic
├── civic.html          # Civic dashboard
├── civic.js            # Civic logic
├── reporter.js         # Report submission UI
├── style.css           # Frontend styles
├── sw.js               # Service Worker (offline)
├── server/
│   ├── index.js        # Express server
│   ├── db.js           # SQLite layer
│   ├── fetcher.js      # AQICN API client
│   ├── interpolation.js # Ward AQI calculation
│   ├── routes/
│   │   └── api.js      # All API endpoints
│   ├── .env            # Configuration
│   └── package.json
```

### Adding New Features

1. **New API Endpoint**: Add route in `server/routes/api.js`
2. **Database Changes**: Update schema in `server/db.js`
3. **Frontend**: Update `app.js`, `civic.js`, or `reporter.js`
4. **Styling**: Edit `style.css` or `civic.css`

### Testing
```bash
# Start server
cd server && npm run dev

# In another terminal, test API
curl http://localhost:3000/api/wards
curl http://localhost:3000/api/city
```

---

## Contributing

1. Create a feature branch: `git checkout -b feature/my-improvement`
2. Make changes and test locally
3. Commit with clear messages: `git commit -am "Add feature X"`
4. Push: `git push origin feature/my-improvement`
5. Open a Pull Request

---

## License

This project is part of EcoTrack. Check LICENSE file for details.

---

## Support & Feedback

For issues, questions, or feature requests:
- Open an issue on GitHub
- Contact: [your-email or contact info]

---

**Last Updated:** March 2026  
**Version:** 1.0.0
