/**
 * Builds the extended part catalog from the LDraw library (./ldraw-lib/ldraw)
 * and LDCad's shadow library (./ldraw-lib/shadow, CC BY-SA 4.0).
 *
 * For every official, unprinted part it resolves the snap (connection) data,
 * and keeps the part only if every connection is one the validator
 * understands and sits on the grid (see scripts/lib/classify.ts). Wheels are
 * rim + tyre assemblies from a curated list, framed so their hub lands on a
 * holder's pin. Near-duplicates (same connections and shape, e.g. "with/without
 * bottom tube" variants) are merged, left/right versions are paired.
 *
 * Writes:
 *   src/lib/parts/catalog.json       part definitions (loaded by the app)
 *   public/parts/<id>.bin            meshes for the 3D viewer (loaded on demand)
 *   ldraw-lib/catalog-report.txt     what was kept, merged and rejected, and why
 *
 * Usage: npm run build-catalog     (then npm run verify-ldraw)
 */
import fs from "node:fs";
import path from "node:path";
import { yawMatrix, type Mat3 } from "../src/lib/ldraw/export";
import { CORE_PARTS as CORE } from "../src/lib/parts/library";
import type { CatalogEntry } from "../src/lib/parts/catalogTypes";
import { openLibrary, type V } from "./lib/ldrawGeo";
import { partMesh } from "./lib/ldrawMesh";
import { openShadow, snapAxis } from "./lib/snaps";
import { classify, hubKind, voxelize, type Classified, type PinKind } from "./lib/classify";
import { classifySideways, type SideClassified } from "./lib/classifySide";

const ROOT = path.resolve("ldraw-lib/ldraw");
const OUT_JSON = path.resolve("src/lib/parts/catalog.json");
const OUT_MESH = path.resolve("public/parts");
const REPORT = path.resolve("ldraw-lib/catalog-report.txt");
const lib = openLibrary(ROOT);
const shadow = openShadow(ROOT, path.resolve("ldraw-lib/shadow"));

/** Pin geometry per kind, in local units: where a pin leaves the body relative to the grid. */
export const PIN_FRACTION: Record<PinKind, { out: number; y: number }> = {
  wpin: { out: 0.1, y: 0.375 }, // classic wheel pins: 2 LDU out from the side, 3 LDU above the plate's bottom
  tpin: { out: 0, y: 0.75 }, // Technic pins: flush with the side, 6 LDU above a plate line
};

/** Wheels: rim + tyre assemblies (LDraw "c01" files), by pin kind. */
const WHEELS: { file: string; kind: PinKind; name: string; tyre: string; rim: string }[] = [
  { file: "4624c01.dat", kind: "wpin", name: "Wheel small (rim 6.4×8, tyre Ø14 mm)", rim: "4624", tyre: "3641" },
  { file: "50944c01.dat", kind: "wpin", name: "Wheel medium (5-spoke rim 6.4×11, tyre Ø17 mm)", rim: "50944", tyre: "51011" },
  { file: "11208c01.dat", kind: "wpin", name: "Wheel large (6-spoke rim 10×14, tyre Ø21 mm)", rim: "11208", tyre: "11209" },
  { file: "42610c01.dat", kind: "tpin", name: "Wheel on Technic pin, small (rim 8×11.2, tyre Ø17 mm)", rim: "42610", tyre: "50951" },
  { file: "56902c01.dat", kind: "tpin", name: "Wheel on Technic pin, medium (rim 8×18, tyre Ø24 mm)", rim: "56902", tyre: "56891" },
  { file: "55981c01.dat", kind: "tpin", name: "Wheel on Technic pin, large (rim 14×18, tyre Ø30 mm)", rim: "55981", tyre: "58090" },
];

/**
 * Baseplates: thin (4 LDU, half a plate), studs on top, nothing underneath. The general
 * classifier can't frame them (bodies must be whole plates), so these are framed by hand:
 * height 0 on the grid, top surface at y = 0, the body below it. Other baseplates (raised,
 * road, printed) stay excluded.
 */
const BASEPLATES: { file: string; w: number; d: number }[] = [
  { file: "3867.dat", w: 16, d: 16 },
  { file: "3334.dat", w: 24, d: 16 },
  { file: "3811.dat", w: 32, d: 32 },
  { file: "3645.dat", w: 40, d: 24 },
  { file: "4186.dat", w: 48, d: 48 },
];

