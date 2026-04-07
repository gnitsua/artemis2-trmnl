import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const MAP_W = 420;
const MAP_H = 480;
const PADDING = 90;

function parseEphemeris(filename) {
  const text = readFileSync(join(__dirname, filename), "utf8");
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const points = [];
  const parse = (line, labels) => {
    const v = {};
    for (const l of labels) {
      const m = line.match(new RegExp(l + "\\s*=\\s*([\\d.eE+-]+)"));
      if (m) v[l] = parseFloat(m[1]);
    }
    return v;
  };
  // Each entry: date line, X/Y/Z line, VX/VY/VZ line, LT/RG/RR line = 4 lines
  for (let i = 1; i < lines.length - 1; i += 4) {
    const pos = parse(lines[i + 1], ["X", "Y", "Z"]);
    const vel = parse(lines[i + 2], ["VX", "VY", "VZ"]);
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
  const u = pos.x * e1.x + pos.y * e1.y + pos.z * e1.z;
  const perpX = pos.x - u * e1.x;
  const perpY = pos.y - u * e1.y;
  const perpZ = pos.z - u * e1.z;
  const perpMag = Math.sqrt(perpX ** 2 + perpY ** 2 + perpZ ** 2);
  const cross = e1.x * perpY - e1.y * perpX;
  const v = cross >= 0 ? -perpMag : perpMag;

  const vu = vel.vx * e1.x + vel.vy * e1.y + vel.vz * e1.z;
  const vPerpX = vel.vx - vu * e1.x;
  const vPerpY = vel.vy - vu * e1.y;
  const vPerpMag = Math.sqrt(
    vPerpX ** 2 + vPerpY ** 2 + (vel.vz - vu * e1.z) ** 2,
  );
  const vCross = e1.x * vPerpY - e1.y * vPerpX;
  const vv = vCross >= 0 ? -vPerpMag : vPerpMag;
  const headingDeg = Math.round(Math.atan2(vv, vu) * (180 / Math.PI));

  return { u, v, headingDeg };
}

function toMapCoords(u, v, maxU) {
  const vertRange = MAP_H - 2 * PADDING;
  const mapY = MAP_H - PADDING - (u / maxU) * vertRange;
  const mapX = MAP_W / 2 + (v / maxU) * vertRange * (MAP_H / MAP_W) * 2;
  return {
    mapX: Math.max(20, Math.min(MAP_W - 20, mapX)),
    mapY: Math.max(20, Math.min(MAP_H - 20, mapY)),
  };
}

const HORIZONS_API = "https://ssd.jpl.nasa.gov/api/horizons.api";
const MIN_SEP = 6;

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

function separateFromMoon(xPct, yPct, moonYPct) {
  const moonXPct = 50;
  const dx = xPct - moonXPct;
  const dy = yPct - moonYPct;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist < MIN_SEP && dist > 0) {
    const scale = MIN_SEP / dist;
    return {
      x: Math.round(moonXPct + dx * scale),
      y: Math.round(moonYPct + dy * scale),
    };
  }
  if (dist === 0) {
    return { x: Math.round(xPct), y: Math.round(yPct + MIN_SEP) };
  }
  return { x: Math.round(xPct), y: Math.round(yPct) };
}

async function main() {
  const start = "2026-04-02 02:00";
  const end = new Date().toISOString().slice(0, 19);

  console.log(`Fetching from ${start} to ${end} at 1h steps...`);
  const [craftResp, moonResp] = await Promise.all([
    fetch(buildHorizonsUrl("-1024", start, end, "1h")).then((r) => r.json()),
    fetch(buildHorizonsUrl("301", start, end, "1h")).then((r) => r.json()),
  ]);

  const craftPoints = parseAllVectors(craftResp.result);
  const moonPoints = parseAllVectors(moonResp.result);
  const count = Math.min(craftPoints.length, moonPoints.length);

  if (count === 0) {
    console.error("No data returned");
    process.exit(1);
  }

  // Compute all trail points
  const trail = [];
  for (let i = 0; i < count; i++) {
    const c = craftPoints[i];
    const m = moonPoints[i];
    const proj = projectToPlane(c, { vx: c.vx, vy: c.vy, vz: c.vz }, m);
    const mu = magnitude(m);
    const maxU = Math.max(mu, proj.u) * 0.95;
    const coords = toMapCoords(proj.u, proj.v, maxU);
    const mCoords = toMapCoords(mu, 0, maxU);
    const rawX = (coords.mapX / MAP_W) * 100;
    const rawY = (coords.mapY / MAP_H) * 100;
    const mY = (mCoords.mapY / MAP_H) * 100;
    const sep = separateFromMoon(rawX, rawY, mY);
    trail.push({ x: sep.x, y: sep.y });
  }

  // Use last point as current position
  const craft = craftPoints[count - 1];
  const moon = moonPoints[count - 1];
  const distEarth = magnitude(craft);
  const distMoon = distance(craft, moon);
  const earthMoonDist = magnitude(moon);
  const speedKms = Math.sqrt(craft.vx ** 2 + craft.vy ** 2 + craft.vz ** 2);
  const craftProj = projectToPlane(
    craft,
    { vx: craft.vx, vy: craft.vy, vz: craft.vz },
    moon,
  );
  const moonU = magnitude(moon);
  const maxU = Math.max(moonU, craftProj.u) * 0.95;
  const craftMap = toMapCoords(craftProj.u, craftProj.v, maxU);
  const moonMap = toMapCoords(moonU, 0, maxU);
  const rawX = (craftMap.mapX / MAP_W) * 100;
  const rawY = (craftMap.mapY / MAP_H) * 100;
  const moonYPct = Math.round((moonMap.mapY / MAP_H) * 100);
  const craftSep = separateFromMoon(rawX, rawY, moonYPct);
  const craftHeadingDeg = 180 - craftProj.headingDeg;

  const mergeVars = {
    craft_x_pct: craftSep.x,
    craft_y_pct: craftSep.y,
    craft_heading_deg: craftHeadingDeg,
    moon_y_pct: moonYPct,
    distance_earth_km: Math.round(distEarth).toLocaleString("en-US"),
    distance_moon_km: Math.round(distMoon).toLocaleString("en-US"),
    speed_kmh: Math.round(speedKms * 3600).toLocaleString("en-US"),
    progress: Math.max(
      1,
      Math.min(100, Math.round((distEarth / earthMoonDist) * 100)),
    ),
    updated_at:
      new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC",
    trail,
  };

  const outPath = join(__dirname, "data", "position.json");
  writeFileSync(outPath, JSON.stringify(mergeVars, null, 2) + "\n");
  console.log(
    `Wrote ${trail.length} trail points (1h intervals since April 2) to ${outPath}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
