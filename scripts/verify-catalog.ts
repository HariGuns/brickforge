/**
 * Verifies the generated part catalog against the real LDraw + LDCad shadow
 * data, through the same transform the .ldr export uses (rot 0 and rot 90):
 *   - every stud and anti-stud snap lands on exactly the cells and heights the
 *     validator uses (inferred anti-studs are reported, not checked)
 *   - the body (wheel pins excluded) fits the footprint and height, within the
 *     small overhang the catalog allows
 *   - wheel pins sit where the validator says
 *   - each wheel, mounted on a real holder with the validator's placement,
 *     has its hub on the pin's axis, flush against the holder, not inside it
 *
 * Usage: npm run verify-ldraw   (runs this after the core check)
 */
import { CATALOG_PARTS, getPart, type PartDef } from "../src/lib/parts/library";
import { footprint, worldBottom, worldPins, worldStuds } from "../src/lib/model/geometry";
import { ldrawTransform, LDU_PLATE, LDU_STUD, type Mat3 } from "../src/lib/ldraw/export";
import type { Placement, Rot } from "../src/lib/model/schema";
import { wheelMount } from "../src/lib/parts/wheels";
import { openLibrary, type V } from "./lib/ldrawGeo";
import { partMesh } from "./lib/ldrawMesh";
import { openShadow, snapAxis, type Snap } from "./lib/snaps";
import { OVERHANG } from "./lib/classify";

const lib = openLibrary();
const shadow = openShadow();
if (lib.size === 0) {
  console.error("No LDraw library found (see README).");
  process.exit(2);
}

