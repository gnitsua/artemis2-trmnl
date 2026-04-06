# Artemis II TRMNL Plugin

Tracks the Artemis II spacecraft position on a [TRMNL](https://usetrmnl.com) e-ink display. Shows a 2D map with Earth, Moon, and Orion's current position projected onto the Earth-Moon plane, plus distance stats.

<img width="812" height="491" alt="image" src="https://github.com/user-attachments/assets/79560b59-37aa-4f0e-a7e6-82b147a4c328" />

## How it works

1. A GitHub Actions cron job runs `update.js` every 15 minutes
2. `update.js` fetches the last 24 hours of Artemis II and Moon positions from the [JPL Horizons API](https://ssd.jpl.nasa.gov/horizons/) at 15-minute intervals
3. It projects the 3D ECI coordinates onto the Earth-Moon plane, computes distances, and generates a trail
4. It writes the result to `data/position.json` and commits it to the repo
5. TRMNL polls the raw GitHub URL for the JSON and renders the plugin template as a PNG

Position data is available at:

```
https://raw.githubusercontent.com/gnitsua/artemis2-trmnl/mainline/data/position.json
```

## Layouts

| Liquid Template              | TRMNL Layout    | Size    | Description                          |
| ---------------------------- | --------------- | ------- | ------------------------------------ |
| `src/full.liquid`            | Full            | 800x480 | Side-by-side map and stats           |
| `src/half_vertical.liquid`   | Half Vertical   | 400x480 | Stacked map with compact stats below |
| `src/half_horizontal.liquid` | Half Horizontal | 800x240 | Side-by-side map and stats, compact  |
| `src/quadrant.liquid`        | Quadrant        | 400x240 | Minimal map with small stats         |

Legacy HTML templates (`plugin*.html`) are also included for the TRMNL markup editor.

## Local development

Preview all layouts locally using [trmnlp](https://github.com/usetrmnl/trmnlp):

```bash
# Start a local HTTP server to serve position data (in a separate terminal)
python3 -m http.server 8080

# Start the trmnlp dev server
./bin/dev
```

Then open http://localhost:4567. Use the layout tabs (Full, Half Horizontal, Half Vertical, Quadrant) to preview each view. Click **Poll** to fetch the latest position data.

The trmnlp server renders the Liquid templates in `src/` with data from the polling URL configured in `src/settings.yml`. For local development this points to `http://host.docker.internal:8080/data/position.json`.

To update position data locally:

```bash
node update.js
```

### Regenerating test trajectory data

The full mission trajectory (from ephemeris files) can be regenerated for testing:

```bash
node generate_test_data.js
```

This produces `test_frames.json` with 1849 frames covering ~154 hours from TLI to return.

## Setup

### 1. Create a TRMNL private plugin

1. Go to [usetrmnl.com](https://usetrmnl.com) and create a private plugin
2. Set the polling URL to the raw `data/position.json` URL above
3. Paste the contents of each `plugin*.html` file into the corresponding markup editor

### 2. Fork and enable Actions

Fork this repo and enable GitHub Actions. The cron runs automatically every 15 minutes. You can also trigger it manually from the Actions tab.

No secrets or API keys are needed — the workflow fetches from the public JPL Horizons API and commits the result to the repo.

## Data source

Position vectors come from [JPL Horizons](https://ssd.jpl.nasa.gov/horizons/) using:

- **`-1024`** — Artemis II / Orion spacecraft
- **`301`** — Moon

Both queried relative to Earth center (`500@399`). The 3D positions are projected onto the Earth-Moon plane for 2D display, with Earth fixed at the bottom and Moon positioned dynamically on the same vertical scale. A minimum separation is enforced so the capsule doesn't visually overlap the Moon during close approach.
