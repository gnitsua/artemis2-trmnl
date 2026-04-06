# Artemis II TRMNL Plugin

Tracks the Artemis II spacecraft position on a [TRMNL](https://usetrmnl.com) e-ink display. Shows a 2D map with Earth, Moon, and Orion's current position, plus distance and speed stats.

## How it works

1. A GitHub Actions cron job runs `update.js` every 15 minutes
2. `update.js` fetches Artemis II and Moon positions from the [JPL Horizons API](https://ssd.jpl.nasa.gov/horizons/)
3. It projects the 3D coordinates onto the Earth-Moon plane and computes distances/speed
4. It pushes the computed values to the TRMNL webhook as `merge_variables`
5. TRMNL renders `plugin.html` with those variables and sends a PNG to your device

## Setup

### 1. Create a TRMNL private plugin

1. Go to [usetrmnl.com](https://usetrmnl.com) and create a private plugin
2. Paste the contents of `plugin.html` into the plugin markup editor
3. Note the **Plugin UUID** from the plugin settings

### 2. Configure GitHub secrets

Add these secrets to your GitHub repo (Settings > Secrets > Actions):

- `TRMNL_PLUGIN_UUID` — your plugin's UUID
- `TRMNL_API_KEY` — your TRMNL API key

### 3. Enable the workflow

The cron runs automatically every 15 minutes. You can also trigger it manually from the Actions tab.

## Local testing

```bash
node update.js
```

Without the env vars set, it will fetch from Horizons and print the computed values without pushing to TRMNL.
