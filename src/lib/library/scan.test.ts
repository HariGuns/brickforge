import { describe, expect, it } from "vitest";
import { loadLibraryModel } from "./scan";

describe("library loading", () => {
  it("rejects path traversal and unknown kinds", () => {
    expect(loadLibraryModel("debug", "../src")).toBeNull();
    expect(loadLibraryModel("export", "../package.json")).toBeNull();
    expect(loadLibraryModel("export", ".env.local")).toBeNull();
    expect(loadLibraryModel("secrets", "x")).toBeNull();
  });
});
