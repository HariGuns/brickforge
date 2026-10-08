/**
 * Prompts for the sub-build generator: plan → each unique sub-build → assembly.
 * The system prompt (system.ts) is shared, so it stays cached across all calls.
 * Tune freely.
 */
import { CONFIG } from "../config";
import { codec, formatHelp } from "../diff/format";
import type { Detail } from "../detail";
import type { SurfaceMaps } from "../design/surface";

export interface PlannedSubBuild {
  id: string;
  name: string;
  purpose: string;
  /** Envelope: footprint (studs) and height (plates) one copy must fit in. */
  w: number;
  d: number;
  h: number;
  /** Part budget for one copy. */
  parts: number;
  copies: number;
  /**
   * A sideways panel (sideways building): built flat like a picture, then turned
   * onto its side and clipped onto side studs. w × d is its face, h its thickness.
   */
  sideways?: boolean;
  /** Tree mode: this sub-build is itself planned as child sub-builds (then assembled), instead of designed directly. */
  split?: boolean;
  /**
   * Where it comes from: "new" (designed now, the default), "shared" (a sub-build
   * already planned elsewhere in this model, by its id) or "library:<id>" (a saved
   * component, reused as it is).
   */
  from?: string;
  /** Recolouring for a library component: "red>blue" entries. */
  recolor?: string[];
}

export interface Plan {
  name: string;
  description: string;
  /** How the main build is laid out: base, where copies go, glue parts. */
  layout: string;
  /** A scene on the ground (town square, street, park): it stands on baseplates (CONFIG.baseplates). */
  scene?: boolean;
  /** The baseplates' colour, for a scene. */
  ground?: string;
  subBuilds: PlannedSubBuild[];
}

/** Target scale per Detail level (for a photo, the analysis block gives exact numbers instead). */
function detailTargetText(detail: Detail | undefined, tree = false): string {
  const t = CONFIG.detail[detail ?? "high"];
  const parts = (tree && CONFIG.tree.parts[detail ?? "high"]) || t.parts;
  return `the subject about ${t.width} studs wide (side to side; vehicles at least ${CONFIG.detail.vehicleMinWidth}), in its real proportions, about ${Math.round(parts * 0.5)}–${parts} parts in total. Orient it with its front facing +z`;
}

/** Tree mode and the component library, for the plan prompts. */
export interface PlanExtras {
  /** Sub-builds can be split into child sub-builds. */
  tree?: boolean;
  /** Library components that match the request (listing lines), if any. */
  library?: string[];
}

