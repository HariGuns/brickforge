/**
 * Prompts for deeper sub-build trees: the child plan of a split sub-build, and
 * the sub-assembly that builds a split sub-build from its finished children.
 * The top-level plan and the main assembly are in subbuilds.ts. Tune freely.
 */
import { CONFIG } from "../config";
import { codec, formatHelp } from "../diff/format";
import type { SurfaceMaps } from "../design/surface";
import { libraryText, sidewaysMountText, surfaceText, treeText, type Plan, type PlannedSubBuild, type TreeContext } from "./subbuilds";

/** A split sub-build's own plan: its layout and its child sub-builds (copies are per copy of the parent). */
export interface ChildPlan {
  layout: string;
  children: PlannedSubBuild[];
}

export function childPlanPrompt(
  plan: Plan,
  node: PlannedSubBuild,
  ctx: TreeContext,
  o: { depth: number; shared: PlannedSubBuild[]; library: string[]; uniqueLeft: number; uniqueShare: number },
): string {
  const t = CONFIG.tree;
  const canSplit = o.depth + 1 < t.maxDepth;
  return `You are planning one split sub-build of a larger model as its own child sub-builds.

The whole model: ${plan.name} — ${plan.description}
How it's laid out: ${plan.layout}
${ctx.path.length ? `It's a part of: ${ctx.path.map((p) => p.name).join(" › ")}.\n` : ""}${ctx.siblings.length > 1 ? `Next to it (planned separately): ${ctx.siblings.filter((s) => s.id !== node.id).map((s) => `${s.name} (×${s.copies})`).join(", ")}.\n` : ""}
Plan the sub-build "${node.name}" (id ${node.id}): ${node.purpose}
Its envelope: ${node.w} × ${node.d} studs, ${node.h} plates tall; about ${node.parts} parts per copy, children included.

Split it into child sub-builds: self-contained pieces that are each built on their own as one connected piece, then placed inside it. Good children are repeated details (windows, doors, lamps, railings, roof sections, crates) or distinct sections (a wall, a roof, a base). Use copies wherever it repeats; a copy can also be a mirror image. The sub-build itself holds a base or frame (its own parts) that the children stand on, and glue parts that tie them together; that's designed last, once the children exist.

For each child give:
- id (lowercase, letters/digits/_), name, purpose (one sentence)
- envelope: w × d studs and h plates that ONE copy must fit inside (at most ${node.w} × ${node.d} × ${node.h}, the parent's envelope)
- parts: a part budget for one copy
- copies: how many copies ONE copy of "${node.name}" contains
${CONFIG.sideways.enabled ? "- sideways: true for a sideways panel (face w × d, thickness h ≤ 6 plates), false otherwise\n" : ""}- split: ${canSplit ? `true to plan it as child sub-builds of its own, false to design it directly` : `false (this is the deepest level; every child is designed directly)`}
- from: "new" to design it, "shared" to reuse a sub-build already planned elsewhere in this model (give its exact id and size, listed below)${o.library.length ? `, or "library:<id>" to reuse a saved component` : ""}
- recolor: ${o.library.length ? `for a library component, colour swaps like "red>blue" (empty to keep its colours)` : "leave empty"}

Limits: at most ${t.maxChildren} children; parts × copies over the children ≤ ${node.parts} (leave some for the base and glue parts); a child designed directly has at most ${CONFIG.subbuilds.maxSubParts} parts; ${o.uniqueLeft} more new unique sub-builds are allowed in the whole model, shared with other sub-builds being planned now (aim for at most ${o.uniqueShare} here).
${treeText()}
${o.shared.length ? `\nSub-builds already planned in this model that can be shared (from: "shared", same id and size):\n${o.shared.map((s) => `- ${s.id} "${s.name}": ${s.w} × ${s.d} × ${s.h}, ${s.parts} parts — ${s.purpose}`).join("\n")}\n` : ""}${o.library.length ? libraryText(o.library) : ""}

Also give layout: a short plan of this sub-build (its base, where each child copy goes and how it faces, what glue parts tie them together).`;
}

export function childPlanJsonSchema(): Record<string, unknown> {
  return {
    type: "object",
    properties: {
      layout: { type: "string" },
      children: {
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
            split: { type: "boolean" },
            from: { type: "string" },
            recolor: { type: "array", items: { type: "string" } },
          },
          required: ["id", "name", "purpose", "w", "d", "h", "parts", "copies", ...(CONFIG.sideways.enabled ? ["sideways"] : []), "split", "from", "recolor"],
          additionalProperties: false,
        },
      },
    },
    required: ["layout", "children"],
    additionalProperties: false,
  };
}

/** A finished child, as the sub-assembly sees it. */
export interface BuiltChild {
  id: string;
  name: string;
  copies: number;
  parts: number;
  maps: SurfaceMaps;
  sideways?: boolean;
}

export function subAssemblyPrompt(plan: Plan, node: PlannedSubBuild, child: ChildPlan, ctx: TreeContext, built: BuiltChild[]): string {
  return `You are assembling one sub-build of a larger model from its finished child sub-builds.

The whole model: ${plan.name} — ${plan.description}
${ctx.path.length ? `It's a part of: ${ctx.path.map((p) => p.name).join(" › ")}.\n` : ""}
Assemble the sub-build "${node.name}": ${node.purpose}
Its planned layout: ${child.layout}

Finished child sub-builds (they can't be changed now; you place copies of them):
${built.map((b) => `- ${b.id} "${b.name}" (${b.parts} parts, planned ${b.copies} cop${b.copies === 1 ? "y" : "ies"})\n${surfaceText(b.maps, b.sideways)}`).join("\n")}

Return the sub-build:
- parts: its own parts — the base or frame the copies stand on, and glue parts that tie copies together or finish it. Same rules as always.
- uses: the copies, each with sub, x, y, z, rot and mirror. (x, z) is where the min corner of the copy's (rotated) footprint goes; y is the height of the copy's bottom. A copy's cells rotate like a part's: at rot 90 a w × d footprint becomes d × w and its local cell (cx, cz) lands at (d-1-cz, cx) inside it; at rot 180 at (w-1-cx, d-1-cz); at rot 270 at (cz, w-1-cx). mirror: true flips the copy along its own x axis first (local cell (cx, cz) → (w-1-cx, cz)); handed parts swap automatically.

Rules the compiler checks:
- Everything must fit inside x 0..${node.w - 1}, z 0..${node.d - 1}, y 0..${node.h - 1} (plates). Start at x = 0, z = 0 and put the lowest parts at y = 0.
- It must be ONE connected piece on its own (it's built separately, then placed as a unit), buildable bottom-up. Things only connect through studs.
- Its bottom will stand on studs of the model around it, so give it a studded-to-underside base where it touches down (plates or bricks at y = 0, not tiles).
- Each copy is placed as one piece: its underside cells (o) must sit on studs of this sub-build's own parts or another copy directly below it, or at y = 0.
- Copies must not overlap each other or its own parts, and two copies must not interlock (each resting on the other).
${built.some((b) => b.sideways) ? sidewaysMountText("this sub-build") : ""}
Place the planned number of copies. Return JSON with name "${node.name}", a one-sentence description, parts and uses. ${formatHelp(codec(), true)}`;
}
