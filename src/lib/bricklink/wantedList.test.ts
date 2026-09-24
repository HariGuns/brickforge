import { describe, expect, it } from "vitest";
import { PARTS } from "../parts/library";
import { COLORS } from "../parts/colors";
import { BRICKLINK_COLORS, BRICKLINK_PARTS } from "./ids";
import { exportWantedList, wantedItems } from "./wantedList";
import { P, SAMPLE_HOUSE } from "../fixtures/samples";
import type { BrickModel } from "../model/schema";

const model = (parts: BrickModel["parts"]): BrickModel => ({ name: "t", description: "", parts });

describe("BrickLink wanted list", () => {
  it("has a BrickLink ID for every part and colour", () => {
    expect(PARTS.filter((p) => !BRICKLINK_PARTS[p.id]?.length).map((p) => p.id)).toEqual([]);
    expect(COLORS.filter((c) => BRICKLINK_COLORS[c.id] === undefined).map((c) => c.id)).toEqual([]);
    expect(Object.keys(BRICKLINK_PARTS).filter((id) => !PARTS.some((p) => p.id === id))).toEqual([]);
  });

  it("maps IDs that differ between LDraw and BrickLink", () => {
    const ids = (part: string) => wantedItems(model([P(part, "red", 0, 0, 0)])).map((i) => i.id);
    expect(ids("plate_1x2")).toEqual(["3023"]); // LDraw 3023b
    expect(ids("slope45_2x1")).toEqual(["3040"]); // LDraw 3040b
    expect(ids("round_plate_1x1")).toEqual(["4073"]); // LDraw 6141
  });

  it("merges by part and colour and lists window glass as trans-clear", () => {
    const items = wantedItems(
      model([P("brick_2x4", "red", 0, 0, 0), P("brick_2x4", "red", 0, 0, 3), P("brick_2x4", "blue", 0, 0, 6), P("window_1x2x2", "white", 4, 0, 0), P("window_1x2x2", "white", 4, 0, 6)]),
    );
    expect(items).toEqual([
      { id: "3001", color: 5, qty: 2 },
      { id: "60592", color: 1, qty: 2 },
      { id: "60601", color: 12, qty: 2 },
      { id: "3001", color: 7, qty: 1 },
    ]);
  });

  it("writes the upload XML with one ITEM per part and colour", () => {
    const xml = exportWantedList(model([P("brick_2x4", "red", 0, 0, 0), P("brick_2x4", "red", 0, 0, 3)]));
    expect(xml).toBe("<INVENTORY>\n  <ITEM>\n    <ITEMTYPE>P</ITEMTYPE>\n    <ITEMID>3001</ITEMID>\n    <COLOR>5</COLOR>\n    <MINQTY>2</MINQTY>\n  </ITEM>\n</INVENTORY>\n");
    const house = exportWantedList(SAMPLE_HOUSE);
    const total = [...house.matchAll(/<MINQTY>(\d+)<\/MINQTY>/g)].reduce((s, m) => s + Number(m[1]), 0);
    expect(total).toBeGreaterThanOrEqual(SAMPLE_HOUSE.parts.length);
  });
});
