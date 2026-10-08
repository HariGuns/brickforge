import type Anthropic from "@anthropic-ai/sdk";
import type { Placement, Rot } from "../model/schema";

/**
 * A simulated Claude for the sub-build tree: it answers the plan, child plans,
 * sub-build designs and assemblies of a scripted town square (4 levels, about
 * 50 unique sub-builds, 100+ copies), with made-up token usage so costs and the
 * budget cap behave like a real run. No API calls. Used by the tests and by
 * `npm run gen -- --simulate`.
 *
 * Every answer is valid by construction: sub-builds designed directly are
 * stacks of one brick size, and every split sub-build (and the main build) is
 * a base plate with its children packed on top. It reads the library listing
 * in plan prompts and reuses components whose name matches its own.
 */

interface Leaf {
  id: string;
  name: string;
  w: number;
  d: number;
  /** Bricks stacked (3 plates each). */
  layers: number;
  color: string;
  copies: number;
}
interface Split {
  id: string;
  name: string;
  copies: number;
  children: SimNode[];
}
type SimNode = Leaf | Split;
const isSplit = (n: SimNode): n is Split => "children" in n;

const L = (id: string, name: string, w: number, d: number, layers: number, color: string, copies: number): Leaf => ({ id, name, w, d, layers, color, copies });
const S = (id: string, name: string, copies: number, children: SimNode[]): Split => ({ id, name, copies, children });

/** The scripted town square. `window_small` is planned twice (house facades, tower base): the second plan shares it. */
export const TOWN_SQUARE: Split = S("main", "Town square", 1, [
  S("town_house", "Town house", 4, [
    S("house_facade", "House facade", 2, [
      L("window_small", "Small window", 2, 1, 2, "white", 3),
      L("door_front", "Front door", 2, 1, 4, "reddish_brown", 1),
      L("flower_box", "Flower box", 2, 1, 1, "red", 2),
      L("shutter", "Shutter", 1, 1, 2, "dark_green", 2),
    ]),
    S("house_roof", "House roof", 1, [L("roof_section", "Roof section", 4, 2, 1, "dark_red", 4), L("chimney", "Chimney", 1, 1, 3, "dark_gray", 1)]),
    L("house_side_wall", "Side wall", 4, 1, 3, "tan", 2),
    L("house_step", "Doorstep", 2, 1, 1, "light_gray", 1),
  ]),
  S("market_stall", "Market stall", 3, [
    L("stall_counter", "Stall counter", 4, 2, 1, "reddish_brown", 1),
    S("stall_awning", "Stall awning", 1, [L("awning_stripe", "Awning stripe", 4, 1, 1, "red", 2), L("awning_post", "Awning post", 1, 1, 3, "white", 2)]),
    L("crate", "Crate", 2, 2, 1, "reddish_brown", 2),
    L("fruit_pile", "Fruit pile", 1, 1, 1, "orange", 3),
    L("price_sign", "Price sign", 1, 1, 2, "white", 1),
  ]),
  S("fountain", "Fountain", 1, [
    S("fountain_basin", "Fountain basin", 1, [L("basin_wall", "Basin wall segment", 4, 1, 1, "light_gray", 4), L("water_pool", "Water", 2, 2, 1, "blue", 2)]),
    L("fountain_spout", "Fountain spout", 1, 1, 3, "light_gray", 1),
    L("fountain_step", "Fountain step", 2, 1, 1, "dark_gray", 2),
  ]),
  S("plaza_corner", "Plaza corner", 4, [
    S("park_tree", "Park tree", 1, [L("tree_trunk", "Tree trunk", 1, 1, 2, "reddish_brown", 1), L("tree_canopy", "Tree canopy", 2, 2, 2, "green", 1)]),
    S("bench", "Bench", 1, [L("bench_seat", "Bench seat", 4, 1, 1, "reddish_brown", 1), L("bench_leg", "Bench leg", 1, 1, 1, "dark_gray", 2)]),
    S("lamp_post", "Lamp post", 1, [L("lamp_pole", "Lamp pole", 1, 1, 3, "black", 1), L("lamp_head", "Lamp head", 1, 1, 1, "yellow", 1)]),
    L("flower_bed", "Flower bed", 2, 2, 1, "green", 1),
  ]),
  S("railing_run", "Railing run", 4, [L("railing_post", "Railing post", 1, 1, 2, "black", 3), L("railing_bar", "Railing bar", 4, 1, 1, "black", 1), L("railing_cap", "Railing cap", 1, 1, 1, "black", 3)]),
  S("clock_tower", "Clock tower", 1, [
    S("tower_base", "Tower base", 1, [L("tower_door", "Tower door", 2, 1, 4, "dark_tan", 1), L("window_small", "Small window", 2, 1, 2, "white", 2), L("tower_wall_block", "Tower wall block", 2, 2, 3, "light_gray", 2)]),
    L("clock_face", "Clock face", 2, 1, 1, "white", 1),
    S("tower_spire", "Tower spire", 1, [L("spire_cone", "Spire cone", 2, 2, 2, "dark_blue", 1), L("spire_ring", "Spire ring", 4, 1, 1, "yellow", 2)]),
    L("tower_flag", "Tower flag", 1, 1, 1, "red", 1),
  ]),
]);

