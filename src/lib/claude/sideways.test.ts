import fs from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { generateDesign } from "./subbuilds";
import { assemblyJsonSchema, assemblyPrompt, planJsonSchema, planPrompt, subBuildPrompt } from "../prompts/subbuilds";
import { compactCodec, jsonCodec } from "../diff/codec";
import { partRow } from "../parts/describe";
import { getPart } from "../parts/library";
import { searchParts } from "../parts/search";
import { P } from "../fixtures/samples";
import { CONFIG } from "../config";

// A mirrored pair of side panels on a 47905 (studs on both sides), as a sub-build plan.
const plan = {
  name: "Side panels",
  description: "A white core with a red panel clipped onto each side.",
  layout: "4×4 green base, a 47905 in the middle with a panel mounted on each side stud.",
  subBuilds: [{ id: "side", name: "Side panel", purpose: "a red panel with a wedge at its top edge", w: 2, d: 4, h: 2, parts: 3, copies: 2, sideways: true }],
};
const side = { name: "Side panel", description: "panel", parts: [P("plate_2x4", "red", 0, 0, 0, 90), P("41769b", "red", 0, 1, 0)] };
const main = (uses: string[]) => ({ name: "Side panels", description: "Two panels.", parts: [P("plate_4x4", "green", 0, 0, 0), P("47905", "white", 1, 1, 1)], uses });
const good = ["side on 1:0 at 0,3 spin 0", "side on 1:1 at 1,3 spin 0 m"];

const schemaProps = (q: Anthropic.MessageCreateParams) => ((q.output_config?.format?.schema ?? {}) as { properties?: Record<string, unknown> }).properties ?? {};

function fakeClient() {
  const requests: Anthropic.MessageCreateParams[] = [];
  const client = {
    messages: {
      stream(params: Anthropic.MessageCreateParams) {
        requests.push(structuredClone(params));
        const props = schemaProps(params);
        let text: string;
        if ("layout" in props) text = JSON.stringify(plan);
        // The repair: fix the second copy's mount (it named a side stud 47905 doesn't have).
        else if ("setCopies" in props && params.messages.length > 1)
          text = JSON.stringify({ name: "", description: "", remove: [], set: [], add: [], removeCopies: [], setCopies: [{ index: 1, value: good[1] }], addCopies: [] });
        else if ("uses" in props) text = JSON.stringify(main([good[0], "side on 1:2 at 1,3 spin 0 m"]));
        else text = JSON.stringify(side);
        return {
          on() {
            return this;
          },
          async finalMessage() {
            return { content: [{ type: "text", text }], stop_reason: "end_turn", stop_details: null, usage: { input_tokens: 100, output_tokens: 200, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } };
          },
        };
      },
    },
  };
  return { client: client as unknown as Pick<Anthropic, "messages">, requests };
}

const dirs: string[] = [];
afterAll(() => dirs.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));

