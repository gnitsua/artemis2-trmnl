import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const HORIZONS_API = "https://ssd.jpl.nasa.gov/api/horizons.api";
const ARTEMIS_ID = "-1024";
const MOON_ID = "301";

// Moon position at flyby closest approach: 2026-Apr-06 23:00:46 UTC (7:00:46 PM EDT)
const FLYBY_MOON = {
  x: -1.293979940594494e+05,
  y: -3.819219041342842e+05,
  z: -3.634316759687522e+04,
  vx: 9.153482337016318e-01,
  vy: -3.160059812754620e-01,
  vz: 4.759168309282566e-03,
};

// Map layout constants matching the plugin template (pixels)
const MAP_W = 420;
const MAP_H = 480;
const PADDING = 90;

function dotProduct(a, b) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function crossProduct(a, b) {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function normalize(v) {
  const mag = Math.sqrt(v.x ** 2 + v.y ** 2 + v.z ** 2);
  return { x: v.x / mag, y: v.y / mag, z: v.z / mag };
}

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

function projectToPlane(craftPos, craftVel, moon) {
  const moonVel = { x: moon.vx, y: moon.vy, z: moon.vz };

  const uHat = normalize(moon);
  const angularMomentum = crossProduct(moon, moonVel);
  const nHat = normalize(angularMomentum);
  const vHat = crossProduct(nHat, uHat);

  const u = dotProduct(craftPos, uHat);
  const v = dotProduct(craftPos, vHat);

  const vu = dotProduct(craftVel, uHat);
  const vv = dotProduct(craftVel, vHat);
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
  const clamped =
    mapX < 20 || mapX > MAP_W - 20 || mapY < 20 || mapY > MAP_H - 20;
  return { mapX, mapY, clamped };
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
    { x: craft.vx, y: craft.vy, z: craft.vz },
    moon,
  );
  const moonU = magnitude(moon);
  const maxU = Math.max(moonU, craftProj.u) * 0.95;
  const craftMap = toMapCoords(craftProj.u, craftProj.v, maxU);
  const moonMap = toMapCoords(moonU, 0, maxU);

  const moonYPct = Math.round((moonMap.mapY / MAP_H) * 100);
  const craftHeadingDeg = 180 - craftProj.headingDeg;

  const craftRaw = {
    x: (craftMap.mapX / MAP_W) * 100,
    y: (craftMap.mapY / MAP_H) * 100,
  };

  // Project the flyby moon position onto the 2D map
  const flybyProj = projectToPlane(
    FLYBY_MOON,
    { x: FLYBY_MOON.vx, y: FLYBY_MOON.vy, z: FLYBY_MOON.vz },
    moon,
  );
  const flybyCoords = toMapCoords(flybyProj.u, flybyProj.v, maxU);
  const flybyMoonXPct = Math.round((flybyCoords.mapX / MAP_W) * 100);
  const flybyMoonYPct = Math.round((flybyCoords.mapY / MAP_H) * 100);

  // Compute trail in the inertial reference frame
  const trail = [];
  for (let i = 0; i < count; i++) {
    const c = craftPoints[i];

    const proj = projectToPlane(c, { x: c.vx, y: c.vy, z: c.vz }, moon);

    const coords = toMapCoords(proj.u, proj.v, maxU);
    if (!coords.clamped) {
      trail.push({
        x: Math.round((coords.mapX / MAP_W) * 100),
        y: Math.round((coords.mapY / MAP_H) * 100),
      });
    }
  }

  const mergeVars = {
    craft_x_pct: Math.round(craftRaw.x),
    craft_y_pct: Math.round(craftRaw.y),
    craft_heading_deg: craftHeadingDeg,
    moon_y_pct: moonYPct,
    flyby_moon_x_pct: flybyMoonXPct,
    flyby_moon_y_pct: flybyMoonYPct,
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
    `${count} trail points, craft:(${Math.round(craftRaw.x)},${Math.round(craftRaw.y)}) moon_y:${moonYPct} heading:${craftHeadingDeg}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
