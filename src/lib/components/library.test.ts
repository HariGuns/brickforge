import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { importComponent, libraryListing, loadLibrary, makeComponent, saveComponent, searchLibrary, words } from "./library";
import { seedLibrary } from "./seed";
import { SAMPLE_VILLAGE } from "../fixtures/designs";
import { P } from "../fixtures/samples";
import { generateDesign } from "../claude/subbuilds";
import { simulatedClient, TownScript } from "../claude/simulated";
import { compileDesign } from "../design/compile";
import type { GenerateEvent } from "../claude/generate";

const dirs: string[] = [];
afterAll(() => dirs.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));
const tmp = (name: string) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), `brickforge-${name}-`));
  dirs.push(d);
  return d;
};

describe("components", () => {
  it("makes a component with size, tags and connection points, and rejects one that isn't valid on its own", () => {
    const c = makeComponent(SAMPLE_VILLAGE.subBuilds, "pine_tree", { description: "a pine tree", context: ["Village square"], cost: 0.05 })!;
    expect(c.name).toBe("Pine tree");
    expect(c.id).toMatch(/^pine_tree_[0-9a-f]{6}$/);
    expect(c.size).toEqual({ w: 2, d: 2, h: 11 });
    expect(c.tags).toEqual(expect.arrayContaining(["pine", "tree", "village", "square"]));
    expect(c.connections.bottom.join("")).toContain("o");
    expect(c.depth).toBe(1);
    const floating = { ...SAMPLE_VILLAGE.subBuilds[0], id: "bad", parts: [P("brick_2x2", "red", 0, 0, 0), P("brick_2x2", "red", 5, 9, 5)] };
    expect(makeComponent([floating], "bad", {})).toBeNull();
  });

  it("saves each content once, whatever the ids", () => {
    const lib = loadLibrary(tmp("lib"));
    const a = makeComponent(SAMPLE_VILLAGE.subBuilds, "hut", {})!;
    const renamed = SAMPLE_VILLAGE.subBuilds.map((s) => (s.id === "hut" ? { ...s, id: "cabin" } : s));
    const b = makeComponent(renamed, "cabin", {})!;
    expect(saveComponent(lib, a).added).toBe(true);
    expect(saveComponent(lib, b).added).toBe(false);
    expect(loadLibrary(lib.dir).components).toHaveLength(1);
  });

  it("finds components by name and tags, only ones that fit", () => {
    const lib = loadLibrary(tmp("lib"));
    for (const id of ["hut", "pine_tree"]) saveComponent(lib, makeComponent(SAMPLE_VILLAGE.subBuilds, id, { context: ["village"] })!);
    expect(searchLibrary(lib, "a village with pine trees", { w: 32, d: 32, h: 90 }).map((c) => c.name)).toEqual(["Pine tree", "Hut"]);
    expect(searchLibrary(lib, "pine trees", { w: 1, d: 1, h: 90 })).toEqual([]);
    expect(words("Windows and Doors")).toEqual(["window", "door"]);
    expect(libraryListing(searchLibrary(lib, "tree", { w: 8, d: 8, h: 20 }))[0]).toMatch(/^- library:pine_tree_[0-9a-f]{6} "Pine tree": 2 × 2 × 11, \d+ parts/);
  });

  it("imports a component under a new id, recoloured, reusing identical sub-builds already in the design", () => {
    // A two-level component: a grove holding two copies of the pine tree.
    const grove = { id: "grove", name: "Grove", parts: [P("plate_4x4", "green", 0, 0, 0)], uses: [{ sub: "pine_tree", x: 0, y: 1, z: 0, rot: 0 as const }, { sub: "pine_tree", x: 2, y: 1, z: 2, rot: 0 as const }] };
    const tree = SAMPLE_VILLAGE.subBuilds.find((s) => s.id === "pine_tree")!;
    const c = makeComponent([grove, tree], "grove", {})!;
    expect(c.depth).toBe(2);
    // The design already has the same pine tree under another id: it's reused, not duplicated.
    const existing = [{ ...tree, id: "fir" }];
    const plain = importComponent(c, "park", [], existing);
    expect(plain.map((s) => s.id)).toEqual(["park"]);
    expect(plain[0].uses.map((u) => u.sub)).toEqual(["fir", "fir"]);
    // Recoloured, the tree differs, so it comes along under a free id.
    const autumn = importComponent(c, "park2", ["dark_green>orange"], existing, ["pine_tree"]);
    expect(autumn.map((s) => s.id)).toEqual(["pine_tree_2", "park2"]);
    expect(autumn[0].parts.some((p) => p.color === "orange")).toBe(true);
    expect(autumn[0].parts.some((p) => p.color === "dark_green")).toBe(false);
    const d = compileDesign({ name: "x", description: "", subBuilds: [...existing, ...autumn], main: { parts: [], uses: [{ sub: "park2", x: 0, y: 0, z: 0, rot: 0 }] } });
    expect(d.errors).toEqual([]);
  });
});

