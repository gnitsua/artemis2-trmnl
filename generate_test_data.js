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
  const v = cross >= 0 ? perpMag : -perpMag;

  const vu = vel.vx * e1.x + vel.vy * e1.y + vel.vz * e1.z;
  const vPerpX = vel.vx - vu * e1.x;
  const vPerpY = vel.vy - vu * e1.y;
  const vPerpMag = Math.sqrt(
    vPerpX ** 2 + vPerpY ** 2 + (vel.vz - vu * e1.z) ** 2,
  );
  const vCross = e1.x * vPerpY - e1.y * vPerpX;
  const vv = vCross >= 0 ? vPerpMag : -vPerpMag;
  const headingDeg = Math.round(Math.atan2(vv, vu) * (180 / Math.PI));

  return { u, v, headingDeg };
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

const craftPoints = parseEphemeris("craft_ephemeris.txt");
const moonPoints = parseEphemeris("moon_ephemeris.txt");

// Moon starts at April 1 01:00, craft at April 2 02:00 = 300 intervals offset (5min each)
const moonOffset = 300;

const frames = [];
for (let i = 0; i < craftPoints.length; i++) {
  const moonIdx = i + moonOffset;
  if (moonIdx >= moonPoints.length) break;

  const craft = craftPoints[i];
  const moon = moonPoints[moonIdx];

  const distEarth = magnitude(craft);
  const distMoon = distance(craft, moon);
  const earthMoonDist = magnitude(moon);
  const speedKms = Math.sqrt(craft.vx ** 2 + craft.vy ** 2 + craft.vz ** 2);
  const speedKmh = Math.round(speedKms * 3600);
  const progress = Math.max(
    1,
    Math.min(100, Math.round((distEarth / earthMoonDist) * 100)),
  );

  const craftProj = projectToPlane(
    craft,
    { vx: craft.vx, vy: craft.vy, vz: craft.vz },
    moon,
  );
  const moonU = magnitude(moon);
  const craftMap = toMapCoords(craftProj.u, craftProj.v, moonU);

  const craftXPct = Math.round((craftMap.mapX / MAP_W) * 100);
  const craftYPct = Math.round((craftMap.mapY / MAP_H) * 100);
  const craftHeadingDeg = 180 - craftProj.headingDeg;

  frames.push({
    craft_x_pct: craftXPct,
    craft_y_pct: craftYPct,
    craft_heading_deg: craftHeadingDeg,
    distance_earth_km: Math.round(distEarth).toLocaleString("en-US"),
    distance_moon_km: Math.round(distMoon).toLocaleString("en-US"),
    speed_kmh: speedKmh.toLocaleString("en-US"),
    progress,
    hours_elapsed: ((i * 5) / 60).toFixed(1),
  });
}

const outPath = join(__dirname, "test_frames.json");
writeFileSync(outPath, JSON.stringify(frames));
console.log(`Generated ${frames.length} frames to test_frames.json`);