export function planPrompt(request: string, detail: Detail | undefined, hasImage: boolean, analysis?: string, extras: PlanExtras = {}): string {
  const s = CONFIG.subbuilds;
  return `You are planning a large model as a tree of sub-builds before anyone places a single part.

Request: ${request.trim() || "the main subject of the attached photo"}${hasImage ? "\n(Use the attached photo as the reference.)" : ""}
${analysis ? `\n${analysis}\n` : `Target size: ${detailTargetText(detail, extras.tree)}.`}

Split the model into sub-builds: self-contained pieces that are each built on their own as one connected piece, then placed on the main build. Good sub-builds are repeated features (trees, houses, windows bays, towers, wheels sets, fence runs) or big distinct sections (a hull, a tower, a gatehouse). Repeating a sub-build as several copies is the main way to get a large, detailed model cheaply, so use copies wherever the subject repeats. Left/right pairs count as repeats: a copy can be a mirror image (mirror: true in the assembly), so a vehicle's right side panel, wheel arch or wing can be designed once and mirrored for the left side.

The main build holds the base (plates the copies stand on) and glue parts that tie copies together; it is designed last, once every sub-build exists.
${CONFIG.sideways.enabled ? `
Sideways panels (optional): a sub-build can be a panel that's turned onto its side and clipped onto side studs of the main build (bricks with studs on the side, brackets), with its studs facing outwards. Use it for large flat vertical faces that should look smooth or detailed from the side: a car's flanks, doors, a building's facade, a ship's hull sides. Mark it sideways: true; its envelope is then its face, w studs wide × d studs tall, and h is its thickness in plates (1–3 is typical). Mirror a panel for the opposite side. Everything else stays upright (sideways: false).
` : ""}
For each unique sub-build give:
- id (lowercase, letters/digits/_), name (human label), purpose (one sentence: what it is and how it looks)
- envelope: w × d studs footprint and h plates tall that ONE copy must fit inside (w, d ≤ ${s.maxEnvelope}; brick = 3 plates)
- parts: a part budget for one copy (≤ ${s.maxSubParts})
- copies: how many copies the main build will place${CONFIG.sideways.enabled ? "\n- sideways: true for a sideways panel, false otherwise" : ""}${extras.tree ? `\n- split: true to plan this sub-build as smaller child sub-builds (next step), false to design it directly` : ""}${extras.tree || extras.library?.length ? `\n- from: "new" to design it${extras.library?.length ? `, or "library:<id>" to reuse a saved component from the list below as it is (copy its w, d, h and parts)` : ""}\n- recolor: ${extras.library?.length ? `for a library component, colour swaps like "red>blue" (empty to keep its colours)` : "leave empty"}` : ""}

Limits: at most ${s.maxUnique} unique sub-builds and ${s.maxCopies} copies in total; parts × copies over all sub-builds ≤ ${CONFIG.design.maxParts - 400}.${extras.tree ? `\n${treeText()}` : ""}${extras.library?.length ? `\n${libraryText(extras.library)}` : ""}

Also give: name, description (of the finished model), and layout: a short plan of the main build (base size, where each copy goes and how it faces, what glue parts tie things together).${CONFIG.baseplates.enabled ? `

And scene: true if the model is a scene laid out on the ground (a town square, a street, a park, a harbour, a farmyard), false for a freestanding object (a vehicle, a single building, a creature, a sculpture). A scene stands on a baseplate: the code lays the smallest one (16×16 up to 48×48 studs) under the whole main build, so plan the layout within 48 × 48 studs, and the main build needs no plates just to make a ground. Give ground: the baseplate's colour (${CONFIG.baseplates.colors.join(", ")}; green for grass, light_gray or dark_gray for paving, tan for sand). For an object, scene: false and ground: "green" (unused).` : ""}`;
}

/** How to split sub-builds (tree mode), for the plan and the child plans. */
export function treeText(): string {
  const t = CONFIG.tree;
  return `
Deeper trees: a large or complex sub-build (a house, a market stall, a tower) can be split: mark it split: true, and it will be planned in the next step as child sub-builds of its own (walls, facades, roof sections, windows, doors, lamps, railings…), which are designed separately and then assembled into it. Split where a piece has repeated or distinct smaller parts; design directly (split: false) when it's small or simple enough to design in one go (up to ${CONFIG.subbuilds.maxSubParts} parts, usually a lot fewer). A split sub-build's part budget covers everything in one copy (up to ${t.maxSplitParts}). Up to ${t.maxDepth} levels of sub-builds and ${t.maxUnique} unique sub-builds in the whole model.`;
}

/** The library components offered to a planner. */
export function libraryText(lines: string[]): string {
  return `
Component library: finished, valid components saved from earlier builds. Reuse one wherever it fits the model (it costs nothing to design): set from: "library:<id>" and copy its size and part count. You can recolour it with recolor ("red>blue"). A reused component is used as it is (not split).
${lines.join("\n")}`;
}

export function planJsonSchema(extras: PlanExtras = {}): Record<string, unknown> {
  const more = extras.tree || !!extras.library?.length;
  return {
    type: "object",
    properties: {
      name: { type: "string" },
      description: { type: "string" },
      layout: { type: "string" },
      ...(CONFIG.baseplates.enabled ? { scene: { type: "boolean" }, ground: { type: "string", enum: CONFIG.baseplates.colors } } : {}),
      subBuilds: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            name: { type: "string" },
            purpose: { type: "string" },
            w: { type: "integer" },
            d: { type: "integer" },
            h: { type: "integer" },
            parts: { type: "integer" },
            copies: { type: "integer" },
            ...(CONFIG.sideways.enabled ? { sideways: { type: "boolean" } } : {}),
            ...(extras.tree ? { split: { type: "boolean" } } : {}),
            ...(more ? { from: { type: "string" }, recolor: { type: "array", items: { type: "string" } } } : {}),
          },
          required: ["id", "name", "purpose", "w", "d", "h", "parts", "copies", ...(CONFIG.sideways.enabled ? ["sideways"] : []), ...(extras.tree ? ["split"] : []), ...(more ? ["from", "recolor"] : [])],
          additionalProperties: false,
        },
      },
    },
    required: ["name", "description", "layout", "subBuilds", ...(CONFIG.baseplates.enabled ? ["scene", "ground"] : [])],
    additionalProperties: false,
  };
}