/** Parts we never want: prints, stickers, aliases, minifig/Duplo/other systems, moved or obsolete files. */
function excluded(file: string, title: string, lines: string[]): string | null {
  if (/^[~=_|]/.test(title)) return "alias, moved or shortcut";
  if (/p[0-9a-z]{2,4}\.dat$/i.test(file)) return "printed";
  if (/c\d\d\.dat$/i.test(file) && !/^(window|door|windscreen)/i.test(title)) return "assembly";
  if (/(pattern|sticker|print|decorat|logo)/i.test(title)) return "printed";
  if (/(minifig|duplo|primo|quatro|znap|fabuland|scala|belville|clikits|homemaker|galidor|jack stone|baseplate|mursten|electric|string|hose|cable|chain|flex|obsolete)/i.test(title)) return "other system";
  if (lines.some((l) => /^0\s+!LDRAW_ORG\s+(Unofficial|Shortcut|Configuration|Helper|Primitive|Subpart|Alias)/i.test(l))) return "not a part";
  if (lines.some((l) => /^0\s+!CATEGORY\s+(Minifig|Duplo|Sticker|Figure|Animal|Znap|Electric)/i.test(l))) return "other system";
  return null;
}

function category(title: string, c: { pins: unknown[] }): string {
  const t = title.replace(/\s+/g, " ");
  if (c.pins.length) return "holder";
  if (/^(Brick|Plate|Tile).*\bRound\b|^Cylinder|^Dish/i.test(t)) return "round";
  if (/^Slope Brick Curved|^Slope.*Curved/i.test(t)) return "curved";
  if (/^Slope/i.test(t)) return "slope";
  if (/^(Wedge|Wing)/i.test(t)) return "wedge";
  if (/^Brick/i.test(t)) return "brick";
  if (/^Plate/i.test(t)) return "plate";
  if (/^Tile/i.test(t)) return "tile";
  if (/^Arch/i.test(t)) return "arch";
  if (/^Windscreen|^Cockpit/i.test(t)) return "windscreen";
  if (/^(Window|Glass)/i.test(t)) return "window";
  if (/^Door/i.test(t)) return "door";
  if (/^Panel/i.test(t)) return "panel";
  if (/^Fence/i.test(t)) return "fence";
  if (/^Cone/i.test(t)) return "cone";
  if (/^Technic/i.test(t)) return "technic";
  if (/^(Car|Vehicle|Train|Boat|Plane|Tail|Propeller|Tipper)/i.test(t)) return "vehicle";
  return "other";
}

const tidy = (title: string) => title.replace(/\s+/g, " ").replace(/(\d) x (\d)/g, "$1×$2").replace(/(\d) x (\d)/g, "$1×$2").trim();

/** Greedy merge of filled voxels into boxes [x0, z0, x1, z1, y0, y1]. */
function boxes(v: boolean[], w: number, d: number, h: number): [number, number, number, number, number, number][] {
  const left = [...v];
  const at = (x: number, z: number, y: number) => left[x + w * (z + d * y)];
  const out: [number, number, number, number, number, number][] = [];
  for (let y = 0; y < h; y++)
    for (let z = 0; z < d; z++)
      for (let x = 0; x < w; x++) {
        if (!at(x, z, y)) continue;
        let x1 = x + 1;
        while (x1 < w && at(x1, z, y)) x1++;
        let z1 = z + 1;
        while (z1 < d && [...Array(x1 - x).keys()].every((i) => at(x + i, z1, y))) z1++;
        let y1 = y + 1;
        while (y1 < h && [...Array(x1 - x).keys()].every((i) => [...Array(z1 - z).keys()].every((j) => at(x + i, z + j, y1)))) y1++;
        for (let yy = y; yy < y1; yy++) for (let zz = z; zz < z1; zz++) for (let xx = x; xx < x1; xx++) left[xx + w * (zz + d * yy)] = false;
        out.push([x, z, x1, z1, y, y1]);
      }
  return out;
}

