import { describe, expect, it } from "vitest";
import { resolvePipeline } from "./pipeline";
import { toDetail } from "../detail";

describe("generator path setting", () => {
  it("defaults to auto: sub-builds for High and Very high detail, single pass for Standard", () => {
    expect(resolvePipeline(undefined, "high")).toBe("subbuilds");
    expect(resolvePipeline(undefined, "very_high")).toBe("subbuilds");
    expect(resolvePipeline(undefined, "standard")).toBe("single");
    expect(resolvePipeline(undefined, undefined)).toBe("single");
    expect(resolvePipeline("subbuilds", "standard")).toBe("subbuilds");
    expect(resolvePipeline("single", "very_high")).toBe("single");
  });
  it("edits use the single-pass edit path", () => {
    expect(resolvePipeline("subbuilds", "high", true)).toBe("single");
  });
  it("maps the old sizes onto Detail", () => {
    expect([toDetail("small"), toDetail("medium"), toDetail("large"), toDetail("high"), toDetail("nope")]).toEqual(["standard", "standard", "high", "high", undefined]);
  });
});