/** Brick for a footprint (w along x, d along z). */
const BRICKS: Record<string, [string, Rot]> = {
  "1x1": ["brick_1x1", 0], "2x1": ["brick_1x2", 0], "1x2": ["brick_1x2", 90], "3x1": ["brick_1x3", 0], "4x1": ["brick_1x4", 0], "1x4": ["brick_1x4", 90],
  "2x2": ["brick_2x2", 0], "3x2": ["brick_2x3", 0], "4x2": ["brick_2x4", 0], "2x4": ["brick_2x4", 90],
};
/** Base plates, smallest first: [w, d, part, rot]. */
const PLATES: [number, number, string, Rot][] = (
  [
    [4, 4, "plate_4x4", 0], [6, 4, "plate_4x6", 0], [4, 6, "plate_4x6", 90], [8, 4, "plate_4x8", 0], [4, 8, "plate_4x8", 90], [6, 6, "3958", 0],
    [8, 6, "3036", 0], [6, 8, "3036", 90], [8, 8, "41539", 0], [16, 8, "92438", 0], [8, 16, "92438", 90], [16, 16, "91405", 0],
  ] as [number, number, string, Rot][]
).sort((a, b) => a[0] * a[1] - b[0] * b[1]);

const pl = (part: string, color: string, x: number, y: number, z: number, rot: Rot = 0): Placement => ({ part, color, x, y, z, rot });

interface Size {
  w: number;
  d: number;
  h: number;
  parts: number;
}
interface Rect {
  x: number;
  z: number;
  w: number;
  d: number;
}

/** Bottom-left fill: each item (biggest first) at the first free spot, scanning rows. Null if they don't fit. */
function pack(items: { w: number; d: number }[], W: number, D: number, blocked: Rect[] = []): Rect[] | null {
  const order = items.map((it, i) => ({ ...it, i })).sort((a, b) => b.w * b.d - a.w * a.d || b.d - a.d || a.i - b.i);
  const taken: Rect[] = [...blocked];
  const out: Rect[] = new Array(items.length);
  const hit = (r: Rect) => taken.some((t) => r.x < t.x + t.w && t.x < r.x + r.w && r.z < t.z + t.d && t.z < r.z + r.d);
  for (const it of order) {
    let spot: Rect | null = null;
    for (let z = 0; z + it.d <= D && !spot; z++) for (let x = 0; x + it.w <= W && !spot; x++) if (!hit({ x, z, w: it.w, d: it.d })) spot = { x, z, w: it.w, d: it.d };
    if (!spot) return null;
    taken.push(spot);
    out[it.i] = spot;
  }
  return out;
}

