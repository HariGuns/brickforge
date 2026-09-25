import { describe, expect, it } from "vitest";
import { CATALOG_PARTS, CORE_PARTS, getPart, localBottom, localStuds, PARTS, SNOT_PARTS } from "./library";
import { CORE_MENU_CATALOG } from "./core";
import { coreMenu, searchParts } from "./search";
import { validate } from "../validate/validator";
import { mountsFor, wheelMount } from "./wheels";
import { worldPins } from "../model/geometry";
import { buildSteps, checkStepOrder } from "../steps/steps";
import type { BrickModel, Placement } from "../model/schema";
import { catalogUsage } from "./usage";
import { P } from "../fixtures/samples";

const model = (parts: Placement[]): BrickModel => ({ name: "t", description: "", parts });

describe("part catalog", () => {
  it("has ~900 generated parts with unique ids and sane connection data", () => {
    expect(CATALOG_PARTS.length).toBeGreaterThan(850);
    expect(new Set(PARTS.map((p) => p.id)).size).toBe(PARTS.length);
    for (const p of CATALOG_PARTS) {
      for (const [x, z, l] of localStuds(p)) expect(x >= 0 && z >= 0 && x < p.w && z < p.d && l >= 1 && l <= p.h, `${p.id} stud`).toBe(true);
      for (const [x, z, l] of localBottom(p)) expect(x >= 0 && z >= 0 && x < p.w && z < p.d && l >= 0 && l < p.h, `${p.id} anti-stud`).toBe(true);
      if (!p.hub) expect(localBottom(p).length, `${p.id} can be attached from below`).toBeGreaterThan(0);
    }
  });

  it("has a core menu of 100-150 parts that all exist", () => {
    expect(CORE_MENU_CATALOG.filter((id) => !getPart(id) && !SNOT_PARTS.some((p) => p.id === id))).toEqual([]); // side-stud carriers only while sideways is on
    expect(coreMenu().length).toBeGreaterThanOrEqual(100);
    expect(coreMenu().length).toBeLessThanOrEqual(150);
    expect(coreMenu().slice(0, CORE_PARTS.length)).toEqual(CORE_PARTS);
  });

  it("pairs left and right versions both ways", () => {
    const paired = CATALOG_PARTS.filter((p) => p.mirror);
    expect(paired.length).toBeGreaterThan(20);
    for (const p of paired) expect(getPart(p.mirror!)?.mirror, p.id).toBe(p.id);
  });

  it("finds parts by kind and size", () => {
    expect(searchParts("wheel pins plate").map((p) => p.id)).toContain("4600");
    expect(searchParts("windscreen 2x4").map((p) => p.id)).toContain("3823");
    expect(searchParts("curved slope").some((p) => p.category === "curved")).toBe(true);
    expect(searchParts("mudguard").every((p) => /mudguard/i.test(p.name))).toBe(true);
  });
});

describe("wheels on pins", () => {
  // A 2×4 plate with a 2×2 wheel-pin plate hung under it, and two small wheels.
  const holder = P("4600", "black", 1, 2, 0);
  const chassis = P("plate_2x4", "red", 1, 3, 0, 90); // on the holder: 2 wide (x), 4 deep (z)
  const right = { ...P("4624c01", "white", 0, 0, 0), ...mountsFor(holder, "4624c01").find((m) => m.pin.dir === "+x")!.at };
  const left = { ...P("4624c01", "white", 0, 0, 0), ...mountsFor(holder, "4624c01").find((m) => m.pin.dir === "-x")!.at };

  it("attaches a wheel whose hub sits on a free pin, and counts it as support", () => {
    const r = validate(model([holder, chassis, right, left]));
    expect(r.errors).toEqual([]);
    expect(r.connections.filter((c) => c.kind === "pin")).toEqual([
      { lower: 2, upper: 0, studs: 2, kind: "pin" },
      { lower: 3, upper: 0, studs: 2, kind: "pin" },
    ]);
  });

  it("reports a wheel off its pin with the exact placement to use", () => {
    const off = { ...right, x: right.x + 1 };
    const r = validate(model([holder, chassis, off]));
    const e = r.errors.find((x) => x.code === "LOOSE_WHEEL")!;
    expect(e.parts).toEqual([2]);
    expect(e.message).toContain(`x=${right.x}, y=${right.y}, z=${right.z}, rot=${right.rot}`);
  });

  it("needs the matching pin kind and direction", () => {
    const technic = getPart("42610c01")!;
    expect(wheelMount(worldPins(holder, getPart("4600")!)[0], technic)).toBeNull();
    const wrongWay = { ...right, rot: 180 as const };
    expect(validate(model([holder, chassis, wrongWay])).errors.map((e) => e.code)).toContain("LOOSE_WHEEL");
  });

  it("mounts correctly on rotated holders", () => {
    const h = P("4600", "black", 5, 3, 5, 90);
    const wheels = mountsFor(h, "4624c01").map((m) => ({ ...P("4624c01", "white", 0, 0, 0), ...m.at }));
    expect(wheels.map((w) => w.rot).sort()).toEqual([270, 90]);
    const r = validate(model([h, P("plate_2x2", "red", 5, 4, 5), ...wheels]));
    expect(r.errors).toEqual([]);
  });

  it("puts wheels on in the last step", () => {
    const m = model([right, holder, chassis, left]);
    const steps = buildSteps(m);
    expect(steps.at(-1)!.parts.sort()).toEqual([0, 3]);
    expect(checkStepOrder(m, validate(m).connections, steps)).toEqual([]);
  });

  it("logs which catalog parts a model uses", () => {
    const u = catalogUsage(model([holder, chassis, right, left, P("3933", "red", 0, 4, 0)]));
    expect(u.parts).toEqual({ "4600": 1, "4624c01": 2, "3933": 1 });
    expect(u.core).toBe(1);
    expect(u.fromSearch).toBe(1);
  });
});

describe("wheel holders in the manual", () => {
  it("are built in the same step as the chassis they hang under, before the wheels", () => {
    const h1 = P("4600", "black", 2, 2, 1), h2 = P("4600", "black", 2, 2, 7);
    const wheels = [h1, h2].flatMap((h) => mountsFor(h, "4624c01").map((m) => ({ ...P("4624c01", "white", 0, 0, 0), ...m.at })));
    const m = model([P("plate_2x8", "red", 2, 3, 1, 90), h1, h2, P("plate_4x8", "red", 1, 4, 1, 90), ...wheels]);
    const steps = buildSteps(m);
    const stepOf = (i: number) => steps.findIndex((s) => s.parts.includes(i));
    expect(stepOf(1)).toBe(stepOf(0)); // holders with the chassis plate
    expect(stepOf(2)).toBe(stepOf(0));
    expect(stepOf(0)).toBe(0); // and that's the first step, not a floating holder on its own
    expect(Math.min(...[4, 5, 6, 7].map(stepOf))).toBe(steps.length - 1); // wheels last
    expect(checkStepOrder(m, validate(m).connections, steps)).toEqual([]);
  });
});
