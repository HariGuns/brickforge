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
}

export interface Plan {
  name: string;
  description: string;
  /** How the main build is laid out: base, where copies go, glue parts. */
  layout: string;
  subBuilds: PlannedSubBuild[];
}

/** Target scale per Detail level (for a photo, the analysis block gives exact numbers instead). */
function detailTargetText(detail: Detail | undefined): string {
  const t = CONFIG.detail[detail ?? "high"];
  return `the subject about ${t.width} studs wide (side to side; vehicles at least ${CONFIG.detail.vehicleMinWidth}), in its real proportions, about ${Math.round(t.parts * 0.5)}–${t.parts} parts in total. Orient it with its front facing +z`;
}

export function planPrompt(request: string, detail: Detail | undefined, hasImage: boolean, analysis?: string): string {
  const s = CONFIG.subbuilds;
  return `You are planning a large model as a tree of sub-builds before anyone places a single part.

Request: ${request.trim() || "the main subject of the attached photo"}${hasImage ? "\n(Use the attached photo as the reference.)" : ""}
${analysis ? `\n${analysis}\n` : `Target size: ${detailTargetText(detail)}.`}

Split the model into sub-builds: self-contained pieces that are each built on their own as one connected piece, then placed on the main build. Good sub-builds are repeated features (trees, houses, windows bays, towers, wheels sets, fence runs) or big distinct sections (a hull, a tower, a gatehouse). Repeating a sub-build as several copies is the main way to get a large, detailed model cheaply, so use copies wherever the subject repeats. Left/right pairs count as repeats: a copy can be a mirror image (mirror: true in the assembly), so a vehicle's right side panel, wheel arch or wing can be designed once and mirrored for the left side.

The main build holds the base (plates the copies stand on) and glue parts that tie copies together; it is designed last, once every sub-build exists.

For each unique sub-build give:
- id (lowercase, letters/digits/_), name (human label), purpose (one sentence: what it is and how it looks)
- envelope: w × d studs footprint and h plates tall that ONE copy must fit inside (w, d ≤ ${s.maxEnvelope}; brick = 3 plates)
- parts: a part budget for one copy (≤ ${s.maxSubParts})
- copies: how many copies the main build will place

Limits: at most ${s.maxUnique} unique sub-builds and ${s.maxCopies} copies in total; parts × copies over all sub-builds ≤ ${CONFIG.design.maxParts - 400}.

Also give: name, description (of the finished model), and layout: a short plan of the main build (base size, where each copy goes and how it faces, what glue parts tie things together).`;
}

export function planJsonSchema(): Record<string, unknown> {
  return {
    type: "object",
    properties: {
      name: { type: "string" },
      description: { type: "string" },
      layout: { type: "string" },
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
          },
          required: ["id", "name", "purpose", "w", "d", "h", "parts", "copies"],
          additionalProperties: false,
        },
      },
    },
    required: ["name", "description", "layout", "subBuilds"],
    additionalProperties: false,
  };
}

export function subBuildPrompt(plan: Plan, sub: PlannedSubBuild): string {
  const others = plan.subBuilds.filter((o) => o.id !== sub.id).map((o) => `${o.name} (×${o.copies})`);
  return `You are designing one sub-build of a larger model.

The whole model: ${plan.name} — ${plan.description}
How it's laid out: ${plan.layout}
${others.length ? `Other sub-builds (designed separately): ${others.join(", ")}.\n` : ""}
Design the sub-build "${sub.name}" (${sub.copies} cop${sub.copies === 1 ? "y" : "ies"} will be placed): ${sub.purpose}

Rules for this sub-build:
- Its own frame: it must fit inside x 0..${sub.w - 1}, z 0..${sub.d - 1}, y 0..${sub.h - 1} (plates). Start at x = 0, z = 0 and put its lowest parts at y = 0.
- It must be ONE connected piece on its own (it's built separately, then placed as a unit), and buildable bottom-up.
- Its bottom will stand on studs of the main build, so give it a studded-to-underside base where it touches down (plain bricks or plates at y = 0, not tiles on the bottom face).
- Aim for about ${sub.parts} parts. Make it detailed and recognisable; it's a real piece of the final model.

Return JSON with name "${sub.name}", a one-sentence description, and parts (listed bottom layer first). ${formatHelp()}`;
}

function surfaceText(m: SurfaceMaps): string {
  return [
    `  size: ${m.w} × ${m.d} studs, ${m.h} plates tall`,
    `  top surface (rows z = 0..${m.d - 1}, columns x = 0..${m.w - 1}; number = top height in plates, * = a free stud there, . = empty):`,
    ...m.top.map((r, z) => `    z${z}: ${r}`),
    `  underside at y = 0 (o = takes a stud from below):`,
    ...m.bottom.map((r, z) => `    z${z}: ${r}`),
  ].join("\n");
}

export function assemblyPrompt(request: string, plan: Plan, built: { id: string; name: string; copies: number; parts: number; maps: SurfaceMaps }[]): string {
  const g = CONFIG.design.grid;
  return `You are assembling a large model from finished sub-builds.

Request: ${request.trim() || "the main subject of the photo"}
Model: ${plan.name} — ${plan.description}
Planned layout: ${plan.layout}

Finished sub-builds (they can't be changed now; you place copies of them):
${built.map((b) => `- ${b.id} "${b.name}" (${b.parts} parts, planned ${b.copies} cop${b.copies === 1 ? "y" : "ies"})\n${surfaceText(b.maps)}`).join("\n")}

Return the main build:
- parts: the main build's own parts — the base the copies stand on and glue parts that tie copies together or finish the model. Same rules as always.
- uses: the copies, each with sub, x, y, z, rot and mirror. (x, z) is where the min corner of the copy's (rotated) footprint goes; y is the height of the copy's bottom. A copy's cells rotate like a part's: at rot 90 a w × d footprint becomes d × w and its local cell (cx, cz) lands at (d-1-cz, cx) inside it; at rot 180 at (w-1-cx, d-1-cz); at rot 270 at (cz, w-1-cx).
- mirror: true makes the copy the mirror image of the sub-build (left/right): it's flipped along the sub-build's own x axis (local cell (cx, cz) → (w-1-cx, cz)) before rot is applied, and handed parts are swapped automatically (wedge right ↔ left, wheels turn to face the other way). Use it for the opposite side of a symmetric subject; use mirror: false for plain copies. A few parts have no mirror image; the checker names them.

Rules the compiler checks:
- Each copy is placed as one piece: its underside cells (o) must sit on studs of the main build or another copy directly below it (its y = the top height there), or on the ground at y = 0.
- Copies must not overlap each other or main parts, and two copies must not interlock (each resting on the other).
- Everything together must be one connected structure, buildable bottom-up. Things only connect through studs.
- Build area: x 0..${g.x - 1}, z 0..${g.z - 1}; at most ${CONFIG.design.maxParts} parts after expanding copies.

Place roughly the planned number of copies. Return JSON with name, description, parts and uses. ${formatHelp(codec(), true)}`;
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
