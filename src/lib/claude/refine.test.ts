import fs from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { generateModel, type GenerateEvent } from "./generate";
import type { PhotoAnalysis } from "../prompts/analysis";
import { P } from "../fixtures/samples";
import { mountsFor } from "../parts/wheels";
import { views } from "./refine";

const analysis: PhotoAnalysis = {
  subject: "red car",
  category: "vehicle",
  dimensions: { length: 4, width: 2, height: 1.2 },
  keyFeatures: ["low body", "four wheels"],
  colors: [{ area: "body", color: "red" }],
  view: { azimuth: -40, elevation: 15 },
  notes: "",
};
const h1 = P("4600", "black", 2, 2, 1), h2 = P("4600", "black", 2, 2, 7);
const wheels = [h1, h2].flatMap((h) => mountsFor(h, "4624c01").map((m) => ({ ...P("4624c01", "white", 0, 0, 0), ...m.at })));
const base = [h1, h2, P("plate_2x8", "dark_gray", 2, 3, 1, 90), P("plate_2x8", "red", 2, 4, 1, 90)];
const car = { name: "Car", description: "", parts: [...base, P("plate_4x8", "red", 1, 5, 1, 90), ...wheels] };
// The comparison's correction: a lower, sleeker top (the 4×8 plate becomes a 2×8), as a change by index.
const refined = { name: "Car", description: "", parts: [...base, P("plate_2x8", "red", 2, 5, 1, 90), ...wheels] };
const changes = (d: { set?: object[]; add?: object[] }) => ({ name: "", description: "", remove: [], set: d.set ?? [], add: d.add ?? [] });
const sleeker = changes({ set: [{ index: 4, ...P("plate_2x8", "red", 2, 5, 1, 90) }] });
// A broken correction: adds a part floating in the air.
const broken = changes({ add: [P("brick_2x2", "red", 10, 12, 10)] });

const usage = { input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
function fake(answers: unknown[]) {
  const requests: Anthropic.MessageCreateParams[] = [];
  let k = 0;
  const client = {
    messages: {
      stream(params: Anthropic.MessageCreateParams) {
        requests.push(structuredClone(params));
        const props = ((params.output_config?.format?.schema ?? {}) as { properties?: object }).properties ?? {};
        const text = JSON.stringify("keyFeatures" in props ? analysis : "matches" in props ? answers[k++] : car);
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
  return { client, requests };
}

const dirs: string[] = [];
afterAll(() => dirs.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));
const photo = { image: { mediaType: "image/jpeg" as const, data: "AAAA" }, detail: "standard" as const };

describe("visual comparison with the photo", () => {
  it("renders from the photo's angle and the side, takes a valid correction, stops when it matches", async () => {
    const { client, requests } = fake([
      { matches: false, differences: ["roof too wide"], changes: sleeker },
      { matches: true, differences: [], changes: changes({}) },
    ]);
    const events: GenerateEvent[] = [];
    const r = await generateModel(photo, (e) => events.push(e), { client });
    dirs.push(r.debugDir);
    expect(r.valid).toBe(true);
    expect(r.model!.parts).toEqual(refined.parts);
    expect(r.refine?.map((x) => [x.round, x.matches, x.accepted])).toEqual([
      [1, false, true],
      [2, true, false],
    ]);
    // The comparison request: photo, then the two renders, then the text.
    const content = requests[2].messages[0].content as Anthropic.ContentBlockParam[];
    expect(content.map((b) => b.type)).toEqual(["image", "image", "image", "text"]);
    expect(((content[1] as Anthropic.ImageBlockParam).source as Anthropic.Base64ImageSource).media_type).toBe("image/png");
    expect(fs.readFileSync(`${r.debugDir}/refine-1.view.png`).subarray(1, 4).toString()).toBe("PNG");
    expect(fs.existsSync(`${r.debugDir}/refine-2.side.png`)).toBe(true);
    // Costs: logged per round and in the summary; included in the total.
    const summary = JSON.parse(fs.readFileSync(`${r.debugDir}/summary.json`, "utf8"));
    expect(summary.refine.rounds).toHaveLength(2);
    expect(summary.refine.usage.cost).toBeCloseTo(r.refine!.reduce((s, x) => s + x.cost, 0), 6);
    expect(events.filter((e) => e.type === "refine" && e.status === "done")).toHaveLength(2);
  });

  it("keeps the previous model when a correction can't be made valid", async () => {
    const { client } = fake([
      { matches: false, differences: ["add a spoiler"], changes: broken },
      { matches: false, differences: [], changes: changes({}) }, // repairs that don't fix it
      { matches: false, differences: [], changes: changes({}) },
    ]);
    const r = await generateModel(photo, () => {}, { client });
    dirs.push(r.debugDir);
    expect(r.valid).toBe(true);
    expect(r.model!.parts).toEqual(car.parts);
    expect(r.refine).toHaveLength(1);
    expect(r.refine![0].accepted).toBe(false);
    expect(r.rounds.filter((x) => x.scope === "refine:1")).toHaveLength(3); // the correction + 2 repairs
  });

  it("shows the side the photo shows", () => {
    expect(views({ azimuth: -40, elevation: 15 }).side.azimuth).toBe(-90);
    expect(views({ azimuth: 30, elevation: 15 }).side.azimuth).toBe(90);
  });
});