const mul = (m: Mat3, v: V): V => [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]];
const add = (a: V, b: V): V => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const norm = (v: V): V => {
  const l = Math.hypot(...v) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
const near = (a: number, b: number, e = 0.05) => Math.abs(a - b) <= e;

/** Snaps of a placed part, in world LDraw coordinates. */
function placedSnaps(pl: Placement, def: PartDef): (Snap & { w: V; axis: V })[] {
  const { pos, m } = ldrawTransform(pl, def);
  return shadow.snaps(def.ldraw.file).map((s) => ({ ...s, w: add(mul(m, s.pos), pos), axis: norm(mul(m, snapAxis(s))) }));
}

function checkPart(def: PartDef, rot: Rot): string[] {
  const problems: string[] = [];
  const pl: Placement = { part: def.id, color: "red", x: 3, y: 2, z: 4, rot };
  const fp = footprint(pl, def);
  const snaps = placedSnaps(pl, def);

  // Studs and anti-studs: grid snaps (radius 6, vertical) → cells and heights.
  const cellOf = (w: V) => {
    const x = w[0] / LDU_STUD - 0.5, z = -w[2] / LDU_STUD - 0.5, y = -w[1] / LDU_PLATE;
    return near(x, Math.round(x), 0.03) && near(z, Math.round(z), 0.03) && near(y, Math.round(y), 0.03) ? `${Math.round(x)},${Math.round(z)},${Math.round(y)}` : null;
  };
  const grid = snaps.filter((s) => s.kind === "cyl" && near(s.secs[0]?.[1] ?? 0, 6, 0.01) && Math.abs(s.axis[1]) > 0.99 && s.axis[1] > 0);
  const gotStuds = new Set(grid.filter((s) => s.gender === "M").map((s) => cellOf(s.w) ?? "off-grid"));
  const gotBottom = new Set(grid.filter((s) => s.gender === "F").map((s) => cellOf(s.w)).filter((c): c is string => !!c));
  const expStuds = new Set(worldStuds(pl, def).map(([x, z, y]) => `${x},${z},${y}`));
  const expBottom = new Set(worldBottom(pl, def).map(([x, z, y]) => `${x},${z},${y}`));
  const diff = (a: Set<string>, b: Set<string>) => [...a].filter((x) => !b.has(x));
  if (diff(gotStuds, expStuds).length || diff(expStuds, gotStuds).length) problems.push(`studs: LDraw has [${diff(gotStuds, expStuds).join(" ")}] extra, [${diff(expStuds, gotStuds).join(" ")}] missing`);
  if (!def.inferred && (diff(gotBottom, expBottom).length || diff(expBottom, gotBottom).length)) problems.push(`anti-studs: LDraw has [${diff(gotBottom, expBottom).join(" ")}] extra, [${diff(expBottom, gotBottom).join(" ")}] missing`);

  // Pins: the validator's points vs the real pin snaps.
  const pinSnaps = snaps.filter((s) => s.kind === "cyl" && s.gender === "M" && Math.abs(s.axis[1]) < 0.01 && (near(s.secs[0]?.[1] ?? 0, 4, 0.01) || near(s.secs[0]?.[1] ?? 0, 8, 0.01)));
  for (const p of worldPins(pl, def)) {
    const w: V = [p.at[0] * LDU_STUD, -p.at[1] * LDU_PLATE, -p.at[2] * LDU_STUD];
    if (!pinSnaps.some((s) => Math.hypot(s.w[0] - w[0], s.w[1] - w[1], s.w[2] - w[2]) < 0.1)) problems.push(`pin ${p.dir} at ${p.at.join(",")}: no pin snap there`);
  }

  // Body box (pins excluded) vs the footprint.
  if (!def.hub) {
    const { pos, m } = ldrawTransform(pl, def);
    const mesh = partMesh(lib, def.ldraw.file, { skipPins: true });
    const pinCyl = pinSnaps.map((s) => ({ p: s.w, out: [-s.axis[0], -s.axis[1], -s.axis[2]] as V, len: s.secs.reduce((n, q) => n + q[2], 0), r: Math.max(...s.secs.map((q) => q[1])) }));
    const inPin = (v: V) =>
      pinCyl.some((c) => {
        const d: V = [v[0] - c.p[0], v[1] - c.p[1], v[2] - c.p[2]];
        const t = d[0] * c.out[0] + d[1] * c.out[1] + d[2] * c.out[2];
        return t >= -0.5 && t <= c.len + 0.5 && Math.hypot(d[0] - t * c.out[0], d[1] - t * c.out[1], d[2] - t * c.out[2]) <= c.r + 0.6;
      });
    const min: V = [Infinity, Infinity, Infinity], max: V = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < mesh.tris.length; i += 9) {
      const vs = [0, 3, 6].map((o) => add(mul(m, [mesh.tris[i + o], mesh.tris[i + o + 1], mesh.tris[i + o + 2]]), pos));
      if (pinCyl.length && vs.every(inPin)) continue;
      for (const v of vs) for (let a = 0; a < 3; a++) (min[a] = Math.min(min[a], v[a]), (max[a] = Math.max(max[a], v[a])));
    }
    const exp = { minX: fp.x0 * LDU_STUD, maxX: (fp.x0 + fp.sx) * LDU_STUD, minZ: -(fp.z0 + fp.sz) * LDU_STUD, maxZ: -fp.z0 * LDU_STUD, minY: -fp.y1 * LDU_PLATE, maxY: -fp.y0 * LDU_PLATE };
    const xz = OVERHANG + 1.01, y = 1.31;
    if (exp.minX - min[0] > xz || max[0] - exp.maxX > xz || exp.minZ - min[2] > xz || max[2] - exp.maxZ > xz) problems.push(`body sticks out of the footprint: x ${min[0].toFixed(1)}..${max[0].toFixed(1)} vs ${exp.minX}..${exp.maxX}, z ${min[2].toFixed(1)}..${max[2].toFixed(1)} vs ${exp.minZ}..${exp.maxZ}`);
    if (!near(min[1], exp.minY, y) || !near(max[1], exp.maxY, y)) problems.push(`height: y ${min[1].toFixed(1)}..${max[1].toFixed(1)} vs ${exp.minY}..${exp.maxY}`);
    if (Math.abs(min[0] - exp.minX) > xz + 20) problems.push("body is off the footprint");
  }
  return problems;
}

