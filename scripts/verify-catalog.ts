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
import { CATALOG_PARTS, depthBelow, getPart, SNOT_PARTS, type PartDef } from "../src/lib/parts/library";
import { footprint, worldBottom, worldPins, worldSideStuds, worldStuds } from "../src/lib/model/geometry";
import { frameTransform, ldrawTransform, LDU_PLATE, LDU_STUD, type Mat3 } from "../src/lib/ldraw/export";
import { CONFIG } from "../src/lib/config";
import { compileDesign } from "../src/lib/design/compile";
import type { BrickDesign } from "../src/lib/design/schema";
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
    const exp = { minX: fp.x0 * LDU_STUD, maxX: (fp.x0 + fp.sx) * LDU_STUD, minZ: -(fp.z0 + fp.sz) * LDU_STUD, maxZ: -fp.z0 * LDU_STUD, minY: -fp.y1 * LDU_PLATE, maxY: -(fp.y0 - depthBelow(def)) * LDU_PLATE }; // a baseplate's body reaches 4 LDU below its top
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

/**
 * Side-stud parts: side studs through the exporter (rot 0 and 90), upright studs and
 * anti-studs as for every part, and the body inside the grid box plus extension boxes.
 */
function checkSideParts(def: PartDef): string[] {
  const problems: string[] = [];
  for (const rot of [0, 90] as Rot[]) {
    const pl: Placement = { part: def.id, color: "red", x: 3, y: 4, z: 5, rot };
    const snaps = placedSnaps(pl, def);
    const side = snaps.filter((s) => s.kind === "cyl" && s.gender === "M" && Math.abs((s.secs[0]?.[1] ?? 0) - 6) < 0.01 && Math.abs(s.axis[1]) < 0.01);
    const want = worldSideStuds(pl, def).map((s) => ({ ...s, w: [s.at[0] * LDU_STUD, -s.at[1] * LDU_PLATE, -s.at[2] * LDU_STUD] as V }));
    const outDir = (a: V) => (Math.abs(a[0]) > Math.abs(a[2]) ? (-a[0] > 0 ? "+x" : "-x") : a[2] > 0 ? "+z" : "-z"); // outward = -axis; local z = -Z
    for (const s of side) {
      const hit = want.find((w) => Math.hypot(w.w[0] - s.w[0], w.w[1] - s.w[1], w.w[2] - s.w[2]) < 0.1);
      if (!hit) problems.push(`rot ${rot}: side stud at ${s.w.map((v) => v.toFixed(1))} isn't in the definition`);
      else if (hit.dir !== outDir(s.axis)) problems.push(`rot ${rot}: side stud points ${outDir(s.axis)}, definition says ${hit.dir}`);
    }
    if (want.length !== new Set(side.map((s) => s.w.map((v) => v.toFixed(1)).join())).size) problems.push(`rot ${rot}: ${want.length} side studs defined, ${side.length} in LDraw`);
  }
  // Upright connectors exactly as for other parts (body check below instead of the box check).
  problems.push(...checkPart(def, 0).filter((p) => !/body|height/.test(p)), ...checkPart(def, 90).filter((p) => !/body|height/.test(p)).map((p) => `rot90 ${p}`));
  // Body: every mesh point (side studs excluded) inside the grid box or an extension box, native frame.
  const [ox, oy, oz] = def.ldraw.origin ?? [0, 0, 0];
  const minX = ox - 10 * def.w, maxZ = oz + 10 * def.d, bottom = oy + 8 * def.h;
  const boxes = [[0, 0, 0, def.w * 20, def.h * 8, def.d * 20], ...(def.fine ?? [])];
  const mesh = partMesh(lib, def.ldraw.file, { skipPins: true, keepSideStuds: true });
  const studCyl = shadow.snaps(def.ldraw.file).filter((s) => s.kind === "cyl" && s.gender === "M" && Math.abs(snapAxis(s)[1]) < 0.01).map((s) => ({ p: s.pos, out: snapAxis(s).map((v) => -v) as V }));
  let outside = 0;
  for (let i = 0; i < mesh.tris.length; i += 3) {
    const X = mesh.tris[i], Y = mesh.tris[i + 1], Z = mesh.tris[i + 2];
    if (studCyl.some((c) => {
      const d: V = [X - c.p[0], Y - c.p[1], Z - c.p[2]];
      const t = d[0] * c.out[0] + d[1] * c.out[1] + d[2] * c.out[2];
      return t > -0.5 && t < 5 && Math.hypot(d[0] - t * c.out[0], d[1] - t * c.out[1], d[2] - t * c.out[2]) < 6.6;
    })) continue;
    const x = X - minX, y = bottom - Y, z = maxZ - Z;
    const E = 1.6;
    if (!boxes.some((b) => x >= b[0] - E && x <= b[3] + E && y >= b[1] - E && y <= b[4] + E && z >= b[2] - E && z <= b[5] + E) && !(y > def.h * 8 && y < def.h * 8 + 4.5)) outside++;
  }
  if (outside) problems.push(`${outside} mesh points outside the grid box and extension boxes`);
  return problems;
}