/** Where a sub-build sits in a deeper tree: its parents (outermost first) and its siblings. */
export interface TreeContext {
  path: { name: string; purpose: string; layout: string }[];
  siblings: PlannedSubBuild[];
}

export function subBuildPrompt(plan: Plan, sub: PlannedSubBuild, tree?: TreeContext): string {
  const others = (tree ? tree.siblings : plan.subBuilds).filter((o) => o.id !== sub.id).map((o) => `${o.name} (×${o.copies})`);
  const parent = tree?.path.at(-1);
  return `You are designing one sub-build of a larger model.

The whole model: ${plan.name} — ${plan.description}
How it's laid out: ${plan.layout}
${parent ? `It's a part of: ${tree!.path.map((p) => p.name).join(" › ")}. ${parent.name}: ${parent.purpose} Its layout: ${parent.layout}\n` : ""}${others.length ? `Other sub-builds ${parent ? `in ${parent.name} ` : ""}(designed separately): ${others.join(", ")}.\n` : ""}
Design the sub-build "${sub.name}" (${sub.copies} cop${sub.copies === 1 ? "y" : "ies"} will be placed): ${sub.purpose}

Rules for this sub-build:
- Its own frame: it must fit inside x 0..${sub.w - 1}, z 0..${sub.d - 1}, y 0..${sub.h - 1} (plates). Start at x = 0, z = 0 and put its lowest parts at y = 0.
- It must be ONE connected piece on its own (it's built separately, then placed as a unit), and buildable bottom-up.
${sub.sideways ? `- It's a SIDEWAYS PANEL: build it flat, like a picture lying face up. It will be turned onto its side, so its top (y = ${sub.h - 1} and up) becomes the outer face everyone sees and its bottom (y = 0) clips onto side studs of the main build. Seen from outside, x runs left to right and z runs top to bottom (z = 0 is the top edge). Draw the details on the top face: tiles for smooth paint, slopes and plates for relief.
- Its bottom at y = 0 must be plates or bricks (not tiles) wherever it clips on, and it holds together as one piece through its bottom layer (e.g. long plates spanning it).
` : `- Its bottom will stand on studs of the main build, so give it a studded-to-underside base where it touches down (plain bricks or plates at y = 0, not tiles on the bottom face).
`}- Aim for about ${sub.parts} parts. Make it detailed and recognisable; it's a real piece of the final model.

Return JSON with name "${sub.name}", a one-sentence description, and parts (listed bottom layer first). ${formatHelp()}`;
}

export function surfaceText(m: SurfaceMaps, sideways?: boolean): string {
  if (sideways)
    return [
      `  SIDEWAYS PANEL: face ${m.w} studs wide × ${m.d} studs tall, ${m.h} plates thick (x left → right, z top → bottom, seen from outside)`,
      `  back (o = an anti-stud that can clip onto a side stud):`,
      ...m.bottom.map((r, z) => `    z${z}: ${r}`),
    ].join("\n");
  return [
    `  size: ${m.w} × ${m.d} studs, ${m.h} plates tall`,
    `  top surface (rows z = 0..${m.d - 1}, columns x = 0..${m.w - 1}; number = top height in plates, * = a free stud there, . = empty):`,
    ...m.top.map((r, z) => `    z${z}: ${r}`),
    `  underside at y = 0 (o = takes a stud from below):`,
    ...m.bottom.map((r, z) => `    z${z}: ${r}`),
  ].join("\n");
}

/** How to mount sideways panels, for the main assembly and sub-assemblies. */
export function sidewaysMountText(container: string): string {
  return `
Sideways panels are mounted, not placed at x/y/z: give the copy a mount instead — "on <part>:<side stud> at <cx>,<cz> spin <rot>" (JSON: mount {part, stud, at: [cx, cz], spin}).
- part is the index of one of ${container}'s own parts that has side studs (bricks with studs on the side, brackets; search for "side studs" or "bracket"). stud is the index of its side stud, as listed in the part's row ("side studs: 0: +z face at …"). Side studs turn with the part: at rot 90 a +z stud faces -x, +x faces +z; at rot 180 +z faces -z; at rot 270 +z faces +x.
- The panel's back goes flat against that face, its outer face pointing the way the stud points, and the panel's back cell (cx, cz) (an o in its map) clips onto that stud. With spin 0 the panel is upright as drawn: z = 0 at the top, x running left to right as seen from outside. Every other o that lines up with another side stud clips on too, so put carriers at several heights and along the side to hold big panels.
- Leave room: nothing else may be where the panel goes (it sticks out from the face by its thickness), and it must not dip below the ground.
- The same panel on the opposite side of the model: mount a copy with mirror so its front and back stay the right way round.
`;
}

export function assemblyPrompt(request: string, plan: Plan, built: { id: string; name: string; copies: number; parts: number; maps: SurfaceMaps; sideways?: boolean }[]): string {
  const g = CONFIG.design.grid;
  return `You are assembling a large model from finished sub-builds.

Request: ${request.trim() || "the main subject of the photo"}
Model: ${plan.name} — ${plan.description}
Planned layout: ${plan.layout}

Finished sub-builds (they can't be changed now; you place copies of them):
${built.map((b) => `- ${b.id} "${b.name}" (${b.parts} parts, planned ${b.copies} cop${b.copies === 1 ? "y" : "ies"})\n${surfaceText(b.maps, b.sideways)}`).join("\n")}

Return the main build:
- parts: the main build's own parts — the base the copies stand on and glue parts that tie copies together or finish the model. Same rules as always.
- uses: the copies, each with sub, x, y, z, rot and mirror. (x, z) is where the min corner of the copy's (rotated) footprint goes; y is the height of the copy's bottom. A copy's cells rotate like a part's: at rot 90 a w × d footprint becomes d × w and its local cell (cx, cz) lands at (d-1-cz, cx) inside it; at rot 180 at (w-1-cx, d-1-cz); at rot 270 at (cz, w-1-cx).
- mirror: true makes the copy the mirror image of the sub-build (left/right): it's flipped along the sub-build's own x axis (local cell (cx, cz) → (w-1-cx, cz)) before rot is applied, and handed parts are swapped automatically (wedge right ↔ left, wheels turn to face the other way). Use it for the opposite side of a symmetric subject; use mirror: false for plain copies. A few parts have no mirror image; the checker names them.

${plan.scene && CONFIG.baseplates.enabled ? `This is a scene: it stands on a ${plan.ground ?? "green"} baseplate. The code lays the smallest baseplate (16×16 up to 48×48 studs) under your whole main build and keeps it there; don't add it yourself. Everything at y = 0 stands on its studs and is held by them, so copies and parts can go straight on the ground: no plates are needed just to make a ground, and areas that only touch through the baseplate still count as connected. Keep the whole scene within 48 × 48 studs. A tall thing on a single stud is still a weak joint on a baseplate.

` : ""}Rules the compiler checks:
- Each copy is placed as one piece: its underside cells (o) must sit on studs of the main build or another copy directly below it (its y = the top height there), or on the ground at y = 0.
- Copies must not overlap each other or main parts, and two copies must not interlock (each resting on the other).
- Everything together must be one connected structure, buildable bottom-up. Things only connect through studs.
- Build area: x 0..${g.x - 1}, z 0..${g.z - 1}; at most ${CONFIG.design.maxParts} parts after expanding copies.

${built.some((b) => b.sideways) ? sidewaysMountText("the main build") : ""}Place roughly the planned number of copies. Return JSON with name, description, parts and uses. ${formatHelp(codec(), true)}`;
}

export function assemblyJsonSchema(): Record<string, unknown> {
  const c = codec();
  return {
    type: "object",
    properties: {
      name: { type: "string" },
      description: { type: "string" },
      parts: { type: "array", items: c.placementSchema },
      uses: { type: "array", items: c.instanceSchema },
    },
    required: ["name", "description", "parts", "uses"],
    additionalProperties: false,
  };
}