/**
 * Compact binary mesh (format in src/lib/parts/meshFormat.ts): "BFM2", u32 vertex count,
 * u32 index count, u32 group count, groups (i32 LDraw colour, u32 first index, u32 index
 * count; colour 16 = the part's colour), int16 xyz (¼ LDU, local frame), u16/u32 indices.
 */
function meshBin(tris: number[], colors: number[], toLocal: (X: number, Y: number, Z: number) => [number, number, number]): Buffer {
  const index = new Map<string, number>();
  const verts: number[] = [];
  const byColor = new Map<number, number[]>();
  for (let t = 0; t < tris.length / 9; t++) {
    const tri: number[] = [];
    for (let k = 0; k < 3; k++) {
      const i = t * 9 + k * 3;
      const [x, y, z] = toLocal(tris[i], tris[i + 1], tris[i + 2]).map((n) => Math.round(n * 4));
      const key = `${x},${y},${z}`;
      let n = index.get(key);
      if (n === undefined) (n = verts.length / 3), index.set(key, n), verts.push(x, y, z);
      tri.push(n);
    }
    // Drop degenerate triangles (vertices merged by quantisation).
    if (tri[0] === tri[1] || tri[1] === tri[2] || tri[0] === tri[2]) continue;
    const c = colors[t] ?? 16;
    (byColor.get(c) ?? byColor.set(c, []).get(c)!).push(...tri);
  }
  const groups = [...byColor].sort((a, b) => (a[0] === 16 ? -1 : b[0] === 16 ? 1 : a[0] - b[0]));
  const clean = groups.flatMap(([, idx]) => idx);
  const nv = verts.length / 3, big = nv > 65535;
  const head = 16 + groups.length * 12;
  const buf = Buffer.alloc(head + nv * 6 + ((head + nv * 6) % 4) + clean.length * (big ? 4 : 2));
  buf.write("BFM2", 0, "ascii");
  buf.writeUInt32LE(nv, 4);
  buf.writeUInt32LE(clean.length, 8);
  buf.writeUInt32LE(groups.length, 12);
  let o = 16, start = 0;
  for (const [c, idx] of groups) {
    buf.writeInt32LE(c, o);
    buf.writeUInt32LE(start, o + 4);
    buf.writeUInt32LE(idx.length, o + 8);
    (o += 12), (start += idx.length);
  }
  for (const n of verts) (buf.writeInt16LE(n, o), (o += 2));
  o += (head + nv * 6) % 4; // align indices to 4 bytes
  for (const n of clean) big ? (buf.writeUInt32LE(n, o), (o += 4)) : (buf.writeUInt16LE(n, o), (o += 2));
  return buf;
}

