# 🔥 Cambodia Wildfire Monitor

**ប្រព័ន្ធតាមដានភ្លើងព្រៃកម្ពុជា**

Near-real-time wildfire and hotspot monitoring for Cambodia using NASA FIRMS satellite data.

![Screenshot](screenshot.png)

---

## How It Works

```
┌─────────────────────────────────────────────────────────┐
│                   GitHub Actions (every 6h)              │
│                                                         │
│  1. Fetch fire data from NASA FIRMS API                 │
│  2. Enrich with province + protected area info          │
│  3. Write JSON to data/                                 │
│  4. Commit & push                                       │
└──────────────────────┬──────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────┐
│                   GitHub Pages (static site)             │
│                                                         │
│  index.html loads data/*.json via fetch()               │
│  Leaflet.js renders fires on a dark map                 │
│  Summary panel shows stats & top provinces              │
└─────────────────────────────────────────────────────────┘
```

**No backend server. No database.** Just a Python scraper on a cron schedule writing static JSON files, served by GitHub Pages.

---

## Data Sources

| Source | Description | Link |
|--------|-------------|------|
| **NASA FIRMS** | Active fire/hotspot detections from VIIRS & MODIS satellites | [firms.modaps.eosdis.nasa.gov](https://firms.modaps.eosdis.nasa.gov/) |
| **GADM** | Cambodia administrative boundaries (provinces) | [gadm.org](https://gadm.org/) |
| **WDPA** | World Database on Protected Areas | [protectedplanet.net](https://www.protectedplanet.net/) |

---

## Features

- Interactive dark-themed map centered on Cambodia
- Fire markers colored by age (red = last 24h, orange = last 48h)
- Marker size scaled by fire radiative power (FRP)
- Province and protected area boundary overlays (toggleable)
- Filter: all fires, protected areas only, high confidence only
- Summary panel with total fires, protected area alerts, top provinces
- Fully responsive — works on mobile
- Khmer subtitle in the header

---

## Run the Scraper Locally

```bash
# Clone the repo
git clone https://github.com/YOUR_USERNAME/cambodia-wildfire-monitor.git
cd cambodia-wildfire-monitor

# Install Python dependencies
pip install -r scraper/requirements.txt

# Run with demo key (rate-limited)
python scraper/scrape.py

# Or with your own FIRMS API key
FIRMS_MAP_KEY=your_key_here python scraper/scrape.py
```

Get a free FIRMS API key at: https://firms.modaps.eosdis.nasa.gov/api/area/

---

## Deploy Your Own

1. **Fork** this repository
2. Go to **Settings → Secrets and variables → Actions**
3. Add a secret: `FIRMS_MAP_KEY` = your NASA FIRMS API key
4. Go to **Settings → Pages** and enable GitHub Pages (deploy from `main` branch, root `/`)
5. The scraper runs automatically every 6 hours via GitHub Actions
6. You can also trigger it manually from the **Actions** tab

---

## Project Structure

```
├── index.html              # Main page
├── css/style.css           # Styles
├── js/app.js               # Frontend logic
├── data/
│   ├── fires_latest.json   # Latest fire detections (auto-updated)
│   ├── summary.json        # Summary statistics (auto-updated)
│   └── geo/
│       ├── cambodia_provinces.geojson
│       └── cambodia_protected_areas.geojson
├── scraper/
│   ├── scrape.py           # NASA FIRMS data scraper
│   └── requirements.txt
├── .github/workflows/
│   └── scrape.yml          # GitHub Actions workflow
├── README.md
└── LICENSE
```

---

## GeoJSON Data Note

The province and protected area GeoJSON files included are **simplified approximations** for development purposes. For production use, download the official data:

- **Provinces**: [GADM Cambodia Level 1](https://gadm.org/download_country.html) — select Cambodia, Level 1
- **Protected Areas**: [WDPA](https://www.protectedplanet.net/country/KHM) — download Cambodia protected areas

Replace the files in `data/geo/` with the official versions for accurate boundaries.

---

## License

MIT — see [LICENSE](LICENSE)

---

## Credits

- **NASA FIRMS** for fire detection data
- **GADM** for administrative boundary data
- **WDPA / Protected Planet** for protected area data
- **Leaflet.js** for the mapping library
- **CARTO** for dark map tiles