/** Mount a wheel on a real holder with the validator's placement and check it in LDraw space. */
function checkWheel(def: PartDef): string[] {
  const holderId = def.hub!.kind === "wpin" ? "4600" : "6249";
  const hdef = getPart(holderId)!;
  const problems: string[] = [];
  for (const hrot of [0, 90] as Rot[]) {
    const holder: Placement = { part: holderId, color: "black", x: 10, y: 6, z: 10, rot: hrot };
    for (const pin of worldPins(holder, hdef)) {
      const at = wheelMount(pin, def);
      if (!at) {
        problems.push(`holder rot ${hrot}: no grid placement puts the hub on the ${pin.dir} pin`);
        continue;
      }
      const wheel: Placement = { part: def.id, color: "red", ...at };
      const pinSnap = placedSnaps(holder, hdef).find((s) => s.kind === "cyl" && s.gender === "M" && Math.abs(s.axis[1]) < 0.01 && Math.hypot(s.w[0] - pin.at[0] * 20, s.w[1] + pin.at[1] * 8, s.w[2] + pin.at[2] * 20) < 0.1);
      if (!pinSnap) {
        problems.push(`holder rot ${hrot}: pin snap not found`);
        continue;
      }
      const out: V = [-pinSnap.axis[0], -pinSnap.axis[1], -pinSnap.axis[2]]; // the pin points outward
      // The wheel's hub (on its axis) must lie on the pin's axis line.
      const hubs = placedSnaps(wheel, def).filter((s) => s.kind === "cyl" && s.gender === "F" && Math.abs(s.axis[1]) < 0.01);
      const onAxis = hubs.filter((h) => {
        const d: V = [h.w[0] - pinSnap.w[0], h.w[1] - pinSnap.w[1], h.w[2] - pinSnap.w[2]];
        const t = d[0] * out[0] + d[1] * out[1] + d[2] * out[2];
        return Math.hypot(d[0] - t * out[0], d[1] - t * out[1], d[2] - t * out[2]) < 0.1 && Math.abs(Math.abs(h.axis[0] * out[0] + h.axis[2] * out[2]) - 1) < 0.01;
      });
      if (!onAxis.length) problems.push(`holder rot ${hrot}, ${pin.dir} pin: hub is off the pin's axis`);
      // Flush: the wheel's geometry starts at the pin's base, going outward.
      const { pos, m } = ldrawTransform(wheel, def);
      const mesh = partMesh(lib, def.ldraw.file);
      let tmin = Infinity;
      for (let i = 0; i < mesh.tris.length; i += 3) {
        const v = add(mul(m, [mesh.tris[i], mesh.tris[i + 1], mesh.tris[i + 2]]), pos);
        tmin = Math.min(tmin, (v[0] - pinSnap.w[0]) * out[0] + (v[1] - pinSnap.w[1]) * out[1] + (v[2] - pinSnap.w[2]) * out[2]);
      }
      if (Math.abs(tmin) > 0.6) problems.push(`holder rot ${hrot}, ${pin.dir} pin: wheel ${tmin > 0 ? `${tmin.toFixed(1)} LDU off the holder` : `${(-tmin).toFixed(1)} LDU into the holder`}`);
    }
  }
  return problems;
}

let failures = 0;
const inferred: string[] = [];
for (const def of CATALOG_PARTS) {
  const first = lib.readLines(def.ldraw.file)?.[0] ?? "";
  const problems = /~Moved to/i.test(first) ? [`${def.ldraw.file} is a redirect`] : [];
  if (def.hub) problems.push(...checkWheel(def));
  else problems.push(...checkPart(def, 0), ...checkPart(def, 90).map((p) => `rot90 ${p}`));
  if (def.inferred) inferred.push(def.id);
  if (problems.length) {
    failures++;
    console.log(`✗ ${def.id.padEnd(10)} ${def.name}`);
    for (const p of [...new Set(problems)].slice(0, 6)) console.log(`    ${p}`);
  }
}
console.log(`\nCatalog: ${CATALOG_PARTS.length - failures} of ${CATALOG_PARTS.length} parts match LDraw${failures ? `, ${failures} need fixing` : ""}. ${inferred.length} have anti-studs inferred from geometry (not in the shadow library).`);
process.exit(failures ? 1 : 0);