const mulV = (m: Mat3, v: V): V => [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]];
const transpose = (m: Mat3): Mat3 => [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];
const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** A wheel: rotate so its hub opens toward -x, then frame it so the hub lands on a pin of its kind. */
function buildWheel(spec: (typeof WHEELS)[number]): { entry: CatalogEntry; bin: Buffer } {
  const mesh = partMesh(lib, spec.file);
  if (mesh.missing.size) throw new Error(`${spec.file}: missing ${[...mesh.missing].join(", ")}`);
  const cx = (mesh.min[0] + mesh.max[0]) / 2, cy = (mesh.min[1] + mesh.max[1]) / 2;
  const hubs = shadow.snaps(spec.file).filter((s) => s.kind === "cyl" && s.gender === "F" && Math.abs(snapAxis(s)[1]) < 0.01 && hubKind(s) === spec.kind);
  // The hub on the wheel's axis (rims also have pegholes around it).
  const hub = hubs.sort((a, b) => Math.hypot(a.pos[0] - cx, a.pos[1] - cy) - Math.hypot(b.pos[0] - cx, b.pos[1] - cy))[0];
  if (!hub || Math.hypot(hub.pos[0] - cx, hub.pos[1] - cy) > 0.5) throw new Error(`${spec.file}: no ${spec.kind} hub on the axis`);
  const open = snapAxis(hub); // the hole opens toward +axis
  const yaw = ([0, 90, 180, 270] as const).find((y) => {
    const a = mulV(yawMatrix(y), open);
    return a[0] < -0.99;
  });
  if (yaw === undefined) throw new Error(`${spec.file}: hub axis isn't horizontal`);
  const R = yawMatrix(yaw);
  const tris: number[] = [];
  for (let i = 0; i < mesh.tris.length; i += 3) tris.push(...mulV(R, [mesh.tris[i], mesh.tris[i + 1], mesh.tris[i + 2]]));
  const min: V = [Infinity, Infinity, Infinity], max: V = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < tris.length; i += 3) for (let a = 0; a < 3; a++) (min[a] = Math.min(min[a], tris[i + a]), (max[a] = Math.max(max[a], tris[i + a])));
  const H = mulV(R, hub.pos);
  const f = PIN_FRACTION[spec.kind];
  // x: the wheel's inner face sits flush on the pin's base (local x = f.out).
  const X0 = min[0] - 20 * f.out;
  const w = Math.ceil(f.out + (max[0] - min[0]) / 20 - 1e-6);
  // y: axis at local f.y + k, lowest point ≥ 0.
  const Ry = Math.max(max[1] - H[1], H[1] - min[1]) / 8;
  const axisY = f.y + Math.ceil(Ry - f.y - 1e-6);
  const h = Math.ceil(axisY + Ry - 1e-6);
  const Ybottom = H[1] + 8 * axisY;
  // z: axis on a cell boundary.
  const Rz = Math.max(max[2] - H[2], H[2] - min[2]) / 20;
  const kz = Math.ceil(Rz - 1e-6);
  const d = 2 * kz;
  const Zmax = H[2] + 20 * kz;
  const toLocal = (X: number, Y: number, Z: number): [number, number, number] => [(X - X0) / 20, (Ybottom - Y) / 8, (Zmax - Z) / 20];
  const vox = voxelize(tris, w, d, h, (X, Y, Z) => {
    const [x, y, z] = toLocal(X, Y, Z);
    return [x, y, z];
  });
  const topCentre: V = [X0 + 10 * w, Ybottom - 8 * h, Zmax - 10 * d];
  const origin = mulV(transpose(R), topCentre).map(r3) as V;
  const id = spec.file.replace(/\.dat$/, "");
  const entry: CatalogEntry = {
    id,
    name: spec.name,
    cat: "wheel",
    w,
    d,
    h,
    studs: [],
    bottom: [],
    solids: boxes(vox, w, d, h),
    hub: { kind: spec.kind, at: [f.out, r3(axisY), kz], dir: "-x" },
    mass: r3(vox.filter(Boolean).length / vox.length),
    ldraw: { file: spec.file, yaw, origin },
    bricklink: [{ id: spec.rim }, { id: spec.tyre, color: 11 }],
    hint: `mounts on a ${spec.kind === "wpin" ? "wheel pin (e.g. plate 2×2 with wheel pins, 4600)" : "Technic pin (e.g. brick 2×4 with pins, 6249)"}; rot 0 = hub facing -x (right-hand side), rot 180 for the left`,
  };
  const binTris: number[] = [];
  for (let i = 0; i < tris.length; i += 3) binTris.push(...toLocal(tris[i], tris[i + 1], tris[i + 2]).map((n, k) => n * (k === 1 ? 8 : 20)));
  return { entry, bin: meshBin(binTris, mesh.colors, (x, y, z) => [x, y, z]) };
}

