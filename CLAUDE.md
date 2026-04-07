# CLAUDE.md

## What is this?

A TRMNL e-ink display plugin that tracks the Artemis II spacecraft's position between Earth and the Moon. It shows a 2D map with Earth at the bottom, Moon near the top, the spacecraft's current position, and a trail of its trajectory since launch.

## Architecture

```
update.js          # Fetches spacecraft + Moon positions from JPL Horizons API,
                   # projects 3D coordinates to 2D, writes data/position.json
sync_data.js       # Copies position.json into .trmnlp.yml for local preview
data/position.json # Current position data (committed by GitHub Actions cron)

src/               # Liquid templates (TRMNL plugin markup)
├── full.liquid            # Full layout (800×480)
├── half_vertical.liquid   # Half vertical (400×480)
├── half_horizontal.liquid # Half horizontal (800×240)
├── quadrant.liquid        # Quadrant (400×240)
├── settings.yml           # Plugin config (polling URL, custom fields)
└── shared.liquid          # Shared partials (if any)

.trmnlp.yml       # trmnlp dev server config (variables + watch paths)
.github/workflows/update.yml # Cron job: runs update.js every 15 minutes

plugin*.html       # Legacy HTML templates (kept for TRMNL markup editor)
generate_test_data.js # Generates test trajectory frames from ephemeris files
```

## Data flow

1. GitHub Actions runs `update.js` every 15 minutes
2. `update.js` fetches from JPL Horizons API:
   - Artemis II (command `-1024`) positions from April 2 to now at 15-minute intervals
   - Moon (command `301`) positions for the same range
3. Projects 3D ECI coordinates onto the Earth-Moon plane
4. Computes: spacecraft %, Moon %, heading, distances, trail points
5. Writes `data/position.json` and commits to repo
6. TRMNL polls the raw GitHub URL for the JSON, renders Liquid templates as PNG

## Key data format (position.json)

```json
{
  "craft_x_pct": 44,      // Spacecraft horizontal position (0-100%)
  "craft_y_pct": 15,      // Spacecraft vertical position (0%=top, 100%=bottom)
  "craft_heading_deg": 180, // Capsule rotation (0=up, 180=down)
  "moon_y_pct": 16,       // Moon vertical position
  "distance_earth_km": "410,394",
  "distance_moon_km": "14,522",
  "speed_kmh": "1,575",
  "progress": 100,
  "updated_at": "2026-04-07 02:04 UTC",
  "trail": [{"x": 39, "y": 77}, ...]  // Array of past positions
}
```

Earth is fixed at `(50%, 81%)`. Moon is at `(50%, moon_y_pct)`.

## Projection math (update.js)

- **Vertical axis (y)**: Distance from Earth along the current Earth-Moon direction. Earth=81%, Moon=dynamic based on distance.
- **Horizontal axis (x)**: Perpendicular component in the Earth-Moon plane. 50% = on the Earth-Moon line.
- **H_SCALE**: Horizontal exaggeration factor (currently `2`) applied in `toMapCoords`.
- **maxU**: `Math.max(moonDist, craftU) * 0.95` — scales the vertical range.
- **Trail**: All points projected using the CURRENT Moon position as a fixed reference axis (prevents axis rotation from distorting trajectory shape).
- **Separation**: `separateFromBodies()` enforces minimum pixel separation from Moon (`MIN_SEP=5`) and Earth (`EARTH_SEP=12`) so trail/capsule don't overlap the oversized circles.

## TRMNL template conventions

- Templates use Liquid syntax: `{{ variable }}`, `{% for point in trail %}`
- CSS positioning uses inline styles for dynamic values, `<style>` blocks for layout
- The TRMNL framework provides utility classes: `bg--black`, `w--4`, `label--small`, etc.
- Bit-depth responsive classes: `1bit:bg--black 2bit:bg--gray-50 4bit:bg--gray-50`
- All map views use the same position percentages from position.json
- Map aspect ratios are constrained to match the full view (420:480) so positions look consistent
- Capsule shape: CSS `clip-path: polygon(0% 0%, 100% 0%, 75% 100%, 25% 100%)` with white `drop-shadow` halo
- Trail dots use `z-index: 2`, capsule `z-index: 1`, Moon/Earth `z-index: 3`

## Local development

```bash
# Preview templates
trmnlp serve
# Then open http://localhost:4567

# Update position data and sync to preview
node update.js && node sync_data.js

# Just sync existing data to preview (no API call)
node sync_data.js
```

## Common tasks

- **Adjust horizontal spread**: Change `H_SCALE` constant in `update.js` (and `generate_test_data.js`)
- **Adjust Moon/Earth separation**: Change `MIN_SEP` and `EARTH_SEP` in `update.js`
- **Adjust vertical margin**: Change the `* 0.95` multiplier on `maxU` in `update.js`
- **Change trail resolution**: Change the step size in `fetchTrail()` (currently `"15m"`)
- **Change trail start time**: Change the `start` date in `fetchTrail()`
- **Resize map elements**: Moon/Earth circles use TRMNL `w--N` classes, capsule uses CSS `width/height`

## Important details

- Earth position at `top: 81%` in CSS must match the projection's `u=0` mapping (MAP_H - PADDING = 81%)
- The GitHub Actions cron commits to `data/position.json` every 15 minutes, causing merge conflicts when pushing local changes — use `git pull --rebase` and resolve by regenerating position.json
- JPL Horizons has no data for Artemis II before `2026-04-02T02:00:00` (pre-TLI)
- Node.js 22+ required (uses native `fetch`)