/** Copies of each child, expanded, in child order. */
const copiesOf = (n: Split) => n.children.flatMap((c) => Array.from({ length: c.copies }, () => c));

/** The main build's base: a grid of 16×16 plates, tied at every inner corner by a 2×8 plate (which the copies avoid). */
function mainBase(cols: number, rows: number) {
  const parts = [] as Placement[];
  const blocked: Rect[] = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) parts.push(pl("91405", "green", c * 16, 0, r * 16));
  for (let r = 1; r < rows; r++) for (let c = 1; c < cols; c++) {
    parts.push(pl("plate_2x8", "dark_gray", c * 16 - 4, 1, r * 16 - 1));
    blocked.push({ x: c * 16 - 4, z: r * 16 - 1, w: 8, d: 2 });
  }
  // A single row or column of plates is tied along its seams instead.
  if (rows === 1) for (let c = 1; c < cols; c++) (parts.push(pl("plate_2x8", "dark_gray", c * 16 - 1, 1, 4, 90)), blocked.push({ x: c * 16 - 1, z: 4, w: 2, d: 8 }));
  if (cols === 1) for (let r = 1; r < rows; r++) (parts.push(pl("plate_2x8", "dark_gray", 4, 1, r * 16 - 1)), blocked.push({ x: 4, z: r * 16 - 1, w: 8, d: 2 }));
  return { w: cols * 16, d: rows * 16, parts, blocked };
}

export class TownScript {
  readonly byName = new Map<string, SimNode>();
  private sizes = new Map<string, Size>();
  private layouts = new Map<string, { base: Placement[]; spots: Rect[]; w: number; d: number }>();

  constructor(readonly root: Split = TOWN_SQUARE) {
    const walk = (n: SimNode) => {
      if (n !== root) this.byName.set(n.name, n);
      if (isSplit(n)) n.children.forEach(walk);
    };
    walk(root);
  }

  size(n: SimNode): Size {
    const got = this.sizes.get(n.id);
    if (got) return got;
    let s: Size;
    if (!isSplit(n)) s = { w: n.w, d: n.d, h: n.layers * 3, parts: n.layers };
    else {
      const lay = this.layout(n);
      const kids = n.children.map((c) => this.size(c));
      s = { w: lay.w, d: lay.d, h: 1 + Math.max(...kids.map((k) => k.h)), parts: lay.base.length + n.children.reduce((sum, c, i) => sum + kids[i].parts * c.copies, 0) };
    }
    this.sizes.set(n.id, s);
    return s;
  }

  /** A split sub-build's base plate and where each child copy goes (in copiesOf order). */
  layout(n: Split) {
    const got = this.layouts.get(n.id);
    if (got) return got;
    const items = copiesOf(n).map((c) => this.size(c));
    let out: { base: Placement[]; spots: Rect[]; w: number; d: number } | null = null;
    if (n === this.root) {
      for (const [cols, rows] of [[2, 2], [3, 2], [3, 3], [4, 3], [4, 4]]) {
        const b = mainBase(cols, rows);
        const spots = pack(items, b.w, b.d, b.blocked);
        if (spots) {
          out = { base: b.parts, spots, w: b.w, d: b.d };
          break;
        }
      }
    } else {
      for (const [w, d, part, rot] of PLATES) {
        const spots = pack(items, w, d);
        if (spots) {
          out = { base: [pl(part, "light_gray", 0, 0, 0, rot)], spots, w, d };
          break;
        }
      }
    }
    if (!out) throw new Error(`Simulated Claude: the children of ${n.name} don't fit on a base.`);
    this.layouts.set(n.id, out);
    return out;
  }