describe("library in the sub-build pipeline (simulated Claude)", () => {
  it("saves every valid sub-build, seeds from runs, and a second run reuses them instead of designing", async () => {
    const library = tmp("lib");
    const first = simulatedClient();
    const r1 = await generateDesign({ text: "a town square", detail: "very_high" }, () => {}, { client: first, library });
    dirs.push(r1.debugDir);
    const script = new TownScript();
    const unique = new Set([...script.byName.values()].map((n) => n.id)).size;
    expect(r1.library).toMatchObject({ reused: 0, added: unique });
    expect(loadLibrary(library).components).toHaveLength(unique);
    // Composite components remember their tree and their place in the model.
    const house = loadLibrary(library).components.find((c) => c.name === "Town house")!;
    expect(house.depth).toBe(3);
    expect(loadLibrary(library).components.find((c) => c.name === "Small window")!.tags).toEqual(expect.arrayContaining(["house", "facade", "town", "square"]));
    expect(house.cost).toBeGreaterThan(0);

    // Seeding another library from the run's folder finds the same components.
    const seeded = tmp("seeded");
    const rep = seedLibrary({ dir: seeded, debugDir: path.dirname(r1.debugDir), buildsDir: path.join(seeded, "none") });
    expect(rep.invalid).toBe(0);
    expect(loadLibrary(seeded).components.map((c) => c.hash).sort()).toEqual(expect.arrayContaining(loadLibrary(library).components.map((c) => c.hash).sort()));

    // Second run: the plan is offered the saved components and reuses them (one recoloured).
    const second = simulatedClient({ recolor: { "Market stall": ["red>blue"] } });
    const events: GenerateEvent[] = [];
    const r2 = await generateDesign({ text: "a town square", detail: "very_high" }, (e) => events.push(e), { client: second, library });
    dirs.push(r2.debugDir);
    expect(r2.valid).toBe(true);
    expect(second.requests.map((q) => q.kind)).toEqual(["plan", "assembly"]);
    expect(r2.library).toMatchObject({ reused: script.root.children.length, added: 0 });
    expect(r2.library!.saved).toBeGreaterThan(0);
    expect(r2.compile!.stats.pieces).toBe(r1.compile!.stats.pieces);
    expect(r2.usage.cost).toBeLessThan(r1.usage.cost / 5);
    const stall = events.find((e) => e.type === "stage" && e.scope === "lib:market_stall") as Extract<GenerateEvent, { type: "stage" }>;
    expect(stall.reused).toMatchObject({ recolor: ["red>blue"] });
    // The recoloured stall is blue where the original was red.
    const colours = (r: typeof r1, sub: string) => {
      const c = compileDesign(r.design!);
      return new Set(c.model.parts.filter((_, i) => c.instances[c.origin[i]]?.path.startsWith(sub)).map((p) => p.color));
    };
    expect(colours(r2, "Market stall").has("red")).toBe(false);
    expect(colours(r1, "Market stall").has("red")).toBe(true);
    const summary = JSON.parse(fs.readFileSync(path.join(r2.debugDir, "summary.json"), "utf8"));
    expect(summary.library.reused).toHaveLength(script.root.children.length);
    expect(summary.library.offered.plan).toBeGreaterThan(0);
    expect(loadLibrary(library).components.find((c) => c.name === "Town house")!.reused).toBe(1);
  });
});