/** A baseplate (see BASEPLATES): checked against its real studs and thickness, framed with its top at y = 0. */
function buildBaseplate(spec: (typeof BASEPLATES)[number]): { entry: CatalogEntry; bin: Buffer } {
  const mesh = partMesh(lib, spec.file);
  if (mesh.missing.size) throw new Error(`${spec.file}: missing ${[...mesh.missing].join(", ")}`);
  const [minX, minY, minZ] = mesh.min, [maxX, maxY, maxZ] = mesh.max;
  const w = (maxX - minX) / 20, d = (maxZ - minZ) / 20;
  // LDraw files are centred; some are long along z, so turn those to lie along x like our w × d.
  if (!(w === spec.w && d === spec.d) && !(w === spec.d && d === spec.w)) throw new Error(`${spec.file}: ${w}×${d} studs, expected ${spec.w}×${spec.d}`);
  const yaw = w === spec.w ? 0 : 90;
  if (Math.abs(minY) > 0.01 || Math.abs(maxY - 4) > 0.01) throw new Error(`${spec.file}: expected the top at Y 0 and the body to Y 4, got ${minY}..${maxY}`);
  const R = yawMatrix(yaw);
  const tris: number[] = [];
  for (let i = 0; i < mesh.tris.length; i += 3) tris.push(...mulV(R, [mesh.tris[i], mesh.tris[i + 1], mesh.tris[i + 2]]));
  void minZ;
  const id = spec.file.replace(/\.dat$/, "");
  const title = tidy((lib.readLines(spec.file)?.[0] ?? "").replace(/^0\s*/, ""));
  const entry: CatalogEntry = {
    id,
    name: title,
    cat: "baseplate",
    w: spec.w,
    d: spec.d,
    h: 0,
    bottom: [],
    solids: [],
    mass: 0.5,
    ldraw: { file: spec.file, yaw, origin: [0, 0, 0] },
    hint: `ground layer: top at y = 0, studs on top only, nothing below; parts at y = 0 stand on its studs. Must lie at y = 0 in the main build.`,
  };
  const binTris: number[] = [];
  for (let i = 0; i < tris.length; i += 3) binTris.push(tris[i] + 10 * spec.w, -tris[i + 1], 10 * spec.d - tris[i + 2]);
  return { entry, bin: meshBin(binTris, mesh.colors, (x, y, z) => [x, y, z]) };
}

function entryFor(c: Classified, id: string): CatalogEntry {
  const all = (cs: { cell: [number, number] }[]) => cs.length === c.w * c.d;
  const studsAllTop = c.studs.length === c.w * c.d && c.studs.every((s) => s.level === c.h);
  const bottomAllZero = c.bottom.length === c.w * c.d && c.bottom.every((s) => s.level === 0);
  const vox = c.voxels;
  const full = vox.every(Boolean);
  void all;
  return {
    id,
    name: tidy(c.title),
    cat: category(c.title, c),
    w: c.w,
    d: c.d,
    h: c.h,
    ...(studsAllTop ? {} : { studs: c.studs.map((s) => (s.level === c.h ? [...s.cell] : [...s.cell, s.level]) as [number, number] | [number, number, number]) }),
    ...(bottomAllZero ? {} : { bottom: c.bottom.map((s) => (s.level === 0 ? [...s.cell] : [...s.cell, s.level]) as [number, number] | [number, number, number]) }),
    ...(full ? {} : { solids: boxes(vox, c.w, c.d, c.h) }),
    ...(c.pins.length ? { pins: c.pins } : {}),
    mass: r3(vox.filter(Boolean).length / vox.length),
    ldraw: { file: c.file, yaw: 0, origin: c.origin },
    ...(c.inferred ? { inferred: true } : {}),
    ...("sideStuds" in c ? { snot: true, sideStuds: (c as SideClassified).sideStuds, ...((c as SideClassified).fine.length ? { fine: (c as SideClassified).fine } : {}) } : {}),
  };
}

/** Pins must sit where a grid-placed wheel's hub can reach them. */
function pinsOnGrid(c: Classified): boolean {
  const frac = (n: number) => ((n % 1) + 1) % 1;
  const eq = (a: number, b: number) => Math.abs(frac(a) - frac(b)) < 0.01 || Math.abs(Math.abs(frac(a) - frac(b)) - 1) < 0.01;
  return c.pins.every((p) => {
    const f = PIN_FRACTION[p.kind];
    const [x, y, z] = p.at;
    if (!eq(y, f.y)) return false;
    if (p.dir === "+x") return eq(x, f.out) && eq(z, 0);
    if (p.dir === "-x") return eq(x, -f.out) && eq(z, 0);
    if (p.dir === "+z") return eq(z, f.out) && eq(x, 0);
    return eq(z, -f.out) && eq(x, 0);
  });
}

// ---------------------------------------------------------------------------------------------

const coreFiles = new Set(CORE.flatMap((p) => [p.ldraw.file.toLowerCase(), ...(p.ldraw.extra ?? []).map((e) => e.file.toLowerCase())]));
const files = fs.readdirSync(path.join(ROOT, "parts")).filter((f) => f.toLowerCase().endsWith(".dat"));
const rejected = new Map<string, string[]>();
const reject = (reason: string, what: string) => (rejected.get(reason) ?? rejected.set(reason, []).get(reason)!).push(what);
const kept: Classified[] = [];
const coreCheck: string[] = [];
const t0 = Date.now();

