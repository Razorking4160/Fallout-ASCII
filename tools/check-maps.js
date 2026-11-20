#!/usr/bin/env node
/* Geometry checks for the shipped maps and the overworld.
 *
 * Loads js/data/game-data.js in a sandbox and verifies what the browser only
 * discovers while playing: every map has a start, rows are the same width,
 * every text-map character is a known tile/entity/item, exits sit on an exit
 * tile and lead to a real map, placed things are inside the grid, and the
 * overworld nodes and routes reference maps that exist, and every terrain table
 * names real enemies with positive weights.
 *
 *   node tools/check-maps.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const sandbox = { console };
sandbox.window = sandbox;
sandbox.self = sandbox;
vm.createContext(sandbox);

for (const rel of ['js/engine/util.js', 'js/data/game-data.js']) {
  const file = path.join(ROOT, rel);
  vm.runInContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: rel });
}

const WA = sandbox.WA;
const GAME = WA && WA.GAME;
if (!GAME) {
  console.error('game-data.js did not define WA.GAME');
  process.exit(1);
}

const LEG = WA.LEG || {};
const problems = [];
const note = (map, msg) => problems.push(`${map}: ${msg}`);

function isTextMap(m) {
  return m && !m.legend && Array.isArray(m.rows);
}

for (const id of Object.keys(GAME.maps)) {
  const m = GAME.maps[id];
  if (!m || typeof m !== 'object') { note(id, 'not an object'); continue; }
  if (!isTextMap(m)) {
    // Layered maps are written by the editor; only the shared fields are checked.
    if (!Array.isArray(m.rows)) note(id, 'has no rows');
    if (!Array.isArray(m.start) || m.start.length !== 2) note(id, 'has no start position');
    continue;
  }
  const rows = m.rows.map(r => Array.from(r));
  const w = rows.length ? rows[0].length : 0;
  let start = 0;
  rows.forEach((cells, y) => {
    if (cells.length !== w) note(id, `row ${y} is ${cells.length} wide, expected ${w}`);
    cells.forEach((ch, x) => {
      if (ch === '@') { start++; return; }
      if (!LEG[ch]) note(id, `row ${y} column ${x}: "${ch}" is not in the symbol table`);
    });
  });
  if (w < 3 || rows.length < 3) note(id, 'is too small');
  // A map with no `@` is entered through one of its exits, which is how the
  // outskirts and the pumphouse work: the player is placed beside the exit that
  // leads back. More than one start is always a mistake.
  if (start > 1) note(id, `has ${start} start markers, expected at most 1`);
  if (!start && !Object.keys(m.exits || {}).length) note(id, 'has no start and no exits, so it cannot be reached');

  for (const key of Object.keys(m.exits || {})) {
    const [x, y] = key.split(',').map(Number);
    if (!Number.isInteger(x) || !Number.isInteger(y) || !rows[y] || rows[y][x] === undefined) {
      note(id, `exit ${key} is outside the map`);
      continue;
    }
    if (LEG[rows[y][x]] !== 'exit') note(id, `exit ${key} is on "${rows[y][x]}", not an exit tile`);
    const to = m.exits[key];
    if (!GAME.maps[to]) note(id, `exit ${key} leads to unknown map "${to}"`);
  }

  // Text maps place entities and items through their symbols, so the exit check
  // above covers their placement too; layered maps carry an explicit list.
  for (const thing of m.things || []) {
    if (!Array.isArray(thing) || thing.length !== 3) { note(id, 'has a malformed thing entry'); continue; }
    const [tid, x, y] = thing;
    if (!GAME.entities[tid] && !GAME.items[tid]) note(id, `thing "${tid}" is not an entity or item`);
    if (!rows[y] || rows[y][x] === undefined) note(id, `thing "${tid}" at ${x},${y} is outside the map`);
  }
}

const world = GAME.world || {};
const nodes = world.nodes || {};
for (const id of Object.keys(nodes)) {
  if (!GAME.maps[id]) note('world', `node "${id}" has no map`);
  const n = nodes[id] || {};
  if (!Number.isFinite(n.x) || !Number.isFinite(n.y)) note('world', `node "${id}" has no chart position`);
  if (n.x < 0 || n.x >= 22 || n.y < 0 || n.y >= 8) note('world', `node "${id}" is off the 22x8 chart`);
}
// Terrain tables: every node that names one must find it, and every pool must
// point at real enemies with a positive weight, or travel silently goes quiet.
const terrains = world.terrains || {};
for (const id of Object.keys(nodes)) {
  const n = nodes[id] || {};
  if (n.terrain && !terrains[n.terrain]) note('world', `node "${id}" names unknown terrain "${n.terrain}"`);
  for (const e of (Array.isArray(n.road) ? n.road : [])) {
    if (!GAME.entities[e]) note('world', `node "${id}" lists unknown road enemy "${e}"`);
  }
}
for (const id of Object.keys(terrains)) {
  const t = terrains[id] || {};
  if (!t.name) note('world', `terrain "${id}" has no name`);
  if (!(t.danger > 0)) note('world', `terrain "${id}" has no danger multiplier`);
  const pool = Array.isArray(t.pool) ? t.pool : [];
  if (!pool.length) note('world', `terrain "${id}" has an empty encounter pool`);
  for (const row of pool) {
    const e = Array.isArray(row) ? row[0] : row;
    const w = Array.isArray(row) ? row[1] : 1;
    if (!GAME.entities[e]) note('world', `terrain "${id}" pools unknown enemy "${e}"`);
    if (!(w > 0)) note('world', `terrain "${id}" gives "${e}" no encounter weight`);
  }
}
const seenNodes = new Set();
for (const r of world.routes || []) {
  if (!Array.isArray(r) || r.length < 3) { note('world', 'malformed route'); continue; }
  const [a, b, hours] = r;
  if (!nodes[a]) note('world', `route from unknown node "${a}"`);
  if (!nodes[b]) note('world', `route to unknown node "${b}"`);
  if (!(hours > 0)) note('world', `route ${a}-${b} has no travel time`);
  seenNodes.add(a); seenNodes.add(b);
}
for (const id of Object.keys(nodes)) {
  if (!seenNodes.has(id)) note('world', `node "${id}" is not on any route`);
}

if (problems.length) {
  console.error(`Map check failed — ${problems.length} problem${problems.length === 1 ? '' : 's'}:`);
  for (const p of problems) console.error('  ' + p);
  process.exit(1);
}
console.log(`Map check OK — ${Object.keys(GAME.maps).length} maps, ${Object.keys(nodes).length} overworld nodes.`);
