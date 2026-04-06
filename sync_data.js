// Reads data/position.json and writes it into .trmnlp.yml variables block
// Run after update.js to refresh the trmnlp preview

import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const data = JSON.parse(
  readFileSync(join(__dirname, "data", "position.json"), "utf8"),
);

const yml = `watch:
  - src
  - .trmnlp.yml

variables:
  craft_x_pct: ${data.craft_x_pct}
  craft_y_pct: ${data.craft_y_pct}
  craft_heading_deg: ${data.craft_heading_deg}
  moon_y_pct: ${data.moon_y_pct}
  distance_earth_km: "${data.distance_earth_km}"
  distance_moon_km: "${data.distance_moon_km}"
  speed_kmh: "${data.speed_kmh}"
  progress: ${data.progress}
  updated_at: "${data.updated_at}"
  trail:
${data.trail.map((p) => `    - x: ${p.x}\n      y: ${p.y}`).join("\n")}
`;

writeFileSync(join(__dirname, ".trmnlp.yml"), yml);
console.log("Synced position data to .trmnlp.yml");