/**
 * Sideways mounts end to end: a panel mounted on each side stud of a carrier,
 * exported to LDraw; the panel's real anti-stud snap must sit on the carrier's
 * real side-stud snap with the same axis (LDCad's mating rule).
 */
function checkMounts(carrier: PartDef): string[] {
  CONFIG.sideways.enabled = true;
  const problems: string[] = [];
  const studs = carrier.sideStuds ?? [];
  studs.forEach((_, k) => {
    for (const spin of [0, 90] as Rot[]) {
      const design: BrickDesign = {
        name: "m",
        description: "",
        subBuilds: [{ id: "panel", name: "Panel", parts: [{ part: "plate_2x2", color: "red", x: 0, y: 0, z: 0, rot: 0 }], uses: [] }],
        main: { parts: [{ part: carrier.id, color: "white", x: 10, y: 10, z: 10, rot: 0 }], uses: [{ sub: "panel", x: 0, y: 0, z: 0, rot: 0, mount: { part: 0, stud: k, at: [1, 1], spin } }] },
      };
      const c = compileDesign(design, { structure: "off" });
      if (c.errors.length) return void problems.push(`stud ${k}: ${c.errors[0].message}`);
      const snapsOf = (i: number) => {
        const pl = c.model.parts[i], def = getPart(pl.part)!;
        const { pos, m } = pl.frame ? frameTransform(pl, def) : ldrawTransform(pl, def);
        return shadow.snaps(def.ldraw.file).map((s) => ({ ...s, w: add(mul(m, s.pos), pos), axis: norm(mul(m, snapAxis(s))) }));
      };
      const side = snapsOf(0).filter((s) => s.gender === "M" && Math.abs(s.axis[1]) < 0.01 && Math.abs((s.secs[0]?.[1] ?? 0) - 6) < 0.01);
      const anti = snapsOf(1).filter((s) => s.gender === "F" && Math.abs((s.secs[0]?.[1] ?? 0) - 6) < 0.01);
      const mated = side.some((s) => anti.some((a) => Math.hypot(a.w[0] - s.w[0], a.w[1] - s.w[1], a.w[2] - s.w[2]) < 0.1 && a.axis.every((v, j) => Math.abs(v - s.axis[j]) < 0.01)));
      if (!mated) problems.push(`stud ${k}, spin ${spin}: the panel's anti-stud doesn't sit on a side stud in LDraw space`);
      if (!c.validation?.valid) problems.push(`stud ${k}, spin ${spin}: ${c.validation?.errors[0]?.message}`);
    }
  });
  return problems;
}

let failures = 0;
const inferred: string[] = [];
for (const def of SNOT_PARTS) {
  const m = checkMounts(def);
  if (m.length) {
    failures++;
    console.log(`✗ ${def.id.padEnd(10)} ${def.name} (sideways mount)`);
    for (const p of [...new Set(m)].slice(0, 4)) console.log(`    ${p}`);
  }
}
console.log(`Sideways mounts: ${SNOT_PARTS.length - failures} of ${SNOT_PARTS.length} carriers mate in LDraw space.`);
for (const def of SNOT_PARTS) {
  const problems = checkSideParts(def);
  if (problems.length) {
    failures++;
    console.log(`✗ ${def.id.padEnd(10)} ${def.name} (side studs)`);
    for (const p of [...new Set(problems)].slice(0, 6)) console.log(`    ${p}`);
  }
}
console.log(`Side-stud parts: ${SNOT_PARTS.length - failures} of ${SNOT_PARTS.length} match LDraw.`);
const sideFailures = failures;
failures = 0;
// Upright parts only (side-stud parts are checked above; their flanges extend past their box by design).
const UPRIGHT = CATALOG_PARTS.filter((p) => !p.snot);
for (const def of UPRIGHT) {
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
console.log(`\nCatalog: ${UPRIGHT.length - failures} of ${UPRIGHT.length} upright parts match LDraw${failures ? `, ${failures} need fixing` : ""}. ${inferred.length} have anti-studs inferred from geometry (not in the shadow library).`);
process.exit(failures || sideFailures ? 1 : 0);
