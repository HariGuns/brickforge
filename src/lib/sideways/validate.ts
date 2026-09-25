/**
 * The validator's extra pass for sideways building. It runs only when the model
 * has sideways parts, side studs or bracket flanges, so upright models are
 * checked exactly as before. Connections are matched by exact position and
 * facing (a stud and an anti-stud at the same point, facing each other);
 * collisions are checked on exact boxes in LDU.
 */
import { describe, type Resolved } from "../model/geometry";
import type { BrickModel } from "../model/schema";
import type { Connection, Issue } from "../validate/validator";
import { uprightFrame, worldBoxes, worldConnectors, type Box, type V3 } from "./frame";

const q = (v: V3) => v.map((n) => Math.round(n * 4) / 4).join(",");
const qd = (v: V3) => v.map((n) => Math.round(n)).join(",");

export function needsSidewaysPass(ok: Resolved[]): boolean {
  return ok.some((r) => r.pl.frame || r.def.sideStuds?.length || r.def.fine?.length);
}

export function sidewaysPass(ok: Resolved[], parts: BrickModel["parts"], grid: { x: number; z: number; y: number }): { connections: Connection[]; errors: Issue[] } {
  const errors: Issue[] = [];
  // --- bounds for sideways parts ---
  for (const r of ok) {
    if (!r.pl.frame) continue;
    for (const [x0, y0, z0, x1, y1, z1] of worldBoxes(r.pl, r.def)) {
      if (x0 < -0.5 || z0 < -0.5 || y0 < -0.5 || x1 > grid.x * 20 + 0.5 || z1 > grid.z * 20 + 0.5 || y1 > grid.y * 8 + 0.5) {
        errors.push({ code: "OUT_OF_BOUNDS", severity: "error", parts: [r.index], message: `${describe(r.pl, r.index)} (sideways) reaches outside the build area.` });
        break;
      }
    }
  }

  // --- connections involving side studs or sideways parts ---
  const anti = new Map<string, { index: number; framed: boolean }[]>();
  for (const r of ok) for (const a of worldConnectors(r.pl, r.def).anti) (anti.get(`${q(a.p)}|${qd(a.d)}`) ?? anti.set(`${q(a.p)}|${qd(a.d)}`, []).get(`${q(a.p)}|${qd(a.d)}`)!).push({ index: r.index, framed: !!r.pl.frame });
  const pairs = new Map<string, Connection>();
  for (const r of ok) {
    const framed = !!r.pl.frame;
    for (const s of worldConnectors(r.pl, r.def).studs) {
      const hits = anti.get(`${q(s.p)}|${qd([-s.d[0], -s.d[1], -s.d[2]])}`) ?? [];
      for (const h of hits) {
        // Upright stud → upright anti-stud is the normal pass's job.
        if (h.index === r.index || (!s.side && !framed && !h.framed)) continue;
        const k = `${r.index}:${h.index}`;
        const c = pairs.get(k) ?? pairs.set(k, { lower: r.index, upper: h.index, studs: 0, kind: "side" }).get(k)!;
        c.studs++;
      }
    }
  }

  // --- exact collisions where sideways parts or bracket flanges are involved ---
  const all: { index: number; box: Box; special: boolean }[] = [];
  for (const r of ok) {
    const framed = !!r.pl.frame;
    const coarse = framed ? worldBoxes(r.pl, r.def) : worldBoxes({ ...r.pl, frame: uprightFrame(r.pl, r.def) }, { ...r.def, fine: undefined });
    for (const b of coarse) all.push({ index: r.index, box: b, special: framed });
    if (!framed) for (const b of worldBoxes(r.pl, r.def, { fineOnly: true })) all.push({ index: r.index, box: b, special: true });
  }
  const cell = 40;
  const hash = new Map<string, number[]>();
  all.forEach((e, i) => {
    const [x0, y0, z0, x1, y1, z1] = e.box;
    for (let x = Math.floor(x0 / cell); x <= Math.floor(x1 / cell); x++)
      for (let y = Math.floor(y0 / cell); y <= Math.floor(y1 / cell); y++)
        for (let z = Math.floor(z0 / cell); z <= Math.floor(z1 / cell); z++) (hash.get(`${x},${y},${z}`) ?? hash.set(`${x},${y},${z}`, []).get(`${x},${y},${z}`)!).push(i);
  });
  const E = 0.6; // faces that touch aren't an overlap
  const overlap = (a: Box, b: Box) => a[0] < b[3] - E && b[0] < a[3] - E && a[1] < b[4] - E && b[1] < a[4] - E && a[2] < b[5] - E && b[2] < a[5] - E;
  const reported = new Set<string>();
  all.forEach((e, i) => {
    if (!e.special) return;
    const [x0, y0, z0, x1, y1, z1] = e.box;
    const seen = new Set<number>();
    for (let x = Math.floor(x0 / cell); x <= Math.floor(x1 / cell); x++)
      for (let y = Math.floor(y0 / cell); y <= Math.floor(y1 / cell); y++)
        for (let z = Math.floor(z0 / cell); z <= Math.floor(z1 / cell); z++)
          for (const j of hash.get(`${x},${y},${z}`) ?? []) {
            if (seen.has(j)) continue;
            seen.add(j);
            const o = all[j];
            if (o.index === e.index || !overlap(e.box, o.box)) continue;
            const k = [e.index, o.index].sort((a, b) => a - b).join(":");
            if (reported.has(k)) continue;
            reported.add(k);
            const [a, b] = k.split(":").map(Number);
            errors.push({ code: "OVERLAP", severity: "error", parts: [a, b], message: `${describe(parts[a], a)} and ${describe(parts[b], b)} overlap (exact check: sideways part or bracket flange).` });
          }
  });
  return { connections: [...pairs.values()], errors };
}
