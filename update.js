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

function buildHorizonsUrl(command) {
  const now = new Date();
  const start = now.toISOString().slice(0, 19);
  const end = new Date(now.getTime() + 5 * 60_000).toISOString().slice(0, 19);
  const params = new URLSearchParams({
    format: "json",
    COMMAND: `'${command}'`,
    OBJ_DATA: "'NO'",
    MAKE_EPHEM: "'YES'",
    EPHEM_TYPE: "'VECTORS'",
    CENTER: "'500@399'",
    START_TIME: `'${start}'`,
    STOP_TIME: `'${end}'`,
    STEP_SIZE: "'5m'",
  });
  return `${HORIZONS_API}?${params}`;
}

function parseVectors(resultText) {
  const soeIdx = resultText.indexOf("$$SOE");
  const eoeIdx = resultText.indexOf("$$EOE");
  if (soeIdx === -1 || eoeIdx === -1) return null;

  const dataBlock = resultText.slice(soeIdx + 5, eoeIdx).trim();
  const lines = dataBlock
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  // Line 0: JDTDB, CalendarDate
  // Line 1: X= ... Y= ... Z= ...
  // Line 2: VX= ... VY= ... VZ= ...
  const parseValues = (line, labels) => {
    const vals = {};
    for (const label of labels) {
      const m = line.match(new RegExp(`${label}\\s*=\\s*([\\d.eE+-]+)`));
      if (m) vals[label] = parseFloat(m[1]);
    }
    return vals;
  };

  const pos = parseValues(lines[1], ["X", "Y", "Z"]);
  const vel = parseValues(lines[2], ["VX", "VY", "VZ"]);

  return { x: pos.X, y: pos.Y, z: pos.Z, vx: vel.VX, vy: vel.VY, vz: vel.VZ };
}

function magnitude(v) {
  return Math.sqrt(v.x ** 2 + v.y ** 2 + v.z ** 2);
}

function distance(a, b) {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2);
}

function projectToPlane(spacecraft, moon) {
  const dist = magnitude(moon);
  const e1 = { x: moon.x / dist, y: moon.y / dist, z: moon.z / dist };

  // Component along Earth->Moon axis
  const u = spacecraft.x * e1.x + spacecraft.y * e1.y + spacecraft.z * e1.z;

  // Perpendicular component
  const perpX = spacecraft.x - u * e1.x;
  const perpY = spacecraft.y - u * e1.y;
  const perpZ = spacecraft.z - u * e1.z;
  const perpMag = Math.sqrt(perpX ** 2 + perpY ** 2 + perpZ ** 2);

  // Sign via cross product
  const cross = e1.x * perpY - e1.y * perpX;
  return { u, v: cross >= 0 ? perpMag : -perpMag };
}

function toMapCoords(u, v, moonU) {
  const scale = (MAP_H - 2 * PADDING) / moonU;
  const mapY = MAP_H - PADDING - (u / moonU) * (MAP_H - 2 * PADDING);
  const mapX = MAP_W / 2 + v * scale;
  return {
    mapX: Math.max(20, Math.min(MAP_W - 20, mapX)),
    mapY: Math.max(20, Math.min(MAP_H - 20, mapY)),
  };
}

async function fetchPosition(command) {
  const url = buildHorizonsUrl(command);
  const resp = await fetch(url);
  const data = await resp.json();
  return parseVectors(data.result);
}

async function main() {
  console.log("Fetching positions from JPL Horizons...");

  const [craft, moon] = await Promise.all([
    fetchPosition(ARTEMIS_ID),
    fetchPosition(MOON_ID),
  ]);

  if (!craft || !moon) {
    console.error("Failed to parse Horizons data");
    process.exit(1);
  }

  const distEarth = magnitude(craft);
  const distMoon = distance(craft, moon);
  const earthMoonDist = magnitude(moon);
  const speedKms = Math.sqrt(craft.vx ** 2 + craft.vy ** 2 + craft.vz ** 2);
  const speedKmh = Math.round(speedKms * 3600);
  const progress = Math.max(
    1,
    Math.min(100, Math.round((distEarth / earthMoonDist) * 100)),
  );

  // 2D projection: Earth-Moon axis = vertical, perpendicular = horizontal
  const craftProj = projectToPlane(craft, moon);
  const moonU = magnitude(moon);
  const craftMap = toMapCoords(craftProj.u, craftProj.v, moonU);

  const craftXPct = Math.round((craftMap.mapX / MAP_W) * 100);
  const craftYPct = Math.round((craftMap.mapY / MAP_H) * 100);

  const mergeVars = {
    craft_x_pct: craftXPct,
    craft_y_pct: craftYPct,
    distance_earth_km: Math.round(distEarth).toLocaleString("en-US"),
    distance_moon_km: Math.round(distMoon).toLocaleString("en-US"),
    speed_kmh: speedKmh.toLocaleString("en-US"),
    progress,
    updated_at:
      new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC",
  };

  const outPath = join(__dirname, "data", "position.json");
  writeFileSync(outPath, JSON.stringify(mergeVars, null, 2) + "\n");
  console.log("Wrote", outPath);
  console.log(JSON.stringify(mergeVars, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
