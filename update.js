import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const HORIZONS_API = "https://ssd.jpl.nasa.gov/api/horizons.api";
const ARTEMIS_ID = "-1024";
const MOON_ID = "301";

// Map layout constants matching the plugin template (pixels)
const MAP_W = 420;
const MAP_H = 480;
const PADDING = 90;

function buildHorizonsUrl(command, start, end, step) {
  const params = new URLSearchParams({
    format: "json",
    COMMAND: `'${command}'`,
    OBJ_DATA: "'NO'",
    MAKE_EPHEM: "'YES'",
    EPHEM_TYPE: "'VECTORS'",
    CENTER: "'500@399'",
    START_TIME: `'${start}'`,
    STOP_TIME: `'${end}'`,
    STEP_SIZE: `'${step}'`,
  });
  return `${HORIZONS_API}?${params}`;
}

function parseAllVectors(resultText) {
  const soeIdx = resultText.indexOf("$$SOE");
  const eoeIdx = resultText.indexOf("$$EOE");
  if (soeIdx === -1 || eoeIdx === -1) return [];

  const dataBlock = resultText.slice(soeIdx + 5, eoeIdx).trim();
  const lines = dataBlock
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  const parseValues = (line, labels) => {
    const vals = {};
    for (const label of labels) {
      const m = line.match(new RegExp(`${label}\\s*=\\s*([\\d.eE+-]+)`));
      if (m) vals[label] = parseFloat(m[1]);
    }
    return vals;
  };

  const points = [];
  // Each entry: date line, X/Y/Z line, VX/VY/VZ line, LT/RG/RR line = 4 lines
  for (let i = 0; i < lines.length; i += 4) {
    if (i + 2 >= lines.length) break;
    const pos = parseValues(lines[i + 1], ["X", "Y", "Z"]);
    const vel = parseValues(lines[i + 2], ["VX", "VY", "VZ"]);
    if (pos.X !== undefined) {
      points.push({
        x: pos.X,
        y: pos.Y,
        z: pos.Z,
        vx: vel.VX,
        vy: vel.VY,
        vz: vel.VZ,
      });
    }
  }
  return points;
}

function magnitude(v) {
  return Math.sqrt(v.x ** 2 + v.y ** 2 + v.z ** 2);
}

function distance(a, b) {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2);
}

function projectToPlane(pos, vel, moon) {
  const dist = magnitude(moon);
  const e1 = { x: moon.x / dist, y: moon.y / dist, z: moon.z / dist };

  // Component along Earth->Moon axis
  const u = pos.x * e1.x + pos.y * e1.y + pos.z * e1.z;

  // Perpendicular component
  const perpX = pos.x - u * e1.x;
  const perpY = pos.y - u * e1.y;
  const perpZ = pos.z - u * e1.z;
  const perpMag = Math.sqrt(perpX ** 2 + perpY ** 2 + perpZ ** 2);

  // Sign via cross product
  const cross = e1.x * perpY - e1.y * perpX;
  const v = cross >= 0 ? perpMag : -perpMag;

  // Project velocity onto same 2D plane for heading
  const vu = vel.vx * e1.x + vel.vy * e1.y + vel.vz * e1.z;
  const vPerpX = vel.vx - vu * e1.x;
  const vPerpY = vel.vy - vu * e1.y;
  const vPerpMag = Math.sqrt(
    vPerpX ** 2 + vPerpY ** 2 + (vel.vz - vu * e1.z) ** 2,
  );
  const vCross = e1.x * vPerpY - e1.y * vPerpX;
  const vv = vCross >= 0 ? vPerpMag : -vPerpMag;

  // Heading in degrees: 0 = toward moon (up), 90 = right, 180 = toward earth (down)
  // On screen: +u is up (toward moon), +v is right
  // atan2(horizontal, vertical) where vertical is inverted for screen coords
  const headingDeg = Math.round(Math.atan2(vv, vu) * (180 / Math.PI));

  return { u, v, headingDeg };
}

function toMapCoords(u, v, maxU) {
  // Use the same km-per-percent ratio for both axes
  // Vertical: usable range = MAP_H - 2*PADDING, percentage base = MAP_H
  // Horizontal: scale to match so 1% horizontal = same km as 1% vertical
  const vertRange = MAP_H - 2 * PADDING;
  const mapY = MAP_H - PADDING - (u / maxU) * vertRange;
  // Scale v so that percentages of MAP_W match percentages of MAP_H in real km
  const mapX = MAP_W / 2 + (v / maxU) * vertRange * (MAP_H / MAP_W) * 2;
  return {
    mapX: Math.max(20, Math.min(MAP_W - 20, mapX)),
    mapY: Math.max(20, Math.min(MAP_H - 20, mapY)),
  };
}

