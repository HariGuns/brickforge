import fs from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { generateModel, type GenerateEvent } from "./generate";
import { analysisBlock, sizeTarget, type PhotoAnalysis } from "../prompts/analysis";
import { CONFIG, stageSetting } from "../config";
import { P } from "../fixtures/samples";
import { mountsFor } from "../parts/wheels";

const huracan: PhotoAnalysis = {
  subject: "Lamborghini Huracán",
  category: "vehicle",
  dimensions: { length: 4.52, width: 1.93, height: 1.17 },
  keyFeatures: ["very low, wide wedge shape", "sharp angular nose", "large side air intakes", "big wheels close to the corners", "short rear deck"],
  colors: [{ area: "body", color: "red" }, { area: "windows", color: "trans_clear" }, { area: "wheels", color: "black" }],
  view: { azimuth: 35, elevation: 10 },
  notes: "Keep it low: height is 60% of the width.",
};

describe("target size from the photo analysis", () => {
  it("scales the real proportions to the Detail width; vehicles are at least 14 studs wide", () => {
    expect(sizeTarget(huracan, "standard", CONFIG.grid)).toEqual({ width: 14, length: 33, heightPlates: 21, parts: 300 });
    expect(sizeTarget(huracan, "high", CONFIG.design.grid)).toEqual({ width: 16, length: 37, heightPlates: 24, parts: 700 });
    const cat = { ...huracan, category: "animal" as const, dimensions: { length: 0.5, width: 0.25, height: 0.3 } };
    expect(sizeTarget(cat, "standard", CONFIG.grid).width).toBe(10);
  });

  it("shrinks to fit the build area", () => {
    const tower = { ...huracan, category: "building" as const, dimensions: { length: 5, width: 5, height: 60 } };
    const t = sizeTarget(tower, "very_high", CONFIG.grid);
    expect(t.heightPlates).toBeLessThanOrEqual(CONFIG.grid.y - 2);
    expect(t.width).toBeLessThan(22);
  });

  it("puts proportions, features, colours, size and orientation in the design prompt", () => {
    const text = analysisBlock(huracan, sizeTarget(huracan, "high", CONFIG.design.grid), { partLimit: 300 });
    expect(text).toContain("2.34 : 1 : 0.61");
    expect(text).toContain("37 studs long (z, front to back) × 16 studs wide (x) × about 24 plates tall");
    expect(text).toContain("about 300 parts at most");
    expect(text).toContain("1. very low, wide wedge shape");
    expect(text).toContain("front faces +z");
  });
});

// A photo build with a fake Claude: first the analysis call, then the design call.
const h1 = P("4600", "black", 2, 2, 1), h2 = P("4600", "black", 2, 2, 7);
const car = {
  name: "Red sports car",
  description: "Low red car.",
  parts: [h1, h2, P("plate_2x8", "dark_gray", 2, 3, 1, 90), P("plate_2x8", "red", 2, 4, 1, 90), P("plate_4x8", "red", 1, 5, 1, 90), ...[h1, h2].flatMap((h) => mountsFor(h, "4624c01").map((m) => ({ ...P("4624c01", "white", 0, 0, 0), ...m.at })))],
};
const usage = { input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
const dirs: string[] = [];
afterAll(() => dirs.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));

describe("photo builds start with the analysis", () => {
  it("analyses first, designs with the target size, and logs the analysis cost separately", async () => {
    const requests: Anthropic.MessageCreateParams[] = [];
    const client = {
      messages: {
        stream(params: Anthropic.MessageCreateParams) {
          requests.push(structuredClone(params));
          const props = ((params.output_config?.format?.schema ?? {}) as { properties?: object }).properties ?? {};
          const text = JSON.stringify("keyFeatures" in props ? huracan : "matches" in props ? { matches: true, differences: [], changes: { name: "", description: "", remove: [], set: [], add: [] } } : car);
          return {
            on() {
              return this;
            },
            async finalMessage() {
              return { content: [{ type: "text", text }], stop_reason: "end_turn", stop_details: null, usage };
            },
          };
        },
      },
    } as unknown as Pick<Anthropic, "messages">;
    const events: GenerateEvent[] = [];
    const r = await generateModel({ image: { mediaType: "image/jpeg", data: "AAAA" }, detail: "standard" }, (e) => events.push(e), { client });
    dirs.push(r.debugDir);

    expect(requests).toHaveLength(3); // analysis, design, one comparison (matches)
    expect(requests[0].output_config?.effort).toBe(stageSetting("analysis").effort);
    // Same tools as the design call (so the cached prefix is shared), but not callable.
    expect(requests[0].tools).toEqual(requests[1].tools);
    expect(requests[0].tool_choice).toEqual({ type: "none" });
    const designText = (requests[1].messages[0].content as Anthropic.ContentBlockParam[]).find((b) => b.type === "text") as Anthropic.TextBlockParam;
    expect(designText.text).toContain("33 studs long (z, front to back) × 14 studs wide");
    expect(events.find((e) => e.type === "analysis")).toMatchObject({ type: "analysis", target: { width: 14, length: 33 } });
    expect(r.analysis?.analysis.subject).toBe("Lamborghini Huracán");
    // Total = analysis + design; the analysis is also logged on its own.
    expect(r.usage.cost).toBeCloseTo(r.analysis!.cost + r.rounds.filter((x) => x.scope === "main" || x.scope.startsWith("refine")).reduce((s, x) => s + x.usage.cost, 0), 6);
    const summary = JSON.parse(fs.readFileSync(`${r.debugDir}/summary.json`, "utf8"));
    expect(summary.analysis.subject).toBe("Lamborghini Huracán");
    expect(summary.analysis.usage.cost).toBeGreaterThan(0);
    expect(fs.existsSync(`${r.debugDir}/analysis.json`)).toBe(true);
  });
});