describe("sideways sub-builds (fake Claude)", () => {
  it("plans a sideways panel, builds it flat, mounts a mirrored pair and repairs a bad mount", async () => {
    const { client, requests } = fakeClient();
    const r = await generateDesign({ text: "two side panels", detail: "standard" }, () => {}, { client });
    dirs.push(r.debugDir);
    expect(r.valid).toBe(true);
    expect(r.rounds.map((x) => x.scope).sort()).toEqual(["assembly", "assembly", "plan", "sub:side"]);

    // Prompts: the panel is built flat; the assembly explains mounts and shows the panel's back.
    const text = (q: Anthropic.MessageCreateParams) => q.messages[0].content as string;
    expect(text(requests.find((q) => text(q).includes('sub-build "Side panel"'))!)).toMatch(/SIDEWAYS PANEL: build it flat/);
    const asm = requests.find((q) => "uses" in schemaProps(q))!;
    expect(text(asm)).toMatch(/SIDEWAYS PANEL: face 2 studs wide × 4 studs tall, 2 plates thick/);
    expect(text(asm)).toMatch(/"on <part>:<side stud> at <cx>,<cz> spin <rot>"/);

    // The repair names the bad stud and lists mounted copies in the compact format.
    const repair = requests.at(-1)!.messages.at(-1)!.content as string;
    expect(repair).toMatch(/\[MOUNT_INVALID\] .*has 2 side stud\(s\) \(0–1\); stud 2 doesn't exist/);
    expect(JSON.stringify(requests.at(-1)!.messages)).toContain("side on 1:0 at 0,3 spin 0");

    // Result: both panels turned onto their sides, one on each face of the 47905.
    expect(r.design!.main.uses.map((u) => compactCodec.formatInstance(u))).toEqual(good);
    const panels = r.model!.parts.filter((p) => p.frame);
    expect(panels).toHaveLength(4);
    // Local y (the panel's outer face) points out of opposite faces of the 47905.
    const out = new Set(panels.map(({ frame: f }) => `${f!.m[1]},${f!.m[7]}`));
    expect(out.size).toBe(2);
    const [a, b] = [...out].map((k) => k.split(",").map(Number));
    expect(a[0] + b[0] === 0 && a[1] + b[1] === 0 && Math.abs(a[0]) + Math.abs(a[1]) === 1).toBe(true);
    expect(r.model!.parts.map((p) => p.part).sort()).toEqual(["41769b", "41770b", "47905", "plate_2x4", "plate_2x4", "plate_4x4"].sort());
  });
});

describe("sideways prompts and formats", () => {
  it("parses and formats mounted copies in both formats", () => {
    for (const s of ["side on 12:0 at 3,1 spin 90", "side on 0:3 at 0,0 spin 0 m"]) {
      const u = compactCodec.parseInstance(s);
      expect(typeof u).toBe("object");
      expect(compactCodec.formatInstance(u as Exclude<typeof u, string>)).toBe(s);
    }
    expect(compactCodec.parseInstance("side on 12:0 at 3,1 spin 45")).toMatch(/spin must be/);
    expect(compactCodec.parseInstance("side on twelve")).toMatch(/isn't "<sub-build id> on/);
    expect(compactCodec.parseInstance("side on 2:1 at 0,1")).toMatchObject({ mount: { part: 2, stud: 1, at: [0, 1], spin: 0 } });
    expect(jsonCodec.parseInstance({ sub: "a", x: 1, y: 2, z: 3, rot: 0, mirror: false, mount: null })).toEqual({ sub: "a", x: 1, y: 2, z: 3, rot: 0, mirror: false });
    expect(jsonCodec.parseInstance({ sub: "a", x: 0, y: 0, z: 0, rot: 0, mirror: false, mount: { part: 1, stud: 0, at: [0, 3], spin: 0 } })).toMatchObject({ mount: { part: 1, at: [0, 3] } });
    expect(JSON.stringify(jsonCodec.instanceSchema)).toContain("mount");
  });

  it("show side studs in part rows and find carriers by search", () => {
    expect(partRow(getPart("87087")!)).toMatch(/side studs \(for sideways copies\): 0: \+z face/);
    expect(partRow(getPart("brick_2x4")!)).not.toMatch(/side studs/);
    expect(searchParts("bracket").some((p) => p.snot)).toBe(true);
    expect(searchParts("snot brick").some((p) => p.snot)).toBe(true);
  });

  it("mention sideways panels only while sideways building is enabled", () => {
    const up = { ...plan, subBuilds: [{ ...plan.subBuilds[0], sideways: false }] };
    const maps = { w: 2, d: 4, h: 2, top: [], bottom: ["o o", "o o", "o o", "o o"], studsByHeight: [] };
    expect(planPrompt("x", "standard", false)).toMatch(/Sideways panels/);
    expect(JSON.stringify(planJsonSchema())).toContain("sideways");
    expect(subBuildPrompt(up, up.subBuilds[0])).not.toMatch(/SIDEWAYS/);
    expect(assemblyPrompt("x", up, [{ id: "side", name: "Side", copies: 2, parts: 2, maps }])).not.toMatch(/mounted, not placed/);
    CONFIG.sideways.enabled = false;
    try {
      expect(planPrompt("x", "standard", false)).not.toMatch(/[Ss]ideways/);
      expect(JSON.stringify(planJsonSchema())).not.toContain("sideways");
      expect(JSON.stringify(assemblyJsonSchema())).not.toContain("mount");
      expect(JSON.stringify(jsonCodec.instanceSchema)).not.toContain("mount");
    } finally {
      CONFIG.sideways.enabled = true;
    }
  });
});