async function fetchTrail(craftId, moonId) {
  const now = new Date();
  const start = "2026-04-02T02:00:00"; // Post-TLI (earliest Horizons data)
  const end = now.toISOString().slice(0, 19);

  console.log(`Fetching trail from ${start} to ${end} at 15m steps...`);
  const [craftResp, moonResp] = await Promise.all([
    fetch(buildHorizonsUrl(craftId, start, end, "15m")).then((r) => r.json()),
    fetch(buildHorizonsUrl(moonId, start, end, "15m")).then((r) => r.json()),
  ]);

  const craftPoints = parseAllVectors(craftResp.result);
  const moonPoints = parseAllVectors(moonResp.result);
  return { craftPoints, moonPoints };
}

async function main() {
  console.log("Fetching positions from JPL Horizons...");

  const { craftPoints, moonPoints } = await fetchTrail(ARTEMIS_ID, MOON_ID);
  const count = Math.min(craftPoints.length, moonPoints.length);

  if (count === 0) {
    console.error("Failed to parse Horizons data");
    process.exit(1);
  }

  // Use the last point as current position
  const craft = craftPoints[count - 1];
  const moon = moonPoints[count - 1];

  const distEarth = magnitude(craft);
  const distMoon = distance(craft, moon);
  const earthMoonDist = magnitude(moon);
  const speedKms = Math.sqrt(craft.vx ** 2 + craft.vy ** 2 + craft.vz ** 2);
  const speedKmh = Math.round(speedKms * 3600);
  const progress = Math.max(
    1,
    Math.min(100, Math.round((distEarth / earthMoonDist) * 100)),
  );

  // 2D projection for current position
  const craftProj = projectToPlane(
    craft,
    { vx: craft.vx, vy: craft.vy, vz: craft.vz },
    moon,
  );
  const moonU = magnitude(moon);
  const maxU = Math.max(moonU, craftProj.u) * 0.95;
  const craftMap = toMapCoords(craftProj.u, craftProj.v, maxU);
  const moonMap = toMapCoords(moonU, 0, maxU);

  const moonXPct = 50; // Moon is always horizontally centered
  const moonYPct = Math.round((moonMap.mapY / MAP_H) * 100);
  const craftHeadingDeg = 180 - craftProj.headingDeg;

  // Enforce minimum separation from Moon (in percentage points)
  // Prevents capsule from visually overlapping the Moon circle
  const MIN_SEP = 5; // ~20px on a 400px display
  const earthXPct = 50;
  const earthYPct = 81; // Earth at u=0 maps to MAP_H - PADDING = 81%

  const EARTH_SEP = 12; // Larger separation for Earth to show departure orbit
  function separateFromBody(xPct, yPct, bodyX, bodyY, minSep) {
    const dx = xPct - bodyX;
    const dy = yPct - bodyY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < minSep && dist > 0) {
      const scale = minSep / dist;
      return { x: bodyX + dx * scale, y: bodyY + dy * scale };
    }
    if (dist === 0) {
      return { x: xPct, y: yPct - minSep };
    }
    return { x: xPct, y: yPct };
  }

  function separateFromBodies(xPct, yPct) {
    let { x, y } = separateFromBody(xPct, yPct, moonXPct, moonYPct, MIN_SEP);
    ({ x, y } = separateFromBody(x, y, earthXPct, earthYPct, EARTH_SEP));
    return { x: Math.round(x), y: Math.round(y) };
  }

  const craftRaw = {
    x: (craftMap.mapX / MAP_W) * 100,
    y: (craftMap.mapY / MAP_H) * 100,
  };
  const craftSep = separateFromBodies(craftRaw.x, craftRaw.y);

  // Compute trail using the CURRENT Moon position as a fixed reference axis
  // This prevents axis rotation from distorting the trajectory shape
  const trail = [];
  for (let i = 0; i < count; i++) {
    const c = craftPoints[i];
    const proj = projectToPlane(c, { vx: c.vx, vy: c.vy, vz: c.vz }, moon);
    const coords = toMapCoords(proj.u, proj.v, maxU);
    const rawX = (coords.mapX / MAP_W) * 100;
    const rawY = (coords.mapY / MAP_H) * 100;
    trail.push(separateFromBodies(rawX, rawY));
  }

  const mergeVars = {
    craft_x_pct: craftSep.x,
    craft_y_pct: craftSep.y,
    craft_heading_deg: craftHeadingDeg,
    moon_y_pct: moonYPct,
    distance_earth_km: Math.round(distEarth).toLocaleString("en-US"),
    distance_moon_km: Math.round(distMoon).toLocaleString("en-US"),
    speed_kmh: speedKmh.toLocaleString("en-US"),
    progress,
    updated_at:
      new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC",
    trail,
  };

  const outPath = join(__dirname, "data", "position.json");
  writeFileSync(outPath, JSON.stringify(mergeVars, null, 2) + "\n");
  console.log("Wrote", outPath);
  console.log(
    `${count} trail points, craft:(${craftSep.x},${craftSep.y}) moon_y:${moonYPct} heading:${craftHeadingDeg}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