  leafParts(n: Leaf): Placement[] {
    const [part, rot] = BRICKS[`${n.w}x${n.d}`] ?? [];
    if (!part) throw new Error(`Simulated Claude: no brick for ${n.w}×${n.d}.`);
    return Array.from({ length: n.layers }, (_, i) => pl(part, i % 2 && n.layers > 2 ? "light_gray" : n.color, 0, i * 3, 0, rot));
  }

  /** Parts and copies of a split sub-build (or the main build). `raise` lifts one copy (a deliberate mistake, for repair tests). */
  assembly(n: Split, raise = false) {
    const lay = this.layout(n);
    const y = n === this.root ? 1 : 1;
    const uses = copiesOf(n).map((c, i) => ({ sub: c.id, x: lay.spots[i].x, y: raise && i === 0 ? y + 2 : y, z: lay.spots[i].z, rot: 0 as Rot, mirror: false }));
    return { name: n.name, description: `${n.name} (simulated).`, parts: lay.base, uses };
  }

  entry(n: SimNode, o: { split: boolean; from: string; recolor?: string[] }) {
    const s = this.size(n);
    return { id: n.id, name: n.name, purpose: `A simulated ${n.name.toLowerCase()}.`, w: s.w, d: s.d, h: s.h, parts: s.parts, copies: n.copies, sideways: false, split: o.split, from: o.from, recolor: o.recolor ?? [] };
  }
}

export interface SimOptions {
  /** Names whose first answer is broken (a raised copy, or a leaf's top brick lifted off its studs), to exercise repairs. */
  failFirst?: string[];
  /** Split sub-builds (or "Town square" for the main build) whose first repair deletes the copies of their first child; the next repair puts them back. */
  dropOnRepair?: string[];
  /** Pretend usage per call is this many times the default (default 1). */
  costScale?: number;
  /** Library components to recolour when reused: component name → ["red>blue"]. */
  recolor?: Record<string, string[]>;
  /** Called for every request (tests). */
  onRequest?: (params: Anthropic.MessageCreateParams, kind: string) => void;
  /** Milliseconds per call (the CLI uses a little, so parallel stages interleave like real ones). */
  delayMs?: number;
}

/** Made-up token usage per kind of call (input, cache read, output), roughly like real runs. */
const USAGE: Record<string, [number, number, number]> = {
  plan: [9000, 0, 4000],
  childPlan: [5000, 0, 1800],
  leaf: [1500, 9000, 2200],
  subAssembly: [3000, 9000, 3500],
  assembly: [6000, 9000, 7000],
  repair: [2000, 12000, 1200],
};

const firstText = (p: Anthropic.MessageCreateParams) => {
  const c = p.messages[0].content;
  return typeof c === "string" ? c : c.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("\n");
};
const props = (p: Anthropic.MessageCreateParams) => ((p.output_config?.format?.schema ?? {}) as { properties?: Record<string, unknown> }).properties ?? {};