for (const f of files) {
  const lines = lib.readLines(f) ?? [];
  const title = (lines[0] ?? "").replace(/^0\s*/, "").trim();
  const lower = f.toLowerCase();
  const isCore = coreFiles.has(lower);
  const ex = isCore ? null : excluded(f, title, lines);
  if (ex) {
    reject(`excluded: ${ex}`, f);
    continue;
  }
  let r = classify(lib, shadow.snaps(f), f, title);
  // Parts with studs on their sides (carriers for sideways building) go through their own
  // classifier, only when the normal one rejects them, so upright parts are unaffected.
  if (!r.ok && !isCore && (r.reason === "not on the grid" || (r.reason === "unsupported connection" && /sideways/.test(r.detail ?? "")))) {
    const s = classifySideways(lib, shadow.snaps(f), f, title);
    if (s.ok) r = s;
  }
  if (isCore) {
    // Cross-check the derivation against the hand-made core definitions.
    const def = CORE.find((p) => p.ldraw.file.toLowerCase() === lower);
    if (def && r.ok) {
      const c = r.part;
      const [w, d] = def.ldraw.yaw === 90 || def.ldraw.yaw === 270 ? [def.d, def.w] : [def.w, def.d];
      const studs = (def.studs ?? [...Array(def.w * def.d).keys()].map((i) => [i % def.w, Math.floor(i / def.w)] as [number, number])).map(([x, z]) => `${x},${z}`).sort().join(" ");
      const got = c.studs.filter((s) => s.level === c.h).map((s) => s.cell.join(",")).sort().join(" ");
      const same = c.w === w && c.d === d && c.h === def.h && (def.ldraw.yaw ? true : got === studs);
      coreCheck.push(`${same ? "✓" : "✗"} ${def.id.padEnd(18)} ${f.padEnd(14)} ours ${def.w}×${def.d}×${def.h} [${studs}]  derived ${c.w}×${c.d}×${c.h} [${got}]`);
    } else if (def) coreCheck.push(`- ${def.id.padEnd(18)} ${f.padEnd(14)} not derivable: ${r.ok ? "" : `${r.reason} ${r.detail ?? ""}`}`);
    continue;
  }
  if (!r.ok) {
    reject(r.reason, `${f} ${r.detail ?? ""}`);
    continue;
  }
  if (r.part.pins.length && !pinsOnGrid(r.part)) {
    reject("pins off the wheel grid", f);
    continue;
  }
  kept.push(r.part);
}

// Merge near-duplicates: same size, connections and shape, and the same kind of part once
// dimensions and "with/without …" qualifiers are dropped from the title. Shortest title wins.
const baseName = (t: string) =>
  t
    .toLowerCase()
    .replace(/\(.*?\)/g, "")
    .replace(/\b(with|without|w\/|and)\b.*$/, "")
    .replace(/[\d.]+\s*x\s*[\d.]+(\s*x\s*[\d.]+)?/g, "")
    .replace(/\b(type|version|old|new|reinforced|hollow|solid|open|closed)\b.*$/, "")
    .replace(/\s+/g, " ")
    .trim();
const sigOf = (c: Classified) =>
  JSON.stringify([c.w, c.d, c.h, c.studs, c.bottom, c.voxels, c.pins, baseName(c.title), /left/i.test(c.title), /right/i.test(c.title), ...("sideStuds" in c ? [(c as SideClassified).sideStuds, (c as SideClassified).fine] : [])]);
const groups = new Map<string, Classified[]>();
for (const c of kept) (groups.get(sigOf(c)) ?? groups.set(sigOf(c), []).get(sigOf(c))!).push(c);
const unique: Classified[] = [];
const merged: string[] = [];
for (const g of groups.values()) {
  g.sort((a, b) => a.title.length - b.title.length || b.file.localeCompare(a.file));
  unique.push(g[0]);
  if (g.length > 1) merged.push(`${g[0].file} ← ${g.slice(1).map((c) => c.file).join(" ")}`);
}

