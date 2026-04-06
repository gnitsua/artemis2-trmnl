# Artemis II TRMNL Plugin

Tracks the Artemis II spacecraft position on a [TRMNL](https://usetrmnl.com) e-ink display. Shows a 2D map with Earth, Moon, and Orion's current position projected onto the Earth-Moon plane, plus distance stats.

<img width="660" height="395" alt="image" src="https://github.com/user-attachments/assets/eddb9cf2-534e-4f6d-a1c1-2b64b3f69675" />



## How it works

1. A GitHub Actions cron job runs `update.js` every 15 minutes
2. `update.js` fetches Artemis II and Moon positions from the [JPL Horizons API](https://ssd.jpl.nasa.gov/horizons/)
3. It projects the 3D ECI coordinates onto the Earth-Moon plane and computes distances
4. It writes the result to `data/position.json` and commits it to the repo
5. TRMNL polls the raw GitHub URL for the JSON and renders the plugin template as a PNG

Position data is available at:

```
https://raw.githubusercontent.com/gnitsua/artemis2-trmnl/mainline/data/position.json
```

## Layouts

| File                          | TRMNL Layout    | Size    | Description                          |
| ----------------------------- | --------------- | ------- | ------------------------------------ |
| `plugin.html`                 | Full            | 800x480 | Side-by-side map and stats           |
| `plugin_half_vertical.html`   | Half Vertical   | 400x480 | Stacked map with compact stats below |
| `plugin_half_horizontal.html` | Half Horizontal | 800x240 | Side-by-side map and stats, compact  |
| `plugin_quadrant.html`        | Quadrant        | 400x240 | Minimal map with small stats         |

## Setup

### 1. Create a TRMNL private plugin

1. Go to [usetrmnl.com](https://usetrmnl.com) and create a private plugin
2. Set the polling URL to the raw `data/position.json` URL above
3. Paste `plugin.html` into the full-screen markup editor
4. Paste `plugin_half_vertical.html` into the half vertical markup editor

### 2. Fork and enable Actions

Fork this repo and enable GitHub Actions. The cron runs automatically every 15 minutes. You can also trigger it manually from the Actions tab.

No secrets or API keys are needed — the workflow fetches from the public JPL Horizons API and commits the result to the repo.

## Local testing

```bash
node update.js
```

Fetches current positions from JPL Horizons and writes `data/position.json`.

## Data source

Position vectors come from [JPL Horizons](https://ssd.jpl.nasa.gov/horizons/) using:

- **`-1024`** — Artemis II / Orion spacecraft
- **`301`** — Moon

Both queried relative to Earth center (`500@399`). The 3D positions are projected onto the Earth-Moon plane for 2D display, with Earth fixed at the bottom and Moon at the top.
