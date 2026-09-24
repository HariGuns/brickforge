import { describe, expect, it } from "vitest";
import { resolvePipeline } from "./pipeline";

describe("generator path setting", () => {
  it("defaults to auto and resolves auto by size", () => {
    expect(resolvePipeline(undefined, "large")).toBe("subbuilds");
    expect(resolvePipeline(undefined, "medium")).toBe("single");
    expect(resolvePipeline("subbuilds", "small")).toBe("subbuilds");
    expect(resolvePipeline("auto", "large")).toBe("subbuilds");
    expect(resolvePipeline("auto", "medium")).toBe("single");
    expect(resolvePipeline("auto", undefined)).toBe("single");
  });
  it("edits use the single-pass edit path", () => {
    expect(resolvePipeline("subbuilds", "large", true)).toBe("single");
  });
});