fs.rmSync(OUT_MESH, { recursive: true, force: true });
fs.mkdirSync(OUT_MESH, { recursive: true });
const entries: CatalogEntry[] = [];
let meshBytes = 0;
for (const c of unique.sort((a, b) => a.file.localeCompare(b.file, "en", { numeric: true }))) {
  const id = c.file.replace(/\.dat$/i, "").toLowerCase();
  const e = entryFor(c, id);
  entries.push(e);
  const [minX, , , , maxY, maxZ] = [c.min[0], c.min[1], c.min[2], c.max[0], c.max[1], c.max[2]];
  const bin = meshBin(c.mesh.tris, c.mesh.colors, (X, Y, Z) => [X - minX, maxY - Y, maxZ - Z]);
  fs.writeFileSync(path.join(OUT_MESH, `${id}.bin`), bin);
  meshBytes += bin.length;
}
for (const spec of WHEELS) {
  const { entry, bin } = buildWheel(spec);
  entries.push(entry);
  fs.writeFileSync(path.join(OUT_MESH, `${entry.id}.bin`), bin);
  meshBytes += bin.length;
}
for (const spec of BASEPLATES) {
  const { entry, bin } = buildBaseplate(spec);
  entries.push(entry);
  fs.writeFileSync(path.join(OUT_MESH, `${entry.id}.bin`), bin);
  meshBytes += bin.length;
}

// Left/right pairs: from the titles, confirmed by LDCad's MIRROR_INFO where present.
const byId = new Map(entries.map((e) => [e.id, e]));
const swapLR = (t: string) => t.replace(/\b(Left|Right)\b/g, (m) => (m === "Left" ? "Right" : "Left"));
const byName = new Map(entries.map((e) => [e.name, e]));
for (const e of entries) {
  const counter = shadow.mirrorInfo(e.ldraw.file).find((m) => m.counterpart && m.counterpart !== "self")?.counterpart;
  const other = counter ? byId.get(counter.replace(/\.dat$/i, "").toLowerCase()) : /\b(Left|Right)\b/.test(e.name) ? byName.get(swapLR(e.name)) : undefined;
  if (other && other.id !== e.id) e.mirror = other.id;
}

fs.writeFileSync(OUT_JSON, JSON.stringify({ generated: new Date().toISOString().slice(0, 10), source: "LDraw parts library + LDCad shadow library (CC BY-SA 4.0)", parts: entries }) + "\n");

// --- report ---------------------------------------------------------------------------------
const byCat = new Map<string, number>();
for (const e of entries) byCat.set(e.cat, (byCat.get(e.cat) ?? 0) + 1);
const lines: string[] = [];
lines.push(`Catalog: ${entries.length} parts (${unique.length} from ${kept.length} usable after merging near-duplicates, + ${WHEELS.length} wheels, + ${BASEPLATES.length} baseplates), ${files.length} LDraw files scanned in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
lines.push(`Meshes: ${(meshBytes / 1e6).toFixed(1)} MB in public/parts/`);
lines.push(`By category: ${[...byCat].sort((a, b) => b[1] - a[1]).map(([c, n]) => `${c} ${n}`).join(", ")}`);
lines.push(`Left/right pairs: ${entries.filter((e) => e.mirror).length / 2}`);
lines.push(`Anti-studs inferred from geometry (no shadow data): ${entries.filter((e) => e.inferred).length}`);
lines.push(`Side-stud parts for sideways building (loaded only when CONFIG.sideways.enabled): ${entries.filter((e) => e.snot).length}: ${entries.filter((e) => e.snot).map((e) => e.id).join(" ")}`);
lines.push("\nRejected:");
for (const [k, v] of [...rejected].sort((a, b) => b[1].length - a[1].length)) lines.push(`  ${String(v.length).padStart(6)}  ${k}`);
lines.push("\nCore parts, derived from LDraw + shadow data vs the hand-made definitions:");
lines.push(...coreCheck.map((l) => `  ${l}`));
lines.push("\nMerged near-duplicates (kept ← merged):", ...merged.map((m) => `  ${m}`));
for (const [k, v] of [...rejected].sort((a, b) => b[1].length - a[1].length)) {
  if (k.startsWith("excluded")) continue;
  lines.push(`\n${k}:`, ...v.map((x) => `  ${x}`));
}
fs.writeFileSync(REPORT, lines.join("\n") + "\n");
console.log(lines.slice(0, 8 + rejected.size + 2 + coreCheck.length).join("\n"));