/** A client whose `messages.stream` answers like Claude would for the town square. */
export function simulatedClient(o: SimOptions = {}): Pick<Anthropic, "messages"> & { requests: { kind: string; name: string }[] } {
  const script = new TownScript();
  const failed = new Set<string>();
  const requests: { kind: string; name: string }[] = [];

  function answer(params: Anthropic.MessageCreateParams): { kind: string; name: string; json: unknown } {
    const pr = props(params);
    const text = firstText(params);
    const repair = params.messages.length > 1;
    const quoted = (re: RegExp) => text.match(re)?.[1] ?? "";
    if ("subBuilds" in pr && "layout" in pr) {
      const item = ((pr.subBuilds as { items?: { properties?: Record<string, unknown> } }).items?.properties ?? {});
      if (!("split" in item)) throw new Error("The simulated Claude needs tree mode (--tree or Very high detail).");
      const lib = libraryIds(text);
      return {
        kind: "plan",
        name: "plan",
        json: { name: "Town square", description: "A simulated town square with houses, market stalls, a fountain, a clock tower and a plaza.", layout: "A grid of 16×16 base plates; everything stands on it.", subBuilds: script.root.children.map((c) => entryFor(c, lib)) },
      };
    }
    if ("children" in pr) {
      const name = quoted(/Plan the sub-build "([^"]+)"/);
      const n = script.byName.get(name);
      if (!n || !isSplit(n)) throw new Error(`Simulated Claude: no split sub-build "${name}".`);
      const lib = libraryIds(text);
      const shared = new Set([...text.matchAll(/^- ([a-z][a-z0-9_]*) "/gm)].map((m) => m[1]));
      return { kind: "childPlan", name, json: { layout: `${name}: a base plate with its children packed on top.`, children: n.children.map((c) => (lib.has(c.name) || !shared.has(c.id) || isSplit(c) ? entryFor(c, lib) : script.entry(c, { split: false, from: "shared" }))) } };
    }
    if ("uses" in pr) {
      const name = quoted(/Assemble the sub-build "([^"]+)"/);
      const n = name ? script.byName.get(name) : script.root;
      if (!n || !isSplit(n)) throw new Error(`Simulated Claude: no split sub-build "${name}".`);
      const key = name || "main";
      const drop = o.dropOnRepair?.includes(n.name);
      const broken = !repair ? (drop || o.failFirst?.includes(n.name)) && !failed.has(key) : false;
      if (broken) failed.add(key);
      const json = script.assembly(n, broken);
      // First repair of a dropOnRepair build: "fixes" the raised copy by deleting that child's copies.
      if (drop && params.messages.length === 3) json.uses = json.uses.filter((u) => u.sub !== json.uses[0].sub);
      return { kind: name ? "subAssembly" : "assembly", name: n.name, json };
    }
    const name = quoted(/Design the sub-build "([^"]+)"/);
    const n = script.byName.get(name);
    if (!n || isSplit(n)) throw new Error(`Simulated Claude: no sub-build "${name}" to design directly.`);
    const parts = script.leafParts(n);
    const broken = !repair && o.failFirst?.includes(n.name) && !failed.has(n.name);
    if (broken) failed.add(n.name);
    return { kind: "leaf", name, json: { name: n.name, description: `${n.name} (simulated).`, parts: broken ? parts.map((p, i) => (i === parts.length - 1 ? { ...p, y: p.y + 3 } : p)) : parts } };
  }

  /** Library components listed in a plan prompt: component name → id. */
  function libraryIds(text: string): Map<string, string> {
    return new Map([...text.matchAll(/^- library:([a-z0-9_]+) "([^"]+)"/gm)].map((m) => [m[2], m[1]]));
  }
  function entryFor(c: SimNode, lib: Map<string, string>) {
    const id = lib.get(c.name);
    if (id) return script.entry(c, { split: false, from: `library:${id}`, recolor: o.recolor?.[c.name] });
    return script.entry(c, { split: isSplit(c), from: "new" });
  }

  const client = {
    requests,
    messages: {
      stream(params: Anthropic.MessageCreateParams) {
        const a = answer(params);
        const kind = params.messages.length > 1 ? "repair" : a.kind;
        requests.push({ kind, name: a.name });
        o.onRequest?.(params, kind);
        const [input, cacheRead, output] = USAGE[kind].map((n) => Math.round(n * (o.costScale ?? 1) * (params.output_config?.effort === "high" ? 1.4 : 1)));
        return {
          on() {
            return this;
          },
          async finalMessage() {
            if (o.delayMs) await new Promise((r) => setTimeout(r, o.delayMs));
            return {
              content: [{ type: "text", text: JSON.stringify(a.json) }],
              stop_reason: "end_turn",
              stop_details: null,
              usage: { input_tokens: input, output_tokens: output, cache_read_input_tokens: cacheRead, cache_creation_input_tokens: 0 },
            };
          },
        };
      },
    },
  };
  return client as unknown as Pick<Anthropic, "messages"> & { requests: { kind: string; name: string }[] };
}
