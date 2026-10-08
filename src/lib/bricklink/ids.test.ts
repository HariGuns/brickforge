import { describe, expect, it } from "vitest";
import { BRICKLINK_COLORS, BRICKLINK_PARTS, bricklinkFor, UNCONFIRMED_BRICKLINK } from "./ids";
import { CATALOG_PARTS, CORE_PARTS, SNOT_PARTS } from "../parts/library";
import { COLORS } from "../parts/colors";
import rebrickable from "./rebrickable.json";

const ALL = [...CORE_PARTS, ...CATALOG_PARTS, ...SNOT_PARTS.filter((p) => !CATALOG_PARTS.includes(p))];

describe("BrickLink IDs (from Rebrickable)", () => {
  it("every part in the catalog, upright and sideways, has a BrickLink ID", () => {
    expect(ALL.length).toBe(CORE_PARTS.length + 931); // 926 + 5 baseplates
    const missing = ALL.filter((p) => !bricklinkFor(p.id)?.every((b) => /^[a-z0-9]+$/i.test(b.id)));
    expect(missing.map((p) => p.id)).toEqual([]);
  });

  it("flags the parts Rebrickable can't confirm (update this list only after checking them)", () => {
    expect([...UNCONFIRMED_BRICKLINK].sort()).toEqual(
      ["15623", "18926", "2580", "30185", "30402", "30477", "30485", "3049b", "3245a", "3890", "39266", "42607", "45706", "49656", "56074", "60189", "60235", "60237", "65551", "65552", "6567", "67013", "778", "87398", "92715", "93598", "u8200", "u9251"].sort(),
    );
    for (const id of UNCONFIRMED_BRICKLINK) expect(ALL.some((p) => p.id === id), id).toBe(true);
  });

  it("uses BrickLink's number where it differs from LDraw's", () => {
    const rb = rebrickable.parts as Record<string, string>;
    const renamed = ALL.filter((p) => !p.bricklink && !BRICKLINK_PARTS[p.id] && rb[p.ldraw.file.replace(/\.dat$/i, "")] !== p.ldraw.file.replace(/\.dat$/i, "") && rb[p.ldraw.file.replace(/\.dat$/i, "")]);
    expect(renamed.length).toBeGreaterThan(50);
    for (const p of renamed) expect(bricklinkFor(p.id)![0].id).toBe(rb[p.ldraw.file.replace(/\.dat$/i, "")]);
  });

  it("agrees with Rebrickable on the hand-made core table and the colours", () => {
    const rb = rebrickable.parts as Record<string, string>;
    for (const p of CORE_PARTS) {
      const auto = rb[p.ldraw.file.replace(/\.dat$/i, "").toLowerCase()];
      if (auto && BRICKLINK_PARTS[p.id]) expect(BRICKLINK_PARTS[p.id][0].id, p.id).toBe(auto);
    }
    expect(rebrickable.coreTableMissing).toEqual([]);
    expect(rebrickable.coreTableRenamed).toEqual({}); // BrickLink primary numbers (the upload wants them)
    expect(Object.fromEntries(COLORS.map((c) => [c.id, BRICKLINK_COLORS[c.id]]))).toEqual(rebrickable.colors);
  });
});
